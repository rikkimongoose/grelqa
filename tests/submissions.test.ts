import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { and, eq } from "drizzle-orm";
import { hash } from "@node-rs/argon2";
import { openDatabase } from "../src/db/connection";
import * as s from "../src/db/schema";
import { countStoryText, LENGTH_ALGORITHM, submissionContent } from "../src/lib/submission";
import { fromEditorContent, toEditorContent } from "../src/lib/editor-content";
import { safeReturnPath } from "../src/lib/return-path";

const paragraph = (text: string): s.StoryContent => [{ type: "paragraph", children: [{ text }] }];
test("единый Unicode-подсчёт, безопасный формат и преобразование редактора", () => {
  const content: s.StoryContent = [
    { type: "paragraph", children: [{ text: "Я🙂", bold: true }, { text: "e\u0301", italic: true }] },
    { type: "paragraph", children: [{ text: "Z", bold: true, italic: true }] },
  ];
  assert.equal(countStoryText(content), 7);
  assert.deepEqual(fromEditorContent(toEditorContent(content)), content);
  assert.equal(countStoryText(submissionContent(paragraph("a\r\nb\rc"))), 5);
  assert.equal(countStoryText(paragraph("<b>x</b>")), 8, "строка HTML — обычный видимый текст");
  assert.throws(() => submissionContent([{ type: "image", src: "x" }]), /абзацы/);
  assert.throws(() => submissionContent([{ type: "paragraph", children: [{ text: "x", html: "<script>" }] }]), /текст/);
  assert.throws(() => submissionContent(paragraph("\ud800")), /Unicode/);
  assert.throws(() => submissionContent(paragraph("  \n ")), /Введите/);
  for (const path of ["https://evil.test", "//evil.test", "/\\evil.test", "/contests/%2f%2fevil", "/contests/a?next=//evil", "/contests/a\n"]) assert.equal(safeReturnPath(path), undefined);
  assert.equal(safeReturnPath("/contests/demo-open-submissions"), "/contests/demo-open-submissions");
});

test("HTTP: свои работы, конкуренция, дедлайн, приватность и снятие с сохранением истории", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grelqa-submissions-test-"));
  const env = { ...process.env, DATABASE_URL: `file:${path.join(directory, "test.db")}`, SESSION_SECRET: randomBytes(48).toString("base64url"), APP_URL: "https://grelqa.test", MAIL_MODE: "smtp", SMTP_HOST: "127.0.0.1", SMTP_PORT: "9", SMTP_USER: "", SMTP_PASSWORD: "", MAIL_FROM: "test@grelqa.test" };
  let server: ReturnType<typeof spawn> | undefined;
  const { db, client } = await openDatabase(env.DATABASE_URL);
  try {
    const run = (script: string) => execFileSync(process.execPath, ["--import", "tsx", script], { env, stdio: "pipe" });
    run("scripts/migrate.ts"); run("scripts/demo-submissions.ts");
    const originalContest = await db.select().from(s.contests);
    run("scripts/demo-submissions.ts");
    assert.deepEqual(await db.select().from(s.contests), originalContest, "демоскрипт не меняет существующие конкурсы");
    const password = "fictional password for testing";
    const encoded = await hash(password);
    for (const id of ["owner", "other", "unverified"]) await db.insert(s.users).values({ id, email: `${id}@example.test`, passwordHash: encoded, emailVerifiedAt: id === "unverified" ? null : new Date(), createdAt: new Date() });
    const slug = "demo-open-submissions";
    await db.update(s.contests).set({ minLength: 5, maxLength: 8 }).where(eq(s.contests.slug, slug));
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "0"], { env, stdio: ["ignore", "pipe", "pipe"] });
    const base = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error(output)), 30_000);
      const collect = (chunk: Buffer) => { output += chunk.toString(); const url = output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1]; if (url && output.includes("Ready")) { clearTimeout(timer); resolve(url); } };
      server!.stdout!.on("data", collect); server!.stderr!.on("data", collect);
      server!.once("error", (error) => { clearTimeout(timer); reject(error); });
      server!.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Сервер завершился ${code}: ${output}`)); });
    });
    const post = (path: string, data: unknown, cookie = "", origin = env.APP_URL) => fetch(base + path, { method: "POST", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(data), redirect: "manual" });
    const get = (path: string, cookie = "", rsc = false) => fetch(base + path, { headers: { Cookie: cookie, "User-Agent": "Twitterbot", ...(rsc ? { RSC: "1" } : {}) }, redirect: "manual" });
    const login = async (id: string, returnTo?: string) => {
      const response = await post("/api/account/login", { email: `${id}@example.test`, password, returnTo });
      assert.equal(response.status, 200);
      return { cookie: response.headers.get("set-cookie")!.split(";")[0], redirect: (await response.json()).redirect };
    };
    const owner = await login("owner", `/contests/${slug}`);
    assert.equal(owner.redirect, `/contests/${slug}`);
    const other = await login("other", "//evil.test"); assert.equal(other.redirect, "/account");
    const unverified = await login("unverified");
    assert.equal((await get("/account/my-stories")).headers.get("location"), "/login");
    assert.equal((await get("/account/my-stories", unverified.cookie)).headers.get("location"), "/registration-status");
    assert.match(await (await get("/account/my-stories", owner.cookie)).text(), /У вас пока нет работ/);
    assert.match((await get(`/contests/${slug}/submit`)).headers.get("location")!, /\/login\?returnTo=/);
    const openForm = await get(`/contests/${slug}/submit`, owner.cookie);
    assert.equal(openForm.status, 200); assert.match(await openForm.text(), /Сохранить работу/);
    const content: s.StoryContent = [
      { type: "paragraph", children: [{ text: "Я🙂", bold: true }, { text: "e\u0301", italic: true }] },
      { type: "paragraph", children: [{ text: "Z", bold: true, italic: true }] },
    ];
    const input = { slug, title: "Личная тайна автора", content, length: 1, userId: "other", status: "admitted", publishedAt: new Date().toISOString() };
    assert.equal((await post("/api/stories/save", input)).status, 401);
    assert.equal((await post("/api/stories/save", input, owner.cookie, "https://evil.test")).status, 403);
    assert.equal((await post("/api/stories/save", input, unverified.cookie)).status, 403);
    const saved = await post("/api/stories/save", input, owner.cookie);
    assert.equal(saved.status, 200); assert.match(saved.headers.get("cache-control")!, /private, no-store/);
    const first = await saved.json(); assert.equal(first.length, countStoryText(content));
    const [stored] = await db.select().from(s.stories).where(eq(s.stories.id, first.id));
    assert.equal(stored.status, "submitted"); assert.equal(stored.publishedAt, null); assert.equal(stored.lengthAlgorithm, LENGTH_ALGORITHM); assert.deepEqual(stored.content, content);
    const [participation] = await db.select().from(s.participations).where(eq(s.participations.id, stored.participationId)); assert.equal(participation.userId, "owner");
    const privatePage = await get(`/account/my-stories/${first.id}`, owner.cookie);
    assert.match(privatePage.headers.get("cache-control")!, /private.*no-store/);
    assert.match(await privatePage.text(), /<strong>Я🙂<\/strong>/);
    for (const rsc of [false, true]) {
      for (const suffix of ["", "/edit"]) {
        const foreign = await (await get(`/account/my-stories/${first.id}${suffix}`, other.cookie, rsc)).text();
        assert.doesNotMatch(foreign, /Личная тайна автора|Я🙂/);
      }
      const unpublished = await (await get(`/contests/${slug}/stories/${first.id}`, "", rsc)).text();
      assert.doesNotMatch(unpublished, /Личная тайна автора|Я🙂|owner@example|participationId/);
    }
    assert.equal((await post("/api/stories/save", { ...input, id: first.id, revision: 1 }, other.cookie)).status, 404);
    assert.equal((await post("/api/stories/withdraw", { id: first.id, revision: 1, confirmed: true }, other.cookie)).status, 404);
    for (const [text, status] of [["1234", 400], ["12345", 200], ["12345678", 200], ["123456789", 400]] as const) assert.equal((await post("/api/stories/save", { slug, title: `Граница ${text.length}`, content: paragraph(text) }, owner.cookie)).status, status);
    const edit = await post("/api/stories/save", { ...input, id: first.id, revision: 1, title: "Изменённый собственный рассказ" }, owner.cookie);
    assert.equal(edit.status, 200);
    const [edited] = await db.select().from(s.stories).where(eq(s.stories.id, first.id));
    assert.equal(+edited.createdAt, +stored.createdAt); assert.ok(+edited.updatedAt >= +stored.updatedAt); assert.equal(edited.revision, 2);
    const concurrent = await Promise.all([1, 2].map((n) => post("/api/stories/save", { ...input, id: first.id, revision: 2, title: `Окно ${n}` }, owner.cookie)));
    assert.deepEqual(concurrent.map((response) => response.status).sort(), [200, 409]);
    const many = await Promise.all(Array.from({ length: 8 }, (_, n) => post("/api/stories/save", { slug, title: `Неограниченная подача ${n}`, content: paragraph("123456") }, other.cookie)));
    assert.ok(many.every((response) => response.status === 200));
    assert.equal((await db.select().from(s.participations).where(eq(s.participations.userId, "other"))).length, 1);
    await db.update(s.contests).set({ minLength: 0, maxLength: 0 }).where(eq(s.contests.slug, slug));
    assert.equal((await post("/api/stories/save", { slug, title: "Без конкурсного предела", content: paragraph("a".repeat(20001)) }, owner.cookie)).status, 200);
    assert.equal((await post("/api/stories/save", { slug, title: "Нет текста", content: paragraph(" ") }, owner.cookie)).status, 400);
    assert.equal((await post("/api/stories/save", { slug, title: "HTML", content: [{ type: "html", children: [] }] }, owner.cookie)).status, 400);
    const [contest] = await db.select().from(s.contests).where(eq(s.contests.slug, slug));
    // Форма была открыта выше; сервер всё равно отвергает запрос после дедлайна.
    await db.update(s.contests).set({ submissionsEndAt: new Date(Date.now() - 1) }).where(eq(s.contests.id, contest.id));
    assert.equal((await post("/api/stories/save", input, owner.cookie)).status, 409);
    assert.equal((await post("/api/stories/save", { ...input, id: first.id, revision: 3 }, owner.cookie)).status, 409);
    await db.update(s.contests).set({ submissionsEndAt: contest.submissionsEndAt, stage: "moderation" }).where(eq(s.contests.id, contest.id));
    assert.equal((await post("/api/stories/save", input, owner.cookie)).status, 409);
    assert.equal((await post("/api/stories/withdraw", { id: first.id, revision: 3, confirmed: true }, owner.cookie)).status, 409);
    await db.update(s.contests).set({ stage: "submissions" }).where(eq(s.contests.id, contest.id));
    for (const status of ["draft", "rejected", "admitted"] as const) {
      await db.update(s.stories).set({ status }).where(eq(s.stories.id, first.id));
      assert.equal((await post("/api/stories/save", { ...input, id: first.id, revision: 3 }, owner.cookie)).status, 409);
    }
    await db.update(s.stories).set({ status: "submitted" }).where(eq(s.stories.id, first.id));
    assert.equal((await post("/api/stories/withdraw", { id: first.id, revision: 3 }, owner.cookie)).status, 400);
    assert.equal((await post("/api/stories/withdraw", { id: first.id, revision: 2, confirmed: true }, owner.cookie)).status, 409);
    const count = (await db.select().from(s.stories)).length;
    assert.equal((await post("/api/stories/withdraw", { id: first.id, revision: 3, confirmed: true }, owner.cookie)).status, 200);
    assert.equal((await db.select().from(s.stories)).length, count);
    const [withdrawn] = await db.select().from(s.stories).where(eq(s.stories.id, first.id));
    assert.equal(withdrawn.status, "withdrawn"); assert.deepEqual(withdrawn.content, content);
    assert.equal((await post("/api/stories/save", { ...input, id: first.id, revision: 4 }, owner.cookie)).status, 409);
    assert.equal((await post("/api/stories/restore", { id: first.id }, owner.cookie)).status, 404);
    // Отдельная работа в финале: снятие не переписывает историю первого тура.
    const finalResponse = await post("/api/stories/save", { slug, title: "Финальная анонимная работа", content: paragraph("Текст финалиста") }, owner.cookie);
    const finalist = await finalResponse.json(); assert.equal(finalResponse.status, 200);
    const now = Date.now();
    await db.update(s.contests).set({ stage: "round-two", submissionsEndAt: new Date(now - 3000), roundOneStartAt: new Date(now - 2000), roundTwoStartAt: new Date(now - 1000) }).where(eq(s.contests.id, contest.id));
    await db.update(s.stories).set({ status: "admitted", publishedAt: new Date(now - 1000) }).where(eq(s.stories.id, finalist.id));
    for (const round of [1, 2]) {
      const groupId = `test-group-${round}`;
      await db.insert(s.contestGroups).values({ id: groupId, contestId: contest.id, round, number: 1, capacity: 20, publishedAt: new Date(now - 1000) });
      await db.insert(s.storyRounds).values({ storyId: finalist.id, contestId: contest.id, round, groupId });
      const [voter] = await db.select().from(s.participations).where(and(eq(s.participations.userId, "other"), eq(s.participations.contestId, contest.id)));
      await db.insert(s.ballots).values({ id: `test-ballot-${round}`, participationId: voter.id, contestId: contest.id, round, groupId, createdAt: new Date(), updatedAt: new Date() });
      await db.insert(s.ballotEntries).values({ ballotId: `test-ballot-${round}`, storyId: finalist.id, contestId: contest.id, round, groupId, position: 1 });
    }
    const publicText = await (await get(`/contests/${slug}/stories/${finalist.id}`)).text();
    assert.match(publicText, /Финальная анонимная работа/); assert.doesNotMatch(publicText, /owner@example|unverified@example|participationId|passwordHash/);
    assert.equal((await post("/api/stories/withdraw", { id: finalist.id, revision: 1, confirmed: true }, owner.cookie)).status, 200);
    const rounds = await db.select().from(s.storyRounds).where(eq(s.storyRounds.storyId, finalist.id));
    assert.equal(rounds.find((row) => row.round === 1)?.status, "active"); assert.equal(rounds.find((row) => row.round === 2)?.status, "withdrawn");
    assert.equal((await db.select().from(s.ballotEntries)).length, 2);
    assert.doesNotMatch(await (await get(`/contests/${slug}/stories/${finalist.id}`)).text(), /Финальная анонимная работа|Текст финалиста/);
    assert.match(await (await get("/account/my-stories", owner.cookie)).text(), /Снята в турах: 2/);
    assert.deepEqual((await client.execute("PRAGMA foreign_key_check")).rows, []);
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) { const exited = once(server, "exit"); server.kill("SIGTERM"); await exited; }
    client.close(); await rm(directory, { recursive: true, force: true });
  }
});
