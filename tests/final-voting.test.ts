import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { migrate } from "drizzle-orm/libsql/migrator";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { hash } from "@node-rs/argon2";
import { unzipSync, strFromU8 } from "fflate";
import { openDatabase } from "../src/db/connection";
import { getDatabase } from "../src/db";
import * as s from "../src/db/schema";
import { seedClosureDemo } from "../scripts/demo-closure-data";
import { closeFirstRound } from "../src/contests/close-first-round";
import { prepareFinal } from "../src/contests/prepare-final";
import { myBallot, changeBallot, coordinatorVotingStatuses } from "../src/voting/service";
import { withdrawStory } from "../src/stories/service";
import { AuthError, tokenHash } from "../src/auth/service";

const root = "demo-final-voting";
const sid = (n: number) => `${root}-story-${n}`;
const pid = (n: number) => `${root}-member-${n}`;
const fails = (promise: Promise<unknown>, status: number) => assert.rejects(promise, (error) => error instanceof AuthError && error.status === status);

test("финальное голосование: допуск из снимка, независимые туры, миграция, снятия, сроки и приватность", { timeout: 120000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grelqa-final-voting-"));
  const env = { ...process.env, DATABASE_URL: `file:${path.join(directory, "test.db")}`, EXPORT_CACHE_DIRECTORY: path.join(directory, "exports"),
    SESSION_SECRET: "final-voting-tests-secret-with-at-least-thirty-two-characters", APP_URL: "https://grelqa.test", SITE_URL: "https://grelqa.test",
    MAIL_MODE: "smtp", SMTP_HOST: "127.0.0.1", SMTP_PORT: "9", MAIL_FROM: "test@grelqa.test" };
  const oldEnv = { mode: process.env.NODE_ENV, url: process.env.DATABASE_URL };
  Object.assign(process.env, { NODE_ENV: "development", DATABASE_URL: env.DATABASE_URL });
  const connection = await openDatabase(env.DATABASE_URL); const { db } = connection;
  let server: ReturnType<typeof spawn> | undefined;
  try {
    await migrate(db, { migrationsFolder: "drizzle" });
    await seedClosureDemo(db, root); const closure = await closeFirstRound(db, root);
    // Upgrade a populated v0005 database, including old draft revisions and receipt payload hashes.
    const legacy = await openDatabase(`file:${path.join(directory, "legacy.db")}`);
    try {
      const oldFolder = path.join(directory, "old-migrations"); await mkdir(path.join(oldFolder, "meta"), { recursive: true });
      const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8")); journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 6);
      await writeFile(path.join(oldFolder, "meta/_journal.json"), JSON.stringify(journal));
      for (const entry of journal.entries) await copyFile(`drizzle/${entry.tag}.sql`, path.join(oldFolder, `${entry.tag}.sql`));
      await migrate(legacy.db, { migrationsFolder: oldFolder });
      for (const table of ["users", "contests", "contest_themes", "contest_groups", "participations", "stories", "story_rounds", "ballots", "ballot_entries", "ballot_drafts", "first_round_formations", "first_round_closures"]) {
        const names = (await legacy.client.execute(`PRAGMA table_info(${table})`)).rows.map((row) => String(row.name));
        for (const row of (await connection.client.execute(`SELECT ${names.join(",")} FROM ${table} ORDER BY rowid`)).rows) await legacy.client.execute({ sql: `INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`, args: names.map((_, i) => row[i]) });
      }
      await legacy.client.execute({ sql: "INSERT INTO ballot_requests(participation_id,request_id,payload_hash,response,received_at) VALUES(?,?,?,?,?)", args: [pid(1), "old-receipt", "old-hash", '{"revision":7,"message":"old","submittedAt":null}', Date.now()] });
      const oldDrafts = (await legacy.client.execute("SELECT * FROM ballot_drafts ORDER BY participation_id")).rows;
      const oldReceipts = (await legacy.client.execute("SELECT participation_id,request_id,payload_hash,response,received_at FROM ballot_requests")).rows;
      await migrate(legacy.db, { migrationsFolder: "drizzle" }); await migrate(legacy.db, { migrationsFolder: "drizzle" });
      assert.deepEqual((await legacy.client.execute("SELECT * FROM ballot_drafts ORDER BY participation_id")).rows, oldDrafts);
      assert.deepEqual((await legacy.client.execute("SELECT participation_id,request_id,payload_hash,response,received_at FROM ballot_requests")).rows, oldReceipts);
      assert.equal((await legacy.client.execute("SELECT round FROM ballot_requests")).rows[0].round, 1);
      assert.deepEqual((await legacy.client.execute("PRAGMA foreign_key_check")).rows, []);
    } finally { legacy.client.close(); }
    const first = { ballots: await db.select().from(s.ballots), entries: await db.select().from(s.ballotEntries), drafts: await db.select().from(s.ballotDrafts), rounds: await db.select().from(s.storyRounds), closure: await db.select().from(s.firstRoundClosures) };
    const admission = await prepareFinal(db, root);
    assert.equal(admission.storyIds.length, 9); assert.equal(admission.members.length, 5);
    assert.equal(admission.sourceHash, createHash("sha256").update(JSON.stringify(closure)).digest("hex"));
    assert.deepEqual(await prepareFinal(db, root), admission);
    assert.deepEqual(await db.select().from(s.firstRoundClosures), first.closure);
    assert.deepEqual(await db.select().from(s.ballots), first.ballots); assert.deepEqual(await db.select().from(s.ballotDrafts), first.drafts);
    const tokens = Array.from({ length: 7 }, () => randomBytes(32).toString("hex"));
    for (let n = 1; n <= 7; n++) await db.insert(s.authSessions).values({ tokenHash: tokenHash("session", tokens[n - 1]), userId: `${root}-author-${n}`, createdAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) });
    const owner = tokens[0], multi = tokens[6];
    const view = await myBallot(owner, root, 2);
    assert.ok(view.open); assert.equal(view.round, 2); assert.equal(view.available.length, 8); assert.equal(view.required, 6);
    assert.equal(view.selected.length, 0); assert.equal(view.submitted.length, 0); assert.equal(view.revision, 0, "первый тур не переносится");
    const multiple = await myBallot(multi, root, 2); assert.equal(multiple.required, 4); assert.ok(multiple.available.every((row) => ![11, 12, 13, 14, 15].map(sid).includes(row.id)));
    await db.update(s.participations).set({ finalist: true }).where(eq(s.participations.id, pid(4)));
    await fails(myBallot(tokens[3], root, 2), 403);
    await db.update(s.participations).set({ finalist: false }).where(eq(s.participations.id, pid(4)));
    await db.update(s.stories).set({ status: "draft" }).where(eq(s.stories.id, sid(15)));
    assert.ok(!(await myBallot(owner, root, 2)).available.some((row) => row.id === sid(15)));
    await db.update(s.stories).set({ status: "admitted" }).where(eq(s.stories.id, sid(15))); await fails(myBallot(tokens[4], root, 2), 403); await fails(myBallot(undefined, root, 2), 403);
    const doChange = async (token: string, action: "draft" | "submit" | "add", selected: string[], requestId = randomUUID()) => {
      const state = await myBallot(token, root, 2);
      return changeBallot(token, action, { slug: root, revision: state.revision, requestId, selections: selected }, new Date(), 2);
    };
    await fails(changeBallot(owner, "draft", { slug: root, revision: 0, requestId: randomUUID(), selections: [] }, new Date(+new Date(admission.preparedAt) - 1), 2), 409);
    const chosen = [sid(2), sid(3), sid(7), sid(11), sid(12), sid(13)];
    for (const invalid of [[sid(1)], [sid(4)], [sid(5)], [sid(2), sid(2)], ["missing"]]) await fails(doChange(owner, "draft", invalid), 400);
    await doChange(owner, "draft", chosen.slice(0, 2));
    assert.equal((await myBallot(owner, root, 2)).submittedAt, null);
    assert.deepEqual((await myBallot(owner, root, 1)).selected.map((row) => row.id), [sid(4), sid(3)]);
    await fails(doChange(owner, "submit", chosen.slice(0, 5)), 400);
    const sharedRequestId = randomUUID();
    await db.insert(s.ballotRequests).values({ participationId: pid(1), round: 1, requestId: sharedRequestId, payloadHash: "first-round-only", response: { revision: 1, message: "old", submittedAt: null }, receivedAt: new Date() });
    const submitted = await doChange(owner, "submit", chosen, sharedRequestId);
    const secondRows = await db.select().from(s.ballots).where(and(eq(s.ballots.participationId, pid(1)), eq(s.ballots.round, 2))); assert.equal(secondRows.length, 1);
    await doChange(owner, "draft", [...chosen].reverse().slice(0, 3));
    assert.deepEqual((await myBallot(owner, root, 2)).submitted.map((row) => row.id), chosen); assert.equal((await myBallot(owner, root, 2)).submittedAt, submitted.submittedAt);
    await doChange(owner, "submit", [...chosen].reverse());
    const rev = (await myBallot(owner, root, 2)).revision;
    const race = await Promise.allSettled([0, 1].map((n) => changeBallot(owner, "draft", { slug: root, revision: rev, requestId: randomUUID(), selections: [chosen[n]] }, new Date(), 2)));
    assert.equal(race.filter((row) => row.status === "fulfilled").length, 1); assert.equal(race.filter((row) => row.status === "rejected" && row.reason.status === 409).length, 1);
    const replay = { slug: root, revision: (await myBallot(owner, root, 2)).revision, requestId: randomUUID(), selections: chosen };
    const replayed = await Promise.all([1, 2].map(() => changeBallot(owner, "submit", replay, new Date(), 2))); assert.deepEqual(replayed[0], replayed[1]);
    await fails(changeBallot(owner, "draft", replay, new Date(), 2), 409);
    for (const n of [11, 12, 13, 14, 15]) await fails(doChange(multi, "draft", [sid(n)]), 400);
    await fails(doChange(multi, "submit", multiple.available.slice(0, 3).map((row) => row.id)), 400);
    await doChange(multi, "submit", multiple.available.map((row) => row.id));
    assert.equal((await db.select().from(s.ballots).where(and(eq(s.ballots.participationId, pid(7)), eq(s.ballots.round, 2)))).length, 1);
    const beforeRemoval = await myBallot(multi, root, 2);
    const [own] = await db.select().from(s.stories).where(eq(s.stories.id, sid(1)));
    await withdrawStory(owner, own.id, own.revision);
    const afterRemoval = await myBallot(multi, root, 2);
    assert.equal(afterRemoval.submittedAt, beforeRemoval.submittedAt);
    assert.deepEqual(afterRemoval.submitted.map(({ id, position }) => ({ id, position })), beforeRemoval.submitted.map(({ id, position }) => ({ id, position })));
    assert.ok(afterRemoval.submitted.find((row) => row.id === sid(1))?.unavailable);
    await fails(doChange(multi, "submit", beforeRemoval.submitted.map((row) => row.id)), 400);
    await doChange(multi, "submit", afterRemoval.available.map((row) => row.id));
    const ownGone = await myBallot(owner, root, 2);
    assert.equal(ownGone.open, false); assert.ok(ownGone.rightsEnded); assert.equal(ownGone.exempt, false);
    assert.match(ownGone.blockedMessage!, /Право и обязанность.*прекращены/);
    await fails(doChange(owner, "draft", chosen.slice(0, 1)), 403);
    const [revoked] = await db.select().from(s.participations).where(eq(s.participations.id, pid(1)));
    assert.ok(revoked.roundTwoRightsEndedAt); assert.equal(revoked.mustVoteRoundTwo, false); assert.equal(revoked.roundTwoExemptAt, null);
    assert.equal((await myBallot(owner, root, 2)).submittedAt, replayed[0].submittedAt, "отзыв права не удаляет сохранённую отправку");
    assert.equal((await coordinatorVotingStatuses(owner, root, 2)).find((row) => row.participationId === pid(1))?.status, "rights-ended");
    // Remove every foreign finalist for voter 2 before it has ever submitted: explicit exemption, no fake ballot.
    for (const n of [3, 7, 11, 12, 13, 14, 15]) {
      const [row] = await db.select().from(s.stories).where(eq(s.stories.id, sid(n)));
      const ownerIndex = Number(row.participationId.split("-").at(-1)); await withdrawStory(tokens[ownerIndex - 1], row.id, row.revision);
    }
    const exempt = await myBallot(tokens[1], root, 2); assert.ok(exempt.exempt); assert.equal(exempt.required, 0);
    assert.equal((await db.select().from(s.ballots).where(and(eq(s.ballots.participationId, pid(2)), eq(s.ballots.round, 2)))).length, 0);
    const [savedMember] = await db.select().from(s.participations).where(eq(s.participations.id, pid(2))); assert.equal(savedMember.mustVoteRoundTwo, false); assert.ok(savedMember.roundTwoExemptAt);
    assert.deepEqual(await db.select().from(s.storyRounds).where(eq(s.storyRounds.round, 1)), first.rounds);
    assert.deepEqual(await db.select().from(s.ballots).where(eq(s.ballots.round, 1)), first.ballots);
    assert.deepEqual(await db.select().from(s.ballotEntries).where(eq(s.ballotEntries.round, 1)), first.entries);
    assert.deepEqual(await db.select().from(s.ballotDrafts).where(eq(s.ballotDrafts.round, 1)), first.drafts);
    assert.deepEqual(await db.select().from(s.firstRoundClosures), first.closure);
    await db.update(s.storyRounds).set({ status: "active", withdrawnAt: null, withdrawalReason: null }).where(eq(s.storyRounds.round, 2));
    await db.update(s.participations).set({ roundTwoRightsEndedAt: null, mustVoteRoundTwo: true, roundTwoExemptAt: null, roundTwoExemptReason: null }).where(and(eq(s.participations.contestId, root), inArray(s.participations.id, admission.members.map((row) => row.participationId))));
    const [contest] = await db.select().from(s.contests).where(eq(s.contests.id, root));
    await db.update(s.contests).set({ roundTwoStartAt: new Date(Date.now() + 86400_000) }).where(eq(s.contests.id, root));
    assert.equal((await myBallot(owner, root, 2)).open, false); await fails(doChange(owner, "draft", chosen.slice(0, 1)), 409);
    await db.update(s.contests).set({ roundTwoStartAt: contest.roundTwoStartAt }).where(eq(s.contests.id, root));
    const edge = { slug: root, revision: (await myBallot(owner, root, 2)).revision, requestId: randomUUID(), selections: chosen };
    await fails(changeBallot(owner, "submit", edge, contest.endsAt, 2), 409);
    await changeBallot(owner, "submit", edge, new Date(+contest.endsAt - 1), 2);
    assert.equal((await myBallot(owner, root, 2)).submittedAt, new Date(+contest.endsAt - 1).toISOString());
    const states = await coordinatorVotingStatuses(owner, root, 2); assert.ok(states.every((row) => Object.keys(row).sort().join(",") === "participationId,status"));
    await fails(coordinatorVotingStatuses(tokens[1], root, 2), 403);
    // One-round and failed snapshots cannot produce a final vote.
    for (const mode of ["single", "failed"] as const) {
      const other = `demo-final-${mode}`; await seedClosureDemo(db, other); const result = await closeFirstRound(db, other);
      if (mode === "single") { result.settings.singleRound = true; await db.update(s.firstRoundClosures).set({ snapshot: result }).where(eq(s.firstRoundClosures.contestId, other)); }
      else await db.update(s.contests).set({ stage: "failed", failureReason: "one-author" }).where(eq(s.contests.id, other));
      await assert.rejects(prepareFinal(db, other));
    }
    await db.update(s.users).set({ emailVerifiedAt: null }).where(eq(s.users.id, `${root}-author-3`));
    await fails(myBallot(tokens[2], root, 2), 403);
    await db.update(s.users).set({ emailVerifiedAt: new Date() }).where(eq(s.users.id, `${root}-author-3`));
    // A multi-group first round can produce finalists from only one author; final still starts with exemption.
    const solo = "demo-final-sole-author"; await seedClosureDemo(db, solo);
    await db.update(s.contests).set({ finalCapacity: 3 }).where(eq(s.contests.id, solo));
    const ss = (n: number) => `${solo}-story-${n}`;
    for (const [n, selected] of new Map([[1, [5, 2, 3, 4]], [2, [5, 1, 3, 4]], [3, [5, 1, 2, 4]], [4, [5, 1, 2, 3]]])) {
      await db.delete(s.ballotEntries).where(eq(s.ballotEntries.ballotId, `${solo}-ballot-${n}`));
      for (const [i, chosenId] of selected.entries()) await db.insert(s.ballotEntries).values({ ballotId: `${solo}-ballot-${n}`, storyId: ss(chosenId), contestId: solo, groupId: `${solo}-group-1`, round: 1, position: i + 1 });
    }
    const [soloContest] = await db.select().from(s.contests).where(eq(s.contests.id, solo));
    const soloSentAt = new Date(+soloContest.roundTwoStartAt! - 3600000);
    await db.insert(s.ballots).values({ id: `${solo}-ballot-5`, participationId: `${solo}-member-5`, contestId: solo, groupId: `${solo}-group-1`, round: 1, createdAt: soloSentAt, updatedAt: soloSentAt, submittedAt: soloSentAt });
    for (let n = 1; n <= 4; n++) await db.insert(s.ballotEntries).values({ ballotId: `${solo}-ballot-5`, storyId: ss(n), contestId: solo, groupId: `${solo}-group-1`, round: 1, position: n });
    for (let n = 11; n <= 15; n++) await db.update(s.storyRounds).set({ status: "withdrawn", withdrawnAt: soloSentAt, withdrawalReason: "Снята автором" }).where(and(eq(s.storyRounds.storyId, ss(n)), eq(s.storyRounds.round, 1)));
    const soloFirst = await closeFirstRound(db, solo); assert.equal(soloFirst.outcome, "results");
    const onlyAuthor = await prepareFinal(db, solo); assert.equal(onlyAuthor.members.length, 1); assert.deepEqual(onlyAuthor.storyIds.sort(), [ss(5), ss(6)].sort());
    const soloToken = randomBytes(32).toString("hex");
    await db.insert(s.authSessions).values({ tokenHash: tokenHash("session", soloToken), userId: `${solo}-author-5`, createdAt: new Date(), expiresAt: new Date(Date.now() + 3600000) });
    const soloView = await myBallot(soloToken, solo, 2); assert.ok(soloView.exempt); assert.equal(soloView.required, 0); assert.equal(soloView.rightsEnded, false);
    assert.equal((await db.select().from(s.contests).where(eq(s.contests.id, solo)))[0].stage, "round-two");
    assert.equal((await db.select().from(s.ballots).where(and(eq(s.ballots.contestId, solo), eq(s.ballots.round, 2)))).length, 0);
    await fails(changeBallot(soloToken, "submit", { slug: solo, revision: 0, requestId: randomUUID(), selections: [] }, new Date(), 2), 409);
    assert.deepEqual((await db.select().from(s.firstRoundClosures).where(eq(s.firstRoundClosures.contestId, solo)))[0].snapshot, soloFirst);
    const password = "final-tests-only password 123";
    for (const n of [1, 4]) await db.update(s.users).set({ passwordHash: await hash(password) }).where(eq(s.users.id, `${root}-author-${n}`));
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "0"], { env, stdio: ["ignore", "pipe", "pipe"] });
    const base = await new Promise<string>((resolve, reject) => {
      let output = ""; const timer = setTimeout(() => reject(new Error(output)), 30000);
      const collect = (chunk: Buffer) => { output += chunk; const url = output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1]; if (url && output.includes("Ready")) { clearTimeout(timer); resolve(url); } };
      server!.stdout!.on("data", collect); server!.stderr!.on("data", collect); server!.once("error", reject); server!.once("exit", () => { clearTimeout(timer); reject(new Error(output)); });
    });
    async function login(n: number) { const response = await fetch(base + "/api/account/login", { method: "POST", headers: { Origin: env.APP_URL, "Content-Type": "application/json" }, body: JSON.stringify({ email: `${root}-${n}@grelqa.example`, password }) }); assert.equal(response.status, 200); return response.headers.get("set-cookie")!.split(";")[0]; }
    const cookie = await login(1), outsider = await login(4), ballotUrl = `${base}/contests/${root}/final-ballot`;
    assert.match((await fetch(ballotUrl, { redirect: "manual" })).headers.get("location")!, /login/);
    const page = await fetch(ballotUrl, { headers: { Cookie: cookie } }); assert.match(page.headers.get("cache-control")!, /private.*no-store/); assert.match(await page.text(), /Мой финальный бюллетень/);
    const foreign = await (await fetch(ballotUrl + `?participationId=${pid(1)}`, { headers: { Cookie: outsider } })).text(); assert.match(foreign, /только авторам/); assert.doesNotMatch(foreign, /Последняя успешная отправка|Бюллетень засчитан|selections/);
    const apiInput = { round: 2, slug: root, revision: (await myBallot(owner, root, 2)).revision, requestId: randomUUID(), selections: chosen.slice(0, 2) };
    const post = (body: unknown, auth = cookie, origin = env.APP_URL) => fetch(base + "/api/ballots/draft", { method: "POST", headers: { Cookie: auth, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await post(apiInput, "")).status, 401); assert.equal((await post(apiInput, outsider)).status, 403); assert.equal((await post(apiInput, cookie, "https://evil.test")).status, 403);
    assert.equal((await post(apiInput)).status, 200);
    for (const rsc of [false, true]) {
      const publicBody = await (await fetch(`${base}/contests/${root}`, { headers: rsc ? { RSC: "1" } : {} })).text();
      assert.match(publicBody, /Финальное голосование/); assert.match(publicBody, /Финал · Группа 1/);
      assert.doesNotMatch(publicBody, /member-|author-|ballot-|sourceHash|withdrawalRights|selections|grelqa\.example|payloadHash/);
    }
    const groupZip = await fetch(`${base}/contests/${root}/download?group=${admission.groupId}`); assert.equal(groupZip.status, 200);
    const archive = unzipSync(new Uint8Array(await groupZip.arrayBuffer())); assert.equal(Object.keys(archive).length, 9);
    for (const bytes of Object.values(archive)) assert.doesNotMatch(strFromU8(bytes), /grelqa\.example|member-|author-|ballot-|selections/);
    assert.ok(!Object.keys(archive).some((name) => name.includes("История 04")));
    for (const format of ["rss", "atom"]) { const body = await (await fetch(`${base}/${format}.xml`)).text(); assert.doesNotMatch(body, /member-|author-|ballot-|sourceHash|selections|grelqa\.example/); }
    await db.update(s.contests).set({ endsAt: new Date(Date.now() - 1) }).where(eq(s.contests.id, root));
    assert.equal((await post({ ...apiInput, revision: apiInput.revision + 1, requestId: randomUUID() })).status, 409);
    const after = await myBallot(owner, root, 2); assert.equal(after.open, false); assert.ok(after.hasDraft); assert.ok(after.submittedAt);
    const closedPage = await (await fetch(ballotUrl, { headers: { Cookie: cookie } })).text(); assert.match(closedPage, /Доступен просмотр/); assert.doesNotMatch(closedPage, />Отправить бюллетень</);
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) { const exit = once(server, "exit"); server.kill("SIGTERM"); await exit; }
    connection.client.close(); (await getDatabase()).client.close();
    if (oldEnv.mode === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: oldEnv.mode });
    if (oldEnv.url === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldEnv.url;
    await rm(directory, { recursive: true, force: true });
  }
});
