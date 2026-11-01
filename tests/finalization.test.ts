import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { migrate } from "drizzle-orm/libsql/migrator";
import { and, eq, inArray } from "drizzle-orm";
import { unzipSync, strFromU8 } from "fflate";
import { openDatabase } from "../src/db/connection";
import { getDatabase } from "../src/db";
import { writeTransaction } from "../src/db/write-transaction";
import * as s from "../src/db/schema";
import { seedCompletionDemo } from "../scripts/demo-completion-data";
import { seedClosureDemo } from "../scripts/demo-closure-data";
import { closeFirstRound } from "../src/contests/close-first-round";
import { finalizeContest } from "../src/contests/finalize";
import { publicFinalResults, ownFinalResults } from "../src/contests/final-results-queries";
import { getPublicStory, getPublicStoryGroups } from "../src/db/public-stories";
import { downloadArchive } from "../src/exports/service";
import { getContestFeed } from "../src/feeds/data";
import { serializeAtom } from "../src/feeds/atom";
import { serializeRss } from "../src/feeds/rss";
import { myBallot, changeBallot, coordinatorVotingStatuses } from "../src/voting/service";
import { tokenHash } from "../src/auth/service";

test("завершение: предрасчёт, санкции, снимки, публикация, ZIP/ленты, гонки и откат", { timeout: 180000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grelqa-finalization-"));
  const previous = { ...process.env };
  const env = { ...process.env, NODE_ENV: "development" as const, DATABASE_URL: `file:${path.join(directory, "test.db")}`, EXPORT_CACHE_DIRECTORY: path.join(directory, "exports"), SITE_URL: "https://grelqa.test", APP_URL: "https://grelqa.test", SESSION_SECRET: "finalization-test-secret-at-least-thirty-two-characters", MAIL_MODE: "smtp", SMTP_HOST: "127.0.0.1", SMTP_PORT: "9", MAIL_FROM: "test@grelqa.test" };
  Object.assign(process.env, env);
  const { db, client } = await openDatabase(env.DATABASE_URL);
  let server: ReturnType<typeof spawn> | undefined;
  const root = "demo-completed-contest";
  const sid = (n: number, slug = root) => `${slug}-story-${n}`;
  const pid = (n: number, slug = root) => `${slug}-member-${n}`;
  const fixture = async (slug: string) => { assert.equal(await seedCompletionDemo(db, slug), true); return slug; };
  const seal = (slug: string) => finalizeContest(db, slug);
  const finalRounds = (slug: string) => db.select().from(s.storyRounds).where(and(eq(s.storyRounds.contestId, slug), eq(s.storyRounds.round, 2)));
  const archiveText = (bytes: Uint8Array) => Object.values(unzipSync(bytes)).map((bytes) => strFromU8(bytes)).join("\n");
  try {
    await migrate(db, { migrationsFolder: "drizzle" }); await migrate(db, { migrationsFolder: "drizzle" });
    await fixture(root); assert.equal(await seedCompletionDemo(db, root), false);
    const [first] = await db.select().from(s.firstRoundClosures).where(eq(s.firstRoundClosures.contestId, root));
    const firstRows = await db.select().from(s.storyRounds).where(and(eq(s.storyRounds.contestId, root), eq(s.storyRounds.round, 1)));
    const allVotes = await db.select().from(s.ballots), allEntries = await db.select().from(s.ballotEntries), drafts = await db.select().from(s.ballotDrafts);
    // Deadline and a manually set completed stage alone do not disclose names.
    assert.equal(await publicFinalResults(root), undefined);
    assert.equal((await getPublicStory(root, sid(1)))?.authorName, null);
    await db.update(s.contests).set({ stage: "completed" }).where(eq(s.contests.id, root));
    assert.equal((await getPublicStory(root, sid(1)))?.authorName, null);
    await db.update(s.contests).set({ stage: "round-two" }).where(eq(s.contests.id, root));
    const oldZip = await downloadArchive(root); assert.ok(oldZip); assert.doesNotMatch(archiveText(oldZip.bytes), /Автор:|Репортёр/);
    const oldFeed = await getContestFeed(); const oldEntry = oldFeed.entries.find((e) => e.url.endsWith(root))!;
    const token = randomBytes(32).toString("hex");
    await db.insert(s.authSessions).values({ tokenHash: tokenHash("session", token), userId: `${root}-author-1`, createdAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) });
    const result = await seal(root); assert.equal(result.round, 2); assert.equal(result.tally.outcome, "results");
    const row = (n: number) => result.tally.results.find((r) => r.id === sid(n))!;
    assert.deepEqual([1, 3, 7].map((n) => [row(n).points, row(n).place]), [[16, 1], [12, 2], [8, 3]], "итог финала не включает первый тур 24/22/0 и альтернативный черновик");
    assert.deepEqual(result.winners, [sid(1)]);
    assert.deepEqual(result.tally.audit.nonVotingParticipationIds, [pid(2), pid(7)].sort());
    assert.ok([2, 11, 12, 13, 14, 15].every((n) => row(n).withdrawn && row(n).points === null && row(n).place === null));
    assert.ok((await finalRounds(root)).filter((r) => [2, 11, 12, 13, 14, 15].map((n) => sid(n)).includes(r.storyId)).every((r) => r.withdrawalReason === "not-voted-final-round" && r.withdrawnAt));
    assert.deepEqual(await db.select().from(s.ballots), allVotes); assert.deepEqual(await db.select().from(s.ballotEntries), allEntries); assert.deepEqual(await db.select().from(s.ballotDrafts), drafts);
    assert.deepEqual((await db.select().from(s.firstRoundClosures).where(eq(s.firstRoundClosures.contestId, root)))[0], first);
    assert.deepEqual(await db.select().from(s.storyRounds).where(and(eq(s.storyRounds.contestId, root), eq(s.storyRounds.round, 1))), firstRows);
    assert.equal(row(3).counts[1], 2, "снятая первая позиция не повышает вторую");
    assert.equal((await myBallot(token, root, 2)).open, false);
    await assert.rejects(changeBallot(token, "draft", { slug: root, requestId: randomUUID(), revision: 1, selections: [] }, new Date(Date.now() - 300000), 2), /Финал/);
    assert.equal((await coordinatorVotingStatuses(token, root, 2)).find((m) => m.participationId === pid(7))?.status, "not-voted");
    const publicResult = await publicFinalResults(root); assert.ok(publicResult);
    assert.doesNotMatch(JSON.stringify(publicResult), /grelqa\.example|author-\d|member-|audit|userId|participationId|counts|password|tokenHash/);
    assert.equal(publicResult.stories.find((r) => r.id === sid(1))?.authorName, "Репортёр 1");
    assert.equal(publicResult.stories.find((r) => r.id === sid(7))?.authorName, "Публичное имя не указано");
    assert.equal(publicResult.stories.find((r) => r.id === sid(2))?.authorName, null);
    assert.equal((await getPublicStory(root, sid(4)))?.authorName, "Репортёр 4", "нефиналисты тоже раскрываются после всего голосования");
    assert.equal(await getPublicStory(root, sid(2)), undefined);
    assert.ok((await getPublicStoryGroups(root)).flatMap((g) => g.stories).every((r) => r.authorName));
    const own = (await ownFinalResults(`${root}-author-7`)).find((r) => r.slug === root)!; assert.equal(own.stories.length, 5); assert.ok(own.stories.every((r) => r.withdrawalMessage));
    const newZip = await downloadArchive(root); assert.ok(newZip); assert.notDeepEqual(newZip.bytes, oldZip.bytes);
    assert.match(archiveText(newZip.bytes), /Автор: Репортёр 1/); assert.doesNotMatch(archiveText(newZip.bytes), /Репортёр 2|Репортёр 7|grelqa\.example/);
    const newFeed = await getContestFeed(); const entry = newFeed.entries.find((e) => e.url.endsWith(root))!;
    assert.equal(entry.id, oldEntry.id); assert.equal(+entry.published, +oldEntry.published); assert.equal(entry.updated.toISOString(), result.completedAt);
    assert.match(serializeAtom(newFeed), /опубликованы окончательные итоги/); assert.match(serializeRss(newFeed), /опубликованы окончательные итоги/);
    assert.deepEqual(await seal(root), result); assert.deepEqual(await getContestFeed(), newFeed);
    await db.update(s.users).set({ publicName: "Изменённое имя" }).where(eq(s.users.id, `${root}-author-1`));
    assert.equal((await getPublicStory(root, sid(1)))?.authorName, "Репортёр 1", "опубликованное имя берётся из снимка");
    // Even an erroneous return to an open stage cannot reopen a frozen ballot.
    await db.update(s.contests).set({ stage: "round-two", endsAt: new Date(Date.now() + 600000) }).where(eq(s.contests.id, root));
    await assert.rejects(changeBallot(token, "draft", { slug: root, requestId: randomUUID(), revision: 1, selections: [] }, new Date(), 2), /Финал/);
    await db.update(s.contests).set({ stage: "completed", endsAt: new Date(result.tally.deadline) }).where(eq(s.contests.id, root));

    // Fully equal top works share first, including identical position counts, without an ID tiebreak.
    const tied = await fixture("demo-final-tied");
    const [admission] = await db.select().from(s.finalRounds).where(eq(s.finalRounds.contestId, tied));
    await db.delete(s.ballotEntries).where(and(eq(s.ballotEntries.contestId, tied), eq(s.ballotEntries.round, 2)));
    await db.delete(s.ballots).where(and(eq(s.ballots.contestId, tied), eq(s.ballots.round, 2)));
    const [contest] = await db.select().from(s.contests).where(eq(s.contests.id, tied));
    for (const [n, choices] of [[1, [3, 2, 7, 11, 12, 13]], [3, [1, 2, 7, 11, 12, 13]], [6, [1, 3, 2, 11, 12, 13]], [7, [3, 1, 2, 7]]] as const) {
      const ballotId = `${tied}-final-${n}`, at = new Date(+contest.endsAt - 10000);
      await db.insert(s.ballots).values({ id: ballotId, contestId: tied, participationId: pid(n, tied), round: 2, groupId: admission.groupId, createdAt: at, updatedAt: at, submittedAt: at });
      for (const [i, nStory] of choices.entries()) await db.insert(s.ballotEntries).values({ ballotId, storyId: sid(nStory, tied), contestId: tied, groupId: admission.groupId, round: 2, position: i + 1 });
    }
    const shared = await seal(tied); assert.deepEqual(shared.winners.sort(), [sid(1, tied), sid(3, tied)].sort());
    assert.ok(shared.tally.results.filter((r) => shared.winners.includes(r.id)).every((r) => r.points === 26 && r.place === 1 && r.shared));
    assert.ok(shared.tally.results.some((r) => r.place === 2), "dense после двух первых идёт второе");
    // Exemption is frozen before removals; no new exemption after nonvoters are removed.
    const exempt = await fixture("demo-final-exempt");
    await db.update(s.participations).set({ mustVoteRoundTwo: false, roundTwoExemptAt: new Date(), roundTwoExemptReason: "no-eligible-stories" }).where(eq(s.participations.id, pid(7, exempt)));
    const exemption = await seal(exempt); assert.equal(exemption.tally.audit.members.find((m) => m.id === pid(7, exempt))?.votingStatus, "exempt");
    assert.ok(exemption.tally.results.filter((r) => [11, 12, 13, 14, 15].map((n) => sid(n, exempt)).includes(r.id)).every((r) => !r.withdrawn));
    for (const kind of ["none", "one-author"] as const) {
      const failed = await fixture(`demo-final-failed-${kind}`);
      await db.delete(s.ballotEntries).where(and(eq(s.ballotEntries.contestId, failed), eq(s.ballotEntries.round, 2)));
      await db.delete(s.ballots).where(and(eq(s.ballots.contestId, failed), eq(s.ballots.round, 2)));
      if (kind === "one-author") await db.update(s.participations).set({ mustVoteRoundTwo: false, roundTwoExemptAt: new Date(), roundTwoExemptReason: "no-eligible-stories" }).where(eq(s.participations.id, pid(7, failed)));
      const failure = await seal(failed); assert.equal(failure.tally.failureReason, kind === "none" ? "no-stories" : "one-author");
      assert.deepEqual(failure.winners, []); assert.deepEqual(failure.authors, []); assert.ok(failure.tally.results.every((r) => r.points === null && r.place === null));
      assert.equal(await getPublicStory(failed, sid(11, failed)), undefined);
      assert.equal(await downloadArchive(failed), undefined); assert.deepEqual(await seal(failed), failure);
    }
    // A previously withdrawn own field revokes duty; accepted sent votes still count.
    const revoked = await fixture("demo-final-revoked");
    await db.update(s.storyRounds).set({ status: "withdrawn", withdrawnAt: new Date(), withdrawalReason: "Снята автором" }).where(and(eq(s.storyRounds.storyId, sid(1, revoked)), eq(s.storyRounds.round, 2)));
    await db.update(s.participations).set({ mustVoteRoundTwo: false, roundTwoRightsEndedAt: new Date() }).where(eq(s.participations.id, pid(1, revoked)));
    const revokeResult = await seal(revoked); assert.ok(!revokeResult.tally.audit.nonVotingParticipationIds.includes(pid(1, revoked)));
    assert.equal(revokeResult.tally.audit.votes.length, 3); assert.equal(revokeResult.tally.results.find((r) => r.id === sid(3, revoked))?.points, 12);
    // Failed insertion rolls back stage, author disclosure and every sanction.
    const broken = await fixture("demo-final-rollback"); const before = await finalRounds(broken);
    await client.execute(`CREATE TRIGGER fail_finalization BEFORE INSERT ON contest_finalizations WHEN NEW.contest_id = '${broken}' BEGIN SELECT RAISE(ABORT, 'forced test failure'); END`);
    await assert.rejects(seal(broken)); assert.deepEqual(await finalRounds(broken), before);
    assert.equal((await db.select().from(s.contests).where(eq(s.contests.id, broken)))[0].stage, "round-two");
    assert.equal(await publicFinalResults(broken), undefined); assert.equal((await getPublicStory(broken, sid(1, broken)))?.authorName, null);
    await client.execute("DROP TRIGGER fail_finalization");
    // Cross-process concurrent callers return one unchanged persisted event.
    const race = await fixture("demo-final-race");
    const children = [1, 2, 3].map(() => spawn(process.execPath, ["--import", "tsx", "scripts/finalize-contest.ts", race], { env, stdio: "pipe" }));
    assert.deepEqual(await Promise.all(children.map(async (c) => (await once(c, "exit"))[0])), [0, 0, 0]);
    assert.equal((await db.select().from(s.contestFinalizations).where(eq(s.contestFinalizations.contestId, race))).length, 1);
    const frozen = await seal(race); assert.deepEqual(await seal(race), frozen);
    // An already accepting write commits before finalization; latest sent entries are used.
    const accepting = await fixture("demo-final-accepting"); let release!: () => void; let locked!: () => void;
    const started = new Promise<void>((resolve) => { locked = resolve; });
    const writer = writeTransaction(db, async (tx) => {
      const ballotId = `${accepting}-final-ballot-1`;
      await tx.delete(s.ballotEntries).where(eq(s.ballotEntries.ballotId, ballotId));
      const [admit] = await tx.select().from(s.finalRounds).where(eq(s.finalRounds.contestId, accepting));
      for (const [i, n] of [3, 2, 7, 11, 12, 13].entries()) await tx.insert(s.ballotEntries).values({ ballotId, storyId: sid(n, accepting), contestId: accepting, round: 2, groupId: admit.groupId, position: i + 1 });
      locked(); await new Promise<void>((resolve) => { release = resolve; });
    });
    await started; const closing = seal(accepting); await delay(50); release(); await writer;
    const accepted = await closing; assert.equal(accepted.tally.audit.votes.find((v) => v.id === `${accepting}-final-ballot-1`)?.entries[0].storyId, sid(3, accepting));
    const early = await fixture("demo-final-early"); await db.update(s.contests).set({ endsAt: new Date(Date.now() + 600000) }).where(eq(s.contests.id, early));
    await assert.rejects(seal(early), /дедлайн/); assert.equal(await publicFinalResults(early), undefined);
    // Single-round completion reuses the exact immutable first result, no fake final or repeated sanctions.
    const single = "demo-final-single"; await seedClosureDemo(db, single);
    await db.delete(s.ballotEntries).where(eq(s.ballotEntries.contestId, single)); await db.delete(s.ballots).where(eq(s.ballots.contestId, single));
    await db.update(s.participations).set({ mustVoteRoundOne: false, roundOneExemptAt: new Date(), roundOneExemptReason: "no-eligible-stories", assignedGroupId: `${single}-group-1` }).where(eq(s.participations.contestId, single));
    await db.update(s.storyRounds).set({ groupId: `${single}-group-1` }).where(eq(s.storyRounds.contestId, single));
    await db.delete(s.contestGroups).where(and(eq(s.contestGroups.contestId, single), inArray(s.contestGroups.number, [2, 3])));
    await db.update(s.contests).set({ roundTwoStartAt: null, endsAt: new Date(Date.now() - 1) }).where(eq(s.contests.id, single));
    const singleClosed = await closeFirstRound(db, single); const singleRows = await db.select().from(s.storyRounds).where(eq(s.storyRounds.contestId, single));
    const singleResult = await seal(single); assert.equal(singleResult.round, 1); assert.deepEqual(singleResult.tally, singleClosed);
    assert.deepEqual(await db.select().from(s.storyRounds).where(eq(s.storyRounds.contestId, single)), singleRows);
    assert.equal((await db.select().from(s.finalRounds).where(eq(s.finalRounds.contestId, single))).length, 0);
    // Public HTTP surfaces read the same finalized state with no private audit data.
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "0"], { env: { ...env, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; server.stdout!.on("data", (data) => { output += data; }); server.stderr!.on("data", (data) => { output += data; });
    let base = "";
    for (let attempt = 0; attempt < 200; attempt++) { const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/); if (match) { base = match[0]; try { if ((await fetch(base)).ok) break; } catch {} } await delay(100); }
    assert.ok(base, output);
    const page = await fetch(`${base}/contests/${root}`); const html = await page.text(); assert.equal(page.status, 200);
    assert.match(html, /Окончательные итоги/); assert.match(html, /Репортёр 1/); assert.match(html, /Победитель/); assert.match(html, /Итоги первого тура/);
    assert.doesNotMatch(html, /grelqa\.example|author-1|member-1|payloadHash|nonVotingParticipationIds|tokenHash/);
    const storyHtml = await (await fetch(`${base}/contests/${root}/stories/${sid(1)}`)).text(); assert.match(storyHtml, /Автор: Репортёр 1/);
    assert.equal((await fetch(`${base}/contests/${root}/stories/${sid(2)}`)).status, 404);
    const earlyHtml = await (await fetch(`${base}/contests/${early}`)).text(); assert.doesNotMatch(earlyHtml, /Репортёр/);
    for (const format of ["rss", "atom"]) { const response = await fetch(`${base}/${format}.xml`); assert.equal(response.status, 200); assert.match(await response.text(), /Конкурс завершён/); assert.equal(response.headers.get("cache-control"), "no-store"); }
    const zipResponse = await fetch(`${base}/contests/${root}/download`); assert.equal(zipResponse.status, 200); assert.match(archiveText(new Uint8Array(await zipResponse.arrayBuffer())), /Автор: Репортёр 1/);
    assert.deepEqual((await client.execute("pragma foreign_key_check")).rows, []);
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) { const exit = once(server, "exit"); server.kill("SIGTERM"); await exit; }
    client.close(); (await getDatabase()).client.close();
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous); await rm(directory, { recursive: true, force: true });
  }
});
