import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { hash } from "@node-rs/argon2";
import { openDatabase } from "../src/db/connection";
import * as s from "../src/db/schema";
import { tokenHash, AuthError } from "../src/auth/service";
import { myBallot, changeBallot, coordinatorVotingStatuses } from "../src/voting/service";
import { withdrawStory } from "../src/stories/service";
import { getDatabase } from "../src/db";

const slug = "demo-first-round-voting";
const story = (n: number) => `demo-vote-story-${n}`;
const member = (n: number) => `demo-vote-member-${n}`;
const fails = (promise: Promise<unknown>, status: number) => assert.rejects(promise, (error) => error instanceof AuthError && error.status === status);

test("первый тур: черновик, отправка, снятие, освобождение, дедлайн, конкуренция и приватный HTTP", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grelqa-voting-test-"));
  const env = { ...process.env, DATABASE_URL: `file:${path.join(directory, "test.db")}`, EXPORT_CACHE_DIRECTORY: path.join(directory, "exports"),
    SESSION_SECRET: "voting-tests-secret-with-at-least-thirty-two-characters", APP_URL: "https://grelqa.test", SITE_URL: "https://grelqa.test",
    MAIL_MODE: "smtp", SMTP_HOST: "127.0.0.1", SMTP_PORT: "9", MAIL_FROM: "test@grelqa.test" };
  const previousDb = process.env.DATABASE_URL; process.env.DATABASE_URL = env.DATABASE_URL;
  const connection = await openDatabase(env.DATABASE_URL); const { db } = connection;
  let server: ReturnType<typeof spawn> | undefined;
  try {
    for (const script of ["scripts/migrate.ts", "scripts/migrate.ts", "scripts/demo-voting.ts"]) execFileSync(process.execPath, ["--import", "tsx", script], { env: { ...env, NODE_ENV: "development" }, stdio: "pipe" });
    const before = await db.select().from(s.contests);
    execFileSync(process.execPath, ["--import", "tsx", "scripts/demo-voting.ts"], { env: { ...env, NODE_ENV: "development" }, stdio: "pipe" });
    assert.deepEqual(await db.select().from(s.contests), before);
    const tokens = Array.from({ length: 9 }, () => randomBytes(32).toString("hex"));
    for (let n = 1; n <= 9; n++) await db.insert(s.authSessions).values({ tokenHash: tokenHash("session", tokens[n - 1]), userId: `demo-vote-author-${n}`, createdAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) });
    const owner = tokens[0];
    const initial = await myBallot(owner, slug);
    assert.equal(initial.available.length, 8); assert.equal(initial.required, 6); assert.ok(initial.open);
    assert.ok(initial.available.every((item) => item.id !== story(1) && Number(item.id.split("-").at(-1)) < 10));
    const exempt = await myBallot(tokens[8], slug);
    assert.equal(exempt.required, 0); assert.ok(exempt.exempt);
    assert.equal((await db.select().from(s.ballots).where(eq(s.ballots.participationId, member(9)))).length, 0);
    assert.equal((await db.select().from(s.participations).where(eq(s.participations.id, member(9))))[0].mustVoteRoundOne, false);
    await fails(changeBallot(tokens[8], "submit", { slug, revision: 0, requestId: randomUUID(), selections: [] }, new Date()), 409);
    await fails(myBallot(undefined, slug), 403);
    const six = initial.available.slice(0, 6).map((item) => item.id);
    const send = async (action: "draft" | "submit" | "add", selections?: string[], extra: { storyId?: string } = {}) => {
      const state = await myBallot(owner, slug);
      return changeBallot(owner, action, { slug, revision: state.revision, requestId: randomUUID(), selections, ...extra }, new Date());
    };
    await send("draft", six.slice(0, 2));
    assert.ok((await myBallot(owner, slug)).hasDraft);
    assert.equal((await db.select().from(s.ballots)).length, 0, "черновик не выполняет голосование");
    await fails(send("submit", six.slice(0, 5)), 400);
    for (const invalid of [[story(1)], [story(10)], [six[0], six[0]], ["not-found"]]) await fails(send("draft", invalid), 400);
    await send("submit", six);
    const sent = (await db.select().from(s.ballots).where(eq(s.ballots.participationId, member(1))))[0];
    const savedEntries = await db.select().from(s.ballotEntries).where(eq(s.ballotEntries.ballotId, sent.id));
    assert.deepEqual(savedEntries.map((entry) => entry.position).sort(), [1, 2, 3, 4, 5, 6]);
    await send("draft", [...six].reverse().slice(0, 2));
    assert.deepEqual(await db.select().from(s.ballotEntries).where(eq(s.ballotEntries.ballotId, sent.id)), savedEntries);
    assert.equal(+(await db.select().from(s.ballots).where(eq(s.ballots.id, sent.id)))[0].submittedAt!, +sent.submittedAt!);
    await send("submit", [...six].reverse());
    assert.deepEqual((await myBallot(owner, slug)).submitted.map((entry) => entry.id), [...six].reverse());
    await fails(send("add", undefined, { storyId: initial.available[7].id }), 409);
    await send("add", undefined, { storyId: six[0] });
    assert.equal((await myBallot(owner, slug)).selected.length, 6, "повторное добавление не дублирует");
    await send("draft", []);
    await send("add", undefined, { storyId: six[0] });
    assert.deepEqual((await myBallot(owner, slug)).selected.map((entry) => entry.id), [six[0]]);
    const rev = (await myBallot(owner, slug)).revision;
    const concurrent = await Promise.allSettled([0, 1].map((index) => changeBallot(owner, "draft", { slug, revision: rev, requestId: randomUUID(), selections: [six[index]] }, new Date())));
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrent.filter((result) => result.status === "rejected" && result.reason.status === 409).length, 1);
    const replayInput = { slug, revision: (await myBallot(owner, slug)).revision, requestId: randomUUID(), selections: six };
    const replay = await Promise.all([1, 2].map(() => changeBallot(owner, "submit", replayInput, new Date())));
    assert.deepEqual(replay[0], replay[1]); assert.equal((await myBallot(owner, slug)).revision, replayInput.revision + 1);
    await fails(changeBallot(owner, "draft", { ...replayInput, selections: [six[0]] }, new Date()), 409);
    await send("draft", six.slice(0, 3));
    const beforeWithdrawal = await myBallot(owner, slug);
    const [victim] = await db.select().from(s.stories).where(eq(s.stories.id, six[1]));
    const author = Number(victim.participationId.split("-").at(-1));
    await withdrawStory(tokens[author - 1], victim.id, victim.revision);
    const afterWithdrawal = await myBallot(owner, slug);
    assert.equal(afterWithdrawal.submittedAt, beforeWithdrawal.submittedAt);
    assert.deepEqual(afterWithdrawal.submitted.map(({ id, position }) => ({ id, position })), beforeWithdrawal.submitted.map(({ id, position }) => ({ id, position })));
    assert.equal(afterWithdrawal.submitted[1].unavailable, true);
    assert.ok(afterWithdrawal.hasDraft); assert.equal(afterWithdrawal.selected[1].unavailable, true);
    await fails(send("draft", six), 400);
    await send("submit", afterWithdrawal.available.slice(0, 6).map((entry) => entry.id));
    // Three eligible foreign works: selecting two is invalid, all three is required.
    await db.update(s.storyRounds).set({ status: "withdrawn", withdrawnAt: new Date(), withdrawalReason: "Тест" }).where(and(eq(s.storyRounds.groupId, "demo-vote-group-1"), inArray(s.storyRounds.storyId, [story(6), story(7), story(8), story(9)])));
    const short = await myBallot(owner, slug); assert.equal(short.required, 3);
    await fails(send("submit", short.available.slice(0, 2).map((entry) => entry.id)), 400);
    await send("submit", short.available.map((entry) => entry.id));
    assert.equal((await myBallot(owner, slug)).submitted.length, 3);
    for (const item of short.available) {
      const [row] = await db.select().from(s.stories).where(eq(s.stories.id, item.id));
      await withdrawStory(tokens[Number(row.participationId.split("-").at(-1)) - 1], row.id, row.revision);
    }
    const noOthers = await myBallot(owner, slug); assert.ok(noOthers.exempt); assert.equal(noOthers.required, 0);
    assert.equal(noOthers.submitted.length, 3, "освобождение не стирает отправленную историю");
    assert.equal((await db.select().from(s.participations).where(eq(s.participations.id, member(1))))[0].roundOneExemptReason, "no-eligible-stories");
    // Restore only this test's fixtures for deadline/HTTP tests.
    await db.update(s.storyRounds).set({ status: "active", withdrawnAt: null, withdrawalReason: null }).where(eq(s.storyRounds.groupId, "demo-vote-group-1"));
    const reopened = await myBallot(owner, slug); assert.equal(reopened.exempt, false);
    const [contest] = await db.select().from(s.contests);
    const atDeadline = contest.roundTwoStartAt!;
    const boundaryInput = { slug, revision: reopened.revision, requestId: randomUUID(), selections: six };
    await fails(changeBallot(owner, "submit", boundaryInput, atDeadline), 409);
    await changeBallot(owner, "submit", boundaryInput, new Date(+atDeadline - 1));
    assert.equal((await myBallot(owner, slug)).submittedAt, new Date(+atDeadline - 1).toISOString());
    const statuses = await coordinatorVotingStatuses(owner, slug);
    assert.equal(statuses.find((row) => row.participationId === member(9))?.status, "exempt");
    assert.equal(statuses.find((row) => row.participationId === member(1))?.status, "submitted");
    assert.ok(statuses.every((row) => Object.keys(row).sort().join(",") === "participationId,status"));
    await fails(coordinatorVotingStatuses(tokens[1], slug), 403);
    await db.update(s.users).set({ emailVerifiedAt: null }).where(eq(s.users.id, "demo-vote-author-8"));
    await fails(myBallot(tokens[7], slug), 403);
    const password = "voting-test-only password 123";
    await db.update(s.users).set({ passwordHash: await hash(password) }).where(inArray(s.users.id, ["demo-vote-author-1", "demo-vote-author-2"]));
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "0"], { env, stdio: ["ignore", "pipe", "pipe"] });
    const base = await new Promise<string>((resolve, reject) => {
      let output = ""; const timer = setTimeout(() => reject(new Error(output)), 30000);
      const collect = (chunk: Buffer) => { output += chunk; const url = output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1]; if (url && output.includes("Ready")) { clearTimeout(timer); resolve(url); } };
      server!.stdout!.on("data", collect); server!.stderr!.on("data", collect); server!.once("error", reject); server!.once("exit", () => { clearTimeout(timer); reject(new Error(output)); });
    });
    const post = (action: string, data: unknown, cookie = "", origin = env.APP_URL) => fetch(base + "/api/ballots/" + action, { method: "POST", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(data) });
    async function login(n: number) {
      const response = await fetch(base + "/api/account/login", { method: "POST", headers: { Origin: env.APP_URL, "Content-Type": "application/json" }, body: JSON.stringify({ email: `voting-reader-${n}@grelqa.example`, password }) });
      assert.equal(response.status, 200); return response.headers.get("set-cookie")!.split(";")[0];
    }
    const cookie = await login(1), foreignCookie = await login(2);
    const pathName = `/contests/${slug}/ballot`;
    const anonymous = await fetch(base + pathName, { redirect: "manual" }); assert.match(anonymous.headers.get("location")!, /login/);
    const page = await fetch(base + pathName, { headers: { Cookie: cookie } });
    assert.match(page.headers.get("cache-control")!, /private.*no-store/); assert.match(await page.text(), /Мой бюллетень/);
    const foreign = await (await fetch(base + pathName + "?participationId=" + member(1), { headers: { Cookie: foreignCookie, RSC: "1" } })).text();
    assert.doesNotMatch(foreign, /Бюллетень засчитан|Последняя успешная отправка|payloadHash|tokenHash|voting-reader-/);
    const view = await myBallot(owner, slug);
    const payload = { slug, revision: view.revision, requestId: randomUUID(), selections: six };
    assert.equal((await post("draft", payload)).status, 401);
    assert.equal((await post("draft", payload, cookie, "https://evil.test")).status, 403);
    assert.equal((await post("draft", { ...payload, participationId: member(2) }, cookie)).status, 400);
    assert.equal((await post("draft", payload, cookie)).status, 200);
    await db.update(s.contests).set({ roundTwoStartAt: new Date(Date.now() - 1) }).where(eq(s.contests.id, contest.id));
    assert.equal((await post("submit", { ...payload, revision: payload.revision + 1, requestId: randomUUID() }, cookie)).status, 409);
    const closed = await (await fetch(base + pathName, { headers: { Cookie: cookie } })).text();
    assert.match(closed, /Доступен просмотр/); assert.doesNotMatch(closed, />Отправить бюллетень<|>Сохранить черновик</);
    assert.equal((await myBallot(owner, slug)).hasDraft, true);
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) { const exit = once(server, "exit"); server.kill("SIGTERM"); await exit; }
    connection.client.close(); (await getDatabase()).client.close();
    if (previousDb === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDb;
    await rm(directory, { recursive: true, force: true });
  }
});
