import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { hash } from "@node-rs/argon2";
import { openDatabase } from "../src/db/connection";
import * as s from "../src/db/schema";
import { closeReception, formFirstRound } from "../src/contests/grouping";
import { balancedBlockPlan, isOwnStory, publicFailureMessage, selectVotingStory, validateGroupPlan } from "../src/contests/grouping-rules";

test("сбалансированные блоки, минимальное увеличение и порядок выбора рассказа", () => {
  const ids = ["a", "b", "c", "d", "e"];
  const groups = [{ number: 1, capacity: 3, storyIds: ["a", "b", "c"] }, { number: 2, capacity: 3, storyIds: ["d", "e"] }];
  assert.doesNotThrow(() => validateGroupPlan(ids, groups, 2, 3));
  assert.doesNotThrow(() => validateGroupPlan(ids, [{ number: 1, capacity: 3, storyIds: ["a", "e"] }, { number: 2, capacity: 3, storyIds: ["b", "c", "d"] }], 2, 3));
  assert.throws(() => validateGroupPlan(ids, groups, 1, 3), /финалистов/);
  assert.throws(() => validateGroupPlan(ids, [{ number: 1, capacity: 3, storyIds: ids }], 2, 3), /вместимость/);
  assert.throws(() => validateGroupPlan(ids, [{ ...groups[0], storyIds: ["a", "a", "b"] }, groups[1]], 2, 3), /несколько/);
  assert.throws(() => validateGroupPlan(ids, [{ ...groups[0], storyIds: ["a", "b"] }, groups[1]], 2, 3), /не все/);
  assert.throws(() => validateGroupPlan(ids, [{ number: 1, capacity: 4, storyIds: ids.slice(0, 4) }, { number: 2, capacity: 4, storyIds: ["e"] }], 2, 4), /различаются/);
  const date = new Date("2020-01-01");
  const candidate = { lengthAlgorithm: "v1", length: 20, createdAt: date, title: "Я" };
  assert.equal(selectVotingStory([{ ...candidate, id: "short", length: 10 }, { ...candidate, id: "long" }])?.id, "long");
  assert.equal(selectVotingStory([{ ...candidate, id: "late", createdAt: new Date(+date + 1), title: "А" }, { ...candidate, id: "early" }])?.id, "early");
  assert.equal(selectVotingStory([{ ...candidate, id: "z" }, { ...candidate, id: "a", title: "А" }])?.id, "a");
  assert.equal(selectVotingStory([{ ...candidate, id: "b" }, { ...candidate, id: "a" }])?.id, "a");
  assert.equal(selectVotingStory([{ ...candidate, length: null, id: "a" }]), undefined);
  const ten = Array.from({ length: 10 }, (_, n) => ({ ...candidate, id: `s${n + 1}`, length: n + 1 }));
  const plain = balancedBlockPlan([...ten].reverse(), 4, 10);
  assert.deepEqual(plain.groups.map((group) => group.storyIds), [["s1", "s2", "s3", "s4"], ["s5", "s6", "s7"], ["s8", "s9", "s10"]]);
  const increased = balancedBlockPlan(ten, 2, 3);
  assert.equal(increased.effectiveCapacity, 4);
  assert.deepEqual(increased.groups.map((group) => group.storyIds.length), [4, 3, 3]);
  for (let n = 2; n <= 45; n++) for (let capacity = 1; capacity <= 7; capacity++) for (let final = 1; final <= 5; final++) {
    const rows = Array.from({ length: n }, (_, i) => ({ ...candidate, id: `n-${i}`, length: i }));
    const plan = balancedBlockPlan(rows, capacity, final);
    assert.doesNotThrow(() => validateGroupPlan(rows.map((row) => row.id), plan.groups, final, plan.effectiveCapacity));
    assert.ok(plan.groups.length <= final);
    assert.deepEqual(plan.groups.flatMap((group) => group.storyIds), rows.map((row) => row.id));
    for (let smaller = capacity; smaller < plan.effectiveCapacity; smaller++) assert.ok(Math.ceil(n / smaller) > final, "увеличение минимально необходимое");
  }
  assert.equal(isOwnStory("voter", "voter"), true);
  assert.equal(isOwnStory("voter", "another-author"), false);
  assert.equal(typeof publicFailureMessage("__proto__"), "string");
});

test("атомарность, конкурентные процессы, сохранение назначений, блокировки и диагностика", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grelqa-grouping-test-"));
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "development", DATABASE_URL: `file:${path.join(directory, "test.db")}` };
  const originalEnv = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: "development" });
  const { db, client } = await openDatabase(env.DATABASE_URL);
  const run = (script: string, args: string[] = []) => execFileSync(process.execPath, ["--import", "tsx", script, ...args], { env, stdio: "pipe" });
  try {
    run("scripts/migrate.ts"); run("scripts/demo-grouping.ts");
    const beforeDemoRepeat = await db.select().from(s.stories);
    run("scripts/demo-grouping.ts");
    assert.deepEqual(await db.select().from(s.stories), beforeDemoRepeat);
    const slug = "demo-first-round";
    const [contest] = await db.select().from(s.contests).where(eq(s.contests.slug, slug));
    const admitted = beforeDemoRepeat.filter((row) => row.status === "admitted");
    await db.update(s.contests).set({ stage: "submissions" }).where(eq(s.contests.id, contest.id));
    assert.deepEqual(await closeReception(db, slug), { stage: "moderation" });
    assert.deepEqual(await closeReception(db, slug), { stage: "moderation" });
    const spawnCli = (target = slug) => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "scripts/form-groups.ts", target], { env, stdio: "pipe" });
      let output = ""; child.stderr.on("data", (chunk) => { output += chunk; });
      child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(output)));
    });
    await Promise.all([spawnCli(), spawnCli(), spawnCli()]);
    const first = await formFirstRound(db, slug);
    assert.equal(first.status, "formed"); if (first.status !== "formed") return;
    const snapshot = first.snapshot;
    const legacy = { ...snapshot, version: "unambiguous-single-group-v1" as const, assignments: snapshot.assignments.map(({ participationId, groupId }) => ({ participationId, groupId })) };
    await db.update(s.firstRoundFormations).set({ snapshot: legacy }).where(eq(s.firstRoundFormations.contestId, contest.id));
    assert.deepEqual(await formFirstRound(db, slug), { status: "formed", snapshot: legacy });
    await db.update(s.firstRoundFormations).set({ snapshot }).where(eq(s.firstRoundFormations.contestId, contest.id));

    assert.equal(snapshot.groups.length, 1); assert.equal(snapshot.eligibleCount, 8); assert.equal(snapshot.assignments.length, 4);
    const rounds = await db.select().from(s.storyRounds);
    assert.equal(rounds.length, admitted.length); assert.equal(new Set(rounds.map((row) => row.storyId)).size, admitted.length);
    assert.deepEqual(rounds.map((row) => row.storyId).sort(), admitted.map((row) => row.id).sort());
    assert.ok(snapshot.groups.every((group) => group.storyIds.length <= group.capacity));
    assert.ok(snapshot.groups.length <= contest.finalCapacity);
    const participants = await db.select().from(s.participations);
    assert.ok(participants.every((row) => row.assignedGroupId === snapshot.groups[0].id && row.mustVoteRoundOne));
    const sameAuthor = admitted.filter((row) => row.participationId === "demo-group-participation-4");
    assert.equal(sameAuthor[0].title, sameAuthor[1].title); assert.equal(sameAuthor[0].length, sameAuthor[1].length); assert.equal(+sameAuthor[0].createdAt, +sameAuthor[1].createdAt);
    assert.equal(participants.find((row) => row.id === "demo-group-participation-4")?.assignedGroupId, snapshot.groups[0].id, "полный tie не мешает единственной возможной группе");
    // Публикация не происходит как побочный эффект распределения.
    assert.ok((await db.select().from(s.stories)).every((row) => row.publishedAt === null));
    assert.ok((await db.select().from(s.contestGroups)).every((row) => row.publishedAt === null));
    await db.update(s.storyRounds).set({ status: "withdrawn", withdrawnAt: new Date(), withdrawalReason: "Снята после фиксации" }).where(eq(s.storyRounds.storyId, admitted[0].id));
    assert.deepEqual(await formFirstRound(db, slug), first);
    assert.deepEqual(await db.select().from(s.participations), participants);
    await db.update(s.contests).set({ stage: "round-one" }).where(eq(s.contests.id, contest.id));
    assert.deepEqual(await formFirstRound(db, slug), first, "после старта разрешено только вернуть прежний результат");
    // Нет зафиксированного результата — после начала голосования нельзя строить заново.
    await db.delete(s.firstRoundFormations).where(eq(s.firstRoundFormations.contestId, contest.id));
    await assert.rejects(() => formFirstRound(db, slug), /после начала/);
    await db.insert(s.firstRoundFormations).values({ contestId: contest.id, formedAt: new Date(snapshot.formedAt), snapshot });
    Object.assign(process.env, { NODE_ENV: "production" });
    await assert.rejects(() => formFirstRound(db, slug), /development/);
    await assert.rejects(() => closeReception(db, slug), /development/);
    Object.assign(process.env, { NODE_ENV: "development" });

    // Каждая диагностическая ветка — отдельный конкурс, без сброса даже тестовой истории.
    let index = 0;
    const clone = async (suffix: string) => {
      const id = `test-${suffix}`;
      const start = new Date(+contest.submissionsStartAt - ++index * 86400_000);
      await db.insert(s.contests).values({ ...contest, id, slug: id, submissionsStartAt: start, startDayMoscow: new Date(+start + 3 * 3600_000).toISOString().slice(0, 10), groupCapacity: 8 });
      await db.insert(s.contestThemes).values({ contestId: id, theme: "Демо", conditions: [], enteredAt: new Date(+start - 1000) });
      for (let author = 1; author <= 2; author++) await db.insert(s.participations).values({ id: `${id}-p${author}`, userId: `demo-group-author-${author}`, contestId: id, createdAt: start });
      return { id, start };
    };
    const add = async (id: string, count: number, oneAuthor = false) => {
      for (let n = 0; n < count; n++) await db.insert(s.stories).values({ ...admitted[0], id: `${id}-s${n}`, contestId: id, participationId: `${id}-p${oneAuthor ? 1 : n % 2 + 1}`, publishedAt: null });
    };
    for (const [suffix, count, single, expected] of [["empty", 0, false, "no-stories"], ["one", 1, false, "one-story"], ["author", 3, true, "one-author"]] as const) {
      const { id } = await clone(suffix); await add(id, count, single);
      if (suffix === "empty") await Promise.all([spawnCli(id), spawnCli(id)]);
      const result = await formFirstRound(db, id); assert.equal(result.status, "failed");
      if (result.status === "failed") assert.ok(result.snapshot.reasons.includes(expected));
      assert.deepEqual(await formFirstRound(db, id), result);
      assert.equal((await db.select().from(s.contestGroups).where(eq(s.contestGroups.contestId, id))).length, 0);
      assert.equal((await db.select().from(s.contests).where(eq(s.contests.id, id)))[0].stage, "failed");
    }
    for (const [suffix, offset, theme] of [["late", 1000, "Тема"], ["boundary", 0, "Тема"], ["empty-theme", -1000, "   "]] as const) {
      const { id, start } = await clone(suffix); await add(id, 3);
      await db.update(s.contestThemes).set({ enteredAt: new Date(+start + offset), theme }).where(eq(s.contestThemes.contestId, id));
      const result = await formFirstRound(db, id);
      assert.equal(result.status, suffix === "late" ? "failed" : suffix === "boundary" ? "formed" : "blocked");
      if (result.status === "blocked") assert.equal(result.diagnostics.theme, "empty-open");
    }
    const missing = await clone("missing-theme"); await add(missing.id, 3);
    await db.delete(s.contestThemes).where(eq(s.contestThemes.contestId, missing.id));
    const absent = await formFirstRound(db, missing.id); assert.equal(absent.status, "failed");
    if (absent.status === "failed") assert.ok(absent.snapshot.reasons.includes("theme-late"));
    for (const [suffix, capacity, finalCapacity] of [["multiple", 2, 4], ["increase", 1, 1]] as const) {
      const { id } = await clone(suffix); await add(id, 4);
      await db.update(s.contests).set({ groupCapacity: capacity, finalCapacity }).where(eq(s.contests.id, id));
      const result = await formFirstRound(db, id); assert.equal(result.status, "formed");
      if (result.status === "formed") {
        assert.equal(result.snapshot.effectiveCapacity, suffix === "increase" ? 4 : 2);
        assert.deepEqual(result.snapshot.groups.map((group) => group.storyIds.length), suffix === "increase" ? [4] : [2, 2]);
        assert.equal(result.snapshot.assignments.length, 2);
      }
      assert.equal((await db.select().from(s.contests).where(eq(s.contests.id, id)))[0].groupCapacity, capacity);
    }
    const early = await clone("early"); await add(early.id, 3);
    await db.update(s.contests).set({ submissionsEndAt: new Date(Date.now() + 60_000) }).where(eq(s.contests.id, early.id));
    await assert.rejects(() => formFirstRound(db, early.id), /не завершён/);
    await assert.rejects(() => closeReception(db, early.id), /не завершён/);
    const real = await clone("real"); await add(real.id, 3);
    await db.update(s.contests).set({ isDemo: false }).where(eq(s.contests.id, real.id));
    await assert.rejects(() => formFirstRound(db, real.id), /демонстрационного/);
    await assert.rejects(() => closeReception(db, real.id), /демонстрационный/);
    const atomic = await clone("rollback"); await add(atomic.id, 4);
    // Имитируем сбой последнего шага: ни группы, ни назначения не должны остаться.
    await client.execute("CREATE TRIGGER test_fail_formation BEFORE INSERT ON first_round_formations BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    await assert.rejects(() => formFirstRound(db, atomic.id));
    await client.execute("DROP TRIGGER test_fail_formation");
    assert.equal((await db.select().from(s.contestGroups).where(eq(s.contestGroups.contestId, atomic.id))).length, 0);
    assert.ok((await db.select().from(s.participations).where(eq(s.participations.contestId, atomic.id))).every((row) => row.assignedGroupId === null && !row.mustVoteRoundOne));
    const failureAtomic = await clone("failed-rollback");
    await client.execute("CREATE TRIGGER test_fail_formation BEFORE INSERT ON first_round_formations BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    await assert.rejects(() => formFirstRound(db, failureAtomic.id));
    await client.execute("DROP TRIGGER test_fail_formation");
    assert.equal((await db.select().from(s.contests).where(eq(s.contests.id, failureAtomic.id)))[0].stage, "moderation");
    assert.equal((await formFirstRound(db, failureAtomic.id)).status, "failed");
    const pending = await clone("pending"); await add(pending.id, 2);
    await db.insert(s.stories).values({ ...admitted[0], id: "pending-review", contestId: pending.id, participationId: `${pending.id}-p1`, status: "submitted" });
    assert.equal((await formFirstRound(db, pending.id)).status, "blocked");
    const notClosed = await clone("not-closed");
    await db.update(s.contests).set({ stage: "submissions" }).where(eq(s.contests.id, notClosed.id));
    assert.equal((await formFirstRound(db, notClosed.id)).status, "blocked");
    assert.equal((await db.select().from(s.contests).where(eq(s.contests.id, notClosed.id)))[0].stage, "submissions");
    await closeReception(db, notClosed.id);
    assert.equal((await formFirstRound(db, notClosed.id)).status, "failed");
    const unknown = await clone("unknown-length"); await add(unknown.id, 3);
    await db.update(s.stories).set({ length: null, lengthAlgorithm: null }).where(eq(s.stories.id, `${unknown.id}-s0`));
    assert.equal((await formFirstRound(db, unknown.id)).status, "blocked");
    const fullTie = await clone("full-tie"); await add(fullTie.id, 4);
    await db.update(s.contests).set({ groupCapacity: 2, finalCapacity: 2 }).where(eq(s.contests.id, fullTie.id));
    const tied = await formFirstRound(db, fullTie.id);
    assert.equal(tied.status, "formed");
    if (tied.status === "formed") {
      assert.deepEqual(tied.snapshot.groups.map((group) => group.storyIds), [[`${fullTie.id}-s0`, `${fullTie.id}-s1`], [`${fullTie.id}-s2`, `${fullTie.id}-s3`]]);
      assert.deepEqual(tied.snapshot.assignments.map((assignment) => assignment.selectedStoryId).sort(), [`${fullTie.id}-s0`, `${fullTie.id}-s1`]);
    }
    run("scripts/demo-grouping.ts", ["--blocks"]);
    const blocks = await formFirstRound(db, "demo-first-round-blocks");
    assert.equal(blocks.status, "formed");
    if (blocks.status === "formed") {
      assert.equal(blocks.snapshot.originalCapacity, 2); assert.equal(blocks.snapshot.effectiveCapacity, 4);
      assert.deepEqual(blocks.snapshot.groups.map((group) => group.storyIds.length), [4, 3, 3]);
      assert.equal(blocks.snapshot.assignments.length, 4);
      const assignment = blocks.snapshot.assignments.find((entry) => entry.participationId === "demo-block-participation-1")!;
      assert.equal(assignment.selectedStoryId, "demo-block-story-5");
      assert.equal(blocks.snapshot.groups.find((group) => group.id === assignment.groupId)?.number, 2);
      assert.deepEqual(await formFirstRound(db, "demo-first-round-blocks"), blocks);
    }
    assert.deepEqual((await client.execute("PRAGMA foreign_key_check")).rows, []);
  } finally { client.close(); if (originalEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: originalEnv }); await rm(directory, { recursive: true, force: true }); }
});

test("HTTP: состояние формирования, приватное назначение, опубликованные якоря и отсутствие авторства", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grelqa-grouping-pages-"));
  const env = { ...process.env, DATABASE_URL: `file:${path.join(directory, "test.db")}`, SESSION_SECRET: randomBytes(48).toString("base64url"), APP_URL: "https://grelqa.test", MAIL_MODE: "smtp", MAIL_FROM: "test@grelqa.test", SMTP_HOST: "127.0.0.1", SMTP_PORT: "9", SMTP_USER: "", SMTP_PASSWORD: "" };
  const originalMode = process.env.NODE_ENV;
  const { db, client } = await openDatabase(env.DATABASE_URL);
  let server: ReturnType<typeof spawn> | undefined;
  try {
    for (const script of ["scripts/migrate.ts", "scripts/demo-grouping.ts"]) execFileSync(process.execPath, ["--import", "tsx", script], { env: { ...env, NODE_ENV: "development" }, stdio: "pipe" });
    Object.assign(process.env, { NODE_ENV: "development" });
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "0"], { env, stdio: ["ignore", "pipe", "pipe"] });
    const base = await new Promise<string>((resolve, reject) => {
      let output = ""; const timer = setTimeout(() => reject(new Error(output)), 30_000);
      const collect = (chunk: Buffer) => { output += chunk; const url = output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1]; if (url && output.includes("Ready")) { clearTimeout(timer); resolve(url); } };
      server!.stdout!.on("data", collect); server!.stderr!.on("data", collect); server!.once("error", reject); server!.once("exit", () => { clearTimeout(timer); reject(new Error(output)); });
    });
    const get = async (path: string, cookie = "", rsc = false) => (await fetch(base + path, { headers: { Cookie: cookie, ...(rsc ? { RSC: "1" } : {}) } })).text();
    assert.match(await get("/contests/demo-first-round"), /Группы ещё не сформированы/);
    const result = await formFirstRound(db, "demo-first-round"); assert.equal(result.status, "formed"); if (result.status !== "formed") return;
    const groupId = result.snapshot.groups[0].id;
    const password = "demonstration-only test password";
    await db.update(s.users).set({ passwordHash: await hash(password) }).where(eq(s.users.id, "demo-group-author-1"));
    const login = await fetch(base + "/api/account/login", { method: "POST", headers: { Origin: env.APP_URL, "Content-Type": "application/json" }, body: JSON.stringify({ email: "group-author-1@grelqa.example", password }) });
    assert.equal(login.status, 200); const cookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.match(await get("/account", cookie), /Моя группа для голосования/);
    assert.match(await get("/account", cookie), /Группа 1/);
    for (const rsc of [false, true]) {
      const body = await get("/contests/demo-first-round", "", rsc);
      assert.match(body, /Группы сформированы/); assert.doesNotMatch(body, /group-author-|demo-group-participation-|История у окна 1|Полное совпадение/);
    }
    // Явные изменения ниже — ТОЛЬКО тестовая имитация будущей публикации.
    // Производственная операция не меняет ни эти поля, ни начало тура.
    const now = Date.now();
    await db.update(s.contests).set({ stage: "round-one", roundOneStartAt: new Date(now - 1000) }).where(eq(s.contests.slug, "demo-first-round"));
    await db.update(s.contestGroups).set({ publishedAt: new Date(now - 1000) }).where(eq(s.contestGroups.id, groupId));
    await db.update(s.stories).set({ publishedAt: new Date(now - 1000) }).where(eq(s.stories.status, "admitted"));
    for (const rsc of [false, true]) {
      const body = await get("/contests/demo-first-round", "", rsc);
      assert.match(body, /Первый тур · Группа 1/); assert.match(body, /История у окна 1/); assert.match(body, new RegExp(`group-${groupId}`));
      assert.doesNotMatch(body, /group-author-|demo-group-participation-|passwordHash|assignments/);
    }
    assert.match(await get("/account", cookie), new RegExp(`#group-${groupId}`));
    const withdrawal = await fetch(base + "/api/stories/withdraw", { method: "POST", headers: { Origin: env.APP_URL, "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ id: "demo-group-story-1", revision: 1, confirmed: true }) });
    assert.equal(withdrawal.status, 200);
    assert.equal((await db.select().from(s.participations).where(eq(s.participations.id, "demo-group-participation-1")))[0].assignedGroupId, groupId);
    assert.deepEqual(await formFirstRound(db, "demo-first-round"), result);
    assert.match(await get("/account", cookie), new RegExp(`#group-${groupId}`));
    await db.update(s.storyRounds).set({ status: "withdrawn", withdrawnAt: new Date(), withdrawalReason: "Проверка пустой опубликованной группы" }).where(eq(s.storyRounds.groupId, groupId));
    assert.match(await get("/contests/demo-first-round"), new RegExp(`group-${groupId}`));
    assert.match(await get("/contests/demo-first-round"), /нет доступных для чтения работ/);
    await db.update(s.contests).set({ stage: "failed", failureReason: "one-author" }).where(eq(s.contests.slug, "demo-first-round"));
    assert.match(await get("/contests/demo-first-round"), /Конкурс не состоялся/);
    assert.match(await get("/contests/demo-first-round"), /одному автору/);
    assert.doesNotMatch(await get("/contests/demo-first-round"), /История у окна 1|group-author-/);
    const [template] = await db.select().from(s.contests).where(eq(s.contests.slug, "demo-first-round"));
    const start = new Date(+template.submissionsStartAt - 86400_000);
    await db.insert(s.contests).values({ ...template, id: "demo-failed-checkpoint", slug: "demo-failed-checkpoint", title: "Проверка пустого конкурса", stage: "moderation", failureReason: null, submissionsStartAt: start, startDayMoscow: new Date(+start + 3 * 3600_000).toISOString().slice(0, 10) });
    await db.insert(s.contestThemes).values({ contestId: "demo-failed-checkpoint", theme: "Тема", conditions: [], enteredAt: start });
    assert.equal((await formFirstRound(db, "demo-failed-checkpoint")).status, "failed");
    const failedPage = await get("/contests/demo-failed-checkpoint");
    assert.match(failedPage, /Конкурс не состоялся/); assert.match(failedPage, /Нет конкурсных работ/);
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) { const exited = once(server, "exit"); server.kill("SIGTERM"); await exited; }
    client.close(); if (originalMode === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: originalMode }); await rm(directory, { recursive: true, force: true });
  }
});
