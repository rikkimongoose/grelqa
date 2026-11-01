import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, inArray } from "drizzle-orm";
import { hash } from "@node-rs/argon2";
import { openDatabase } from "../src/db/connection";
import { getDatabase } from "../src/db";
import { writeTransaction } from "../src/db/write-transaction";
import * as s from "../src/db/schema";
import { seedClosureDemo } from "../scripts/demo-closure-data";
import { closeFirstRound, ClosureError } from "../src/contests/close-first-round";
import { closurePolicy, rankAndQualify, scoreStories, type ClosureStory, type ClosureVote } from "../src/contests/closure-rules";
import { publicFirstRoundResults, ownFirstRoundResults } from "../src/contests/results-queries";
import { myBallot, changeBallot } from "../src/voting/service";
import { tokenHash } from "../src/auth/service";

const slug = "demo-first-round-results";
const sid = (n: number, root = slug) => `${root}-story-${n}`;
const pid = (n: number, root = slug) => `${root}-member-${n}`;
const gid = (n: number, root = slug) => `${root}-group-${n}`;

test("чистый подсчёт: шкала, сохранение позиций, критерии, dense и полное равенство", () => {
  const rows: ClosureStory[] = ["z", "a", "b", "c"].map((id) => ({ id, title: id, groupId: "g", participationId: id, userId: id, length: 100, lengthAlgorithm: "test", status: "admitted", roundStatus: "active", globalWithdrawn: false, withdrawnAt: null, withdrawalReason: null }));
  const vote: ClosureVote = { id: "v", participationId: "voter", groupId: "g", submittedAt: new Date().toISOString(), entries: rows.map((story, index) => ({ storyId: story.id, position: index + 1 })) };
  const points = scoreStories(rows, [vote], new Set(["a"]));
  assert.deepEqual(points.map((row) => row.points), [10, null, 4, 3]);
  assert.equal(points[2].counts[2], 1, "после снятия второго третья позиция не сдвигается");
  const tied = scoreStories(rows, [], new Set());
  rankAndQualify(tied, rows, [{ id: "g" }, { id: "empty" }], 2, closurePolicy());
  assert.ok(tied.every((row) => row.place === 1 && row.shared && row.finalist));
  assert.deepEqual(tied.map((row) => row.id), ["z", "a", "b", "c"], "ID/название не разрешают равенство");
  // Equal sums and first-place counts are resolved by the later rank-count criterion, before length.
  const criteria = scoreStories(rows, [], new Set());
  for (const row of criteria) { row.points = 20; row.counts = [0, 0, 0, 0, 0, 0]; }
  criteria[0].counts[1] = 1; criteria[1].counts[2] = 1;
  rows[1].length = 200;
  rankAndQualify(criteria, rows, [{ id: "g" }], 6, closurePolicy());
  assert.equal(criteria[0].place, 1); assert.equal(criteria[1].place, 2);
  assert.equal(criteria[2].place, 3); assert.equal(criteria[3].place, 3);
});

test("закрытие: предрасчёт, атомарность, освобождение, гонки, failed и публичная анонимность", { timeout: 120000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grelqa-closure-"));
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: `file:${path.join(directory, "test.db")}`, EXPORT_CACHE_DIRECTORY: path.join(directory, "exports"),
    SESSION_SECRET: "closure-tests-secret-at-least-thirty-two-characters", APP_URL: "https://grelqa.test", SITE_URL: "https://grelqa.test", MAIL_MODE: "smtp", SMTP_HOST: "127.0.0.1", SMTP_PORT: "9", MAIL_FROM: "test@grelqa.test" };
  const previous = { mode: process.env.NODE_ENV, url: process.env.DATABASE_URL };
  Object.assign(process.env, { NODE_ENV: "development", DATABASE_URL: env.DATABASE_URL });
  const connection = await openDatabase(env.DATABASE_URL); const { db, client } = connection;
  let server: ReturnType<typeof spawn> | undefined;
  try {
    execFileSync(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], { env, stdio: "pipe" });
    assert.equal(await seedClosureDemo(db), true); assert.equal(await seedClosureDemo(db), false);
    const beforeBallots = await db.select().from(s.ballots), beforeEntries = await db.select().from(s.ballotEntries), beforeDrafts = await db.select().from(s.ballotDrafts);
    assert.equal(await publicFirstRoundResults(slug), undefined);
    const token = randomBytes(32).toString("hex");
    await db.insert(s.authSessions).values({ tokenHash: tokenHash("session", token), userId: `${slug}-author-1`, createdAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) });
    const result = await closeFirstRound(db, slug);
    assert.equal(result.outcome, "results"); assert.equal(result.settings.quota, 2); assert.equal(result.settings.policy?.numbering, "dense");
    const find = (n: number) => result.results.find((row) => row.id === sid(n))!;
    assert.deepEqual([1, 2, 3, 4].map((n) => [find(n).points, find(n).place, find(n).shared, find(n).finalist]), [[24, 1, false, true], [22, 2, true, true], [22, 2, true, true], [12, 3, false, false]]);
    assert.equal(result.results.filter((row) => row.finalist).length, 9, "совместные проходные места допускают превышение F=6");
    assert.equal(result.results.filter((row) => row.groupId === gid(2) && row.finalist).length, 1, "недобор не передаёт квоту другой группе");
    assert.ok(find(5).withdrawn && find(6).withdrawn && find(5).points === null && find(6).place === null);
    assert.deepEqual(result.audit.nonVotingParticipationIds, [pid(5)]);
    assert.equal(result.audit.members.find((row) => row.id === pid(7))?.votingStatus, "exempt");
    assert.equal(result.audit.members.find((row) => row.id === pid(6))?.votingStatus, "submitted", "обязанность не пересчитывается после снятия чужих работ");
    const nonvoterRounds = await db.select().from(s.storyRounds).where(inArray(s.storyRounds.storyId, [sid(5), sid(6)]));
    assert.ok(nonvoterRounds.every((row) => row.status === "withdrawn" && row.withdrawalReason === "not-voted-first-round" && row.withdrawnAt));
    assert.deepEqual(await db.select().from(s.ballots), beforeBallots); assert.deepEqual(await db.select().from(s.ballotEntries), beforeEntries); assert.deepEqual(await db.select().from(s.ballotDrafts), beforeDrafts);
    assert.deepEqual(await closeFirstRound(db, slug), result);
    assert.deepEqual(await db.select().from(s.storyRounds).where(inArray(s.storyRounds.storyId, [sid(5), sid(6)])), nonvoterRounds);
    assert.equal((await myBallot(token, slug)).open, false);
    assert.equal((await myBallot(token, slug)).required, 4, "после снятий нельзя переопределять прежнюю обязанность по новому составу");
    await assert.rejects(changeBallot(token, "draft", { slug, revision: 1, requestId: crypto.randomUUID(), selections: [sid(2)] }, new Date(+new Date(result.deadline) - 1)), /Первый тур/);
    const view = await publicFirstRoundResults(slug); assert.ok(view);
    assert.doesNotMatch(JSON.stringify(view), /audit|member-|author-|ballot-|grelqa\.example|userId|participationId|counts/);
    const own = await ownFirstRoundResults(`${slug}-author-5`); assert.equal(own[0].status, "not-voted"); assert.equal(own[0].stories.length, 2);
    assert.ok(own[0].stories.every((row) => row.withdrawn));
    // Invalid data/snapshot write error must not leave removals or scores half committed.
    const broken = "demo-closure-rollback"; await seedClosureDemo(db, broken);
    const original = await db.select().from(s.storyRounds).where(eq(s.storyRounds.contestId, broken));
    await client.execute(`CREATE TRIGGER fail_closure BEFORE INSERT ON first_round_closures WHEN NEW.contest_id = '${broken}' BEGIN SELECT RAISE(ABORT, 'forced test failure'); END`);
    await assert.rejects(closeFirstRound(db, broken));
    assert.deepEqual(await db.select().from(s.storyRounds).where(eq(s.storyRounds.contestId, broken)), original);
    assert.equal((await db.select().from(s.firstRoundClosures).where(eq(s.firstRoundClosures.contestId, broken))).length, 0);
    await client.execute("DROP TRIGGER fail_closure"); await closeFirstRound(db, broken);
    const lengths = "demo-closure-lengths"; await seedClosureDemo(db, lengths);
    await db.update(s.stories).set({ length: null, lengthAlgorithm: null }).where(eq(s.stories.id, sid(1, lengths)));
    await assert.rejects(closeFirstRound(db, lengths), /сопоставимые/);
    assert.ok((await db.select().from(s.storyRounds).where(eq(s.storyRounds.contestId, lengths))).filter((row) => [sid(5, lengths), sid(6, lengths)].includes(row.storyId)).every((row) => row.status === "active"));
    for (const [kind, survivors] of [["none", []], ["one-author", [11, 12]]] as const) {
      const root = `demo-closure-${kind}`; await seedClosureDemo(db, root);
      const removed = Array.from({ length: 15 }, (_, index) => index + 1).filter((n) => !(survivors as readonly number[]).includes(n));
      await db.update(s.storyRounds).set({ status: "withdrawn", withdrawnAt: new Date(), withdrawalReason: "Снята автором" }).where(inArray(s.storyRounds.storyId, removed.map((n) => sid(n, root))));
      const failure = await closeFirstRound(db, root);
      assert.equal(failure.outcome, "failed"); assert.equal(failure.failureReason, kind === "none" ? "no-stories" : "one-author");
      assert.ok(failure.results.every((row) => !row.finalist && row.place === null && row.points === null));
      assert.equal((await db.select().from(s.contests).where(eq(s.contests.id, root)))[0].stage, "failed");
      assert.deepEqual(await closeFirstRound(db, root), failure);
    }
    // One group ends the contest, without finalist flags or author disclosure.
    const single = "demo-closure-single"; await seedClosureDemo(db, single);
    await db.delete(s.ballotEntries).where(eq(s.ballotEntries.contestId, single)); await db.delete(s.ballots).where(eq(s.ballots.contestId, single));
    await db.update(s.participations).set({ mustVoteRoundOne: false, roundOneExemptAt: new Date(), roundOneExemptReason: "no-eligible-stories", assignedGroupId: gid(1, single) }).where(eq(s.participations.contestId, single));
    await db.update(s.storyRounds).set({ groupId: gid(1, single) }).where(eq(s.storyRounds.contestId, single));
    await db.delete(s.contestGroups).where(and(eq(s.contestGroups.contestId, single), inArray(s.contestGroups.number, [2, 3])));
    await db.update(s.contests).set({ roundTwoStartAt: null, endsAt: new Date(Date.now() - 1) }).where(eq(s.contests.id, single));
    const singleResult = await closeFirstRound(db, single);
    assert.equal(singleResult.outcome, "results"); assert.ok(singleResult.settings.singleRound); assert.ok(singleResult.results.every((row) => !row.finalist));
    assert.equal((await db.select().from(s.contests).where(eq(s.contests.id, single)))[0].stage, "completed");
    // Cross-process lock: all callers return exactly the winner's snapshot, with no re-removals.
    const race = "demo-closure-race"; await seedClosureDemo(db, race);
    const children = [1, 2, 3].map(() => spawn(process.execPath, ["--import", "tsx", "scripts/close-first-round.ts", race], { env: { ...env, NODE_ENV: "development" }, stdio: "pipe" }));
    const exitCodes = await Promise.all(children.map(async (child) => { const [code] = await once(child, "exit"); return code; }));
    assert.deepEqual(exitCodes, [0, 0, 0]);
    const raceResult = await closeFirstRound(db, race); assert.deepEqual(await closeFirstRound(db, race), raceResult);
    // A write already accepting a ballot is serialized before closure; its last version is counted.
    const accepting = "demo-closure-accepting"; await seedClosureDemo(db, accepting);
    let release!: () => void; let locked!: () => void;
    const started = new Promise<void>((resolve) => { locked = resolve; });
    const acceptingWrite = writeTransaction(db, async (tx) => {
      await tx.update(s.ballotEntries).set({ position: 6 }).where(and(eq(s.ballotEntries.ballotId, `${accepting}-ballot-1`), eq(s.ballotEntries.storyId, sid(2, accepting))));
      await tx.update(s.ballotEntries).set({ position: 1 }).where(and(eq(s.ballotEntries.ballotId, `${accepting}-ballot-1`), eq(s.ballotEntries.storyId, sid(3, accepting))));
      await tx.update(s.ballotEntries).set({ position: 2 }).where(and(eq(s.ballotEntries.ballotId, `${accepting}-ballot-1`), eq(s.ballotEntries.storyId, sid(2, accepting))));
      locked(); await new Promise<void>((resolve) => { release = resolve; });
    });
    await started;
    const closing = closeFirstRound(db, accepting); await delay(50); release(); await acceptingWrite;
    const accepted = await closing;
    assert.equal(accepted.audit.votes.find((vote) => vote.id === `${accepting}-ballot-1`)?.entries[0].storyId, sid(3, accepting));
    const early = "demo-closure-early"; await seedClosureDemo(db, early);
    await db.update(s.contests).set({ roundTwoStartAt: new Date(Date.now() + 86400_000) }).where(eq(s.contests.id, early));
    await assert.rejects(closeFirstRound(db, early), /Дедлайн/);
    await db.update(s.contests).set({ isDemo: false }).where(eq(s.contests.id, early)); await assert.rejects(closeFirstRound(db, early), ClosureError);
    Object.assign(process.env, { NODE_ENV: "production" }); await assert.rejects(closeFirstRound(db, slug), /development/); Object.assign(process.env, { NODE_ENV: "development" });
    const password = "closure-test-only password 123";
    await db.update(s.users).set({ passwordHash: await hash(password) }).where(eq(s.users.id, `${slug}-author-5`));
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "0"], { env, stdio: ["ignore", "pipe", "pipe"] });
    const base = await new Promise<string>((resolve, reject) => {
      let output = ""; const timer = setTimeout(() => reject(new Error(output)), 30000);
      const collect = (chunk: Buffer) => { output += chunk; const url = output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1]; if (url && output.includes("Ready")) { clearTimeout(timer); resolve(url); } };
      server!.stdout!.on("data", collect); server!.stderr!.on("data", collect); server!.once("error", reject); server!.once("exit", () => { clearTimeout(timer); reject(new Error(output)); });
    });
    for (const rsc of [false, true]) {
      const response = await fetch(base + `/contests/${slug}`, { headers: rsc ? { RSC: "1" } : {} });
      assert.equal(response.status, 200); const body = await response.text();
      assert.match(body, /Итоги первого тура/); assert.match(body, /разделённое/); assert.match(body, /Выход в финал/); assert.match(body, /обязательное голосование не выполнено/);
      assert.doesNotMatch(body, /author-|member-|ballot-|grelqa\.example|nonVotingParticipationIds|submittedAt|selections|counts|audit|userId/);
      const pending = await (await fetch(base + `/contests/${lengths}`, { headers: rsc ? { RSC: "1" } : {} })).text();
      assert.doesNotMatch(pending, /Итоги первого тура|Выход в финал|разделённое/);
      const failed = await (await fetch(base + "/contests/demo-closure-none", { headers: rsc ? { RSC: "1" } : {} })).text();
      assert.match(failed, /Конкурс не состоялся/); assert.doesNotMatch(failed, />Выход в финал</);
    }
    const login = await fetch(base + "/api/account/login", { method: "POST", headers: { Origin: env.APP_URL!, "Content-Type": "application/json" }, body: JSON.stringify({ email: `${slug}-5@grelqa.example`, password }) });
    assert.equal(login.status, 200); const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const account = await fetch(base + "/account", { headers: { Cookie: cookie } }); assert.match(account.headers.get("cache-control")!, /private.*no-store/);
    const accountBody = await account.text(); assert.match(accountBody, /Результаты моих работ/); assert.match(accountBody, /обязанность не выполнена/);
    assert.match(accountBody, /История 05/); assert.match(accountBody, /История 06/); assert.doesNotMatch(accountBody, /История 01|История 02|История 15|selections|payloadHash/);
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) { const exit = once(server, "exit"); server.kill("SIGTERM"); await exit; }
    client.close(); (await getDatabase()).client.close();
    if (previous.mode === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: previous.mode });
    if (previous.url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous.url;
    await rm(directory, { recursive: true, force: true });
  }
});
