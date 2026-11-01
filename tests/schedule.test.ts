import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { openDatabase } from "../src/db/connection";
import { getDatabase } from "../src/db";
import { writeTransaction } from "../src/db/write-transaction";
import * as s from "../src/db/schema";
import { withClock } from "../src/server/clock";
import { processSchedule } from "../src/scheduling/process";
import { executeTransition } from "../src/scheduling/execute";
import { schedulerAuthority } from "../src/scheduling/authority";
import { contestAction, moderateStory, managementView } from "../src/management/service";
import { myBallot, changeBallot } from "../src/voting/service";
import { saveStory } from "../src/stories/service";
import { tokenHash, AuthError } from "../src/auth/service";
import { getPublicContest } from "../src/db/public-contests";
import { getPublicStory } from "../src/db/public-stories";
import { getContestFeed } from "../src/feeds/data";
import { downloadArchive } from "../src/exports/service";
import { countStoryText, LENGTH_ALGORITHM } from "../src/lib/submission";

const HOUR = 3600000;
test("расписание: границы, два тура, простой, блокировки, откат, журнал, crash и независимые дедлайны", { timeout: 180000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grelqa-schedule-")); const old = { ...process.env };
  const env = { ...process.env, NODE_ENV: "development" as const, DATABASE_URL: `file:${path.join(directory, "test.db")}`, EXPORT_CACHE_DIRECTORY: path.join(directory, "exports"), APP_URL: "https://grelqa.test", SITE_URL: "https://grelqa.test", SESSION_SECRET: "schedule-test-secret-at-least-thirty-two-characters", MAIL_MODE: "smtp", SMTP_HOST: "127.0.0.1", SMTP_PORT: "9", MAIL_FROM: "test@grelqa.test" };
  Object.assign(process.env, env); const { db, client } = await openDatabase(env.DATABASE_URL); let serial = 0;
  type Fixture = { slug: string; start: Date; end: Date; first: Date; final: Date; finish: Date; tokens: Map<string, string>; sid: (n: number) => string };
  const at = <T>(time: Date, work: () => Promise<T>) => withClock(() => time, work);
  async function fixture(slug: string, options: { single?: boolean; theme?: boolean; pending?: boolean; count?: number; start?: Date } = {}): Promise<Fixture> {
    const start = options.start ?? new Date(Date.UTC(2040, 0, ++serial, 12)); const end = new Date(+start + 2 * HOUR), first = new Date(+start + 3 * HOUR), final = new Date(+start + 4 * HOUR), finish = new Date(+start + 5 * HOUR);
    const tokens = new Map<string, string>(), sid = (n: number) => `${slug}-story-${n}`;
    await db.transaction(async (tx) => {
      for (let n = 1; n <= 3; n++) {
        const id = `${slug}-user-${n}`, token = randomBytes(32).toString("hex"); tokens.set(id, token);
        await tx.insert(s.users).values({ id, email: `${slug}-${n}@grelqa.example`, publicName: `Псевдоним ${n}`, passwordHash: "test-only", emailVerifiedAt: new Date(+start - HOUR), createdAt: new Date(+start - HOUR) });
        await tx.insert(s.authSessions).values({ tokenHash: tokenHash("session", token), userId: id, createdAt: new Date(+start - HOUR), expiresAt: new Date(+finish + 86400000) });
      }
      await tx.insert(s.contests).values({ id: slug, slug, organizerId: `${slug}-user-1`, title: `Расписание ${slug}`, description: "Только временная тестовая база.", stage: "preparation", submissionsStartAt: start, startDayMoscow: start.toISOString().slice(0, 10), submissionsEndAt: end, roundOneStartAt: first, roundTwoStartAt: final, endsAt: finish, groupCapacity: options.single ? 10 : 3, finalCapacity: 4, createdAt: new Date(+start - HOUR), isDemo: false });
      if (options.theme !== false) await tx.insert(s.contestThemes).values({ contestId: slug, theme: `СКРЫТАЯ ТЕМА ${slug}`, conditions: ["СЕКРЕТНОЕ УСЛОВИЕ"], enteredAt: new Date(+start - 1), publishedAt: start });
      for (let n = 1; n <= 3; n++) await tx.insert(s.participations).values({ id: `${slug}-member-${n}`, userId: `${slug}-user-${n}`, contestId: slug, createdAt: start });
      for (let n = 1; n <= (options.count ?? 6); n++) {
        const content = [{ type: "paragraph" as const, children: [{ text: "Текст ".repeat(n + 3) }] }];
        await tx.insert(s.stories).values({ id: sid(n), contestId: slug, participationId: `${slug}-member-${(n - 1) % 3 + 1}`, title: `Работа ${n}`, content, length: countStoryText(content), lengthAlgorithm: LENGTH_ALGORITHM, status: options.pending ? "submitted" : "admitted", createdAt: new Date(+start + n), updatedAt: end });
      }
    });
    return { slug, start, end, first, final, finish, tokens, sid };
  }
  const run = (f: Fixture, time: Date, maxSteps?: number) => processSchedule(db, { slug: f.slug, clock: () => time, maxSteps });
  const operations = (r: Awaited<ReturnType<typeof processSchedule>>) => r.contests.flatMap((c) => c.reports.map((e) => e.action));
  const stage = async (f: Fixture) => (await db.select().from(s.contests).where(eq(s.contests.slug, f.slug)))[0].stage;
  const runs = (f: Fixture) => db.select().from(s.contestTransitionRuns).where(eq(s.contestTransitionRuns.contestId, f.slug));
  const token = (f: Fixture, n = 1) => f.tokens.get(`${f.slug}-user-${n}`)!;
  async function vote(f: Fixture, time: Date, round: 1 | 2) {
    await at(time, async () => {
      const owners = round === 1 ? (await db.select().from(s.participations).where(eq(s.participations.contestId, f.slug))).filter((m) => m.assignedGroupId).map((m) => [m.userId, f.tokens.get(m.userId)!] as const) : (await db.select().from(s.finalRounds).where(eq(s.finalRounds.contestId, f.slug)))[0].snapshot.members.map((m) => [m.userId, f.tokens.get(m.userId)!] as const);
      for (const [, value] of owners) {
        const ballot = await myBallot(value, f.slug, round);
        if (!ballot.exempt) await changeBallot(value, "submit", { slug: f.slug, revision: ballot.revision, requestId: randomUUID(), selections: ballot.available.slice(0, ballot.required).map((s) => s.id) }, time, round);
      }
    });
  }
  try {
    await migrate(db, { migrationsFolder: "drizzle" }); await migrate(db, { migrationsFolder: "drizzle" });
    const draft = await fixture("unpublished"); await db.update(s.contests).set({ isDraft: true }).where(eq(s.contests.id, draft.slug));
    await assert.rejects(run(draft, draft.finish), /Опубликованный/); assert.equal(await stage(draft), "preparation");
    const full = await fixture("full");
    assert.deepEqual(operations(await run(full, new Date(+full.start - 1))), []);
    assert.equal((await at(new Date(+full.start - 1), () => getPublicContest(full.slug)))?.theme, null);
    assert.deepEqual(operations(await run(full, full.start)), ["start-reception"]);
    assert.match((await at(full.start, () => getPublicContest(full.slug)))!.theme!, /СКРЫТАЯ ТЕМА/);
    assert.deepEqual(operations(await run(full, new Date(+full.end - 1))), []);
    // The scheduler is stopped here; original stage is still submissions, but deadline alone rejects a save.
    await at(full.end, () => assert.rejects(saveStory(token(full), full.slug, { title: "Просроченная подача", content: [{ type: "paragraph", children: [{ text: "Достаточно текста" }] }] }), (e) => e instanceof AuthError && e.status === 409));
    assert.deepEqual(operations(await run(full, full.end)), ["close-reception"]);
    assert.deepEqual(operations(await run(full, new Date(+full.first - 1))), []);
    assert.equal((await db.select().from(s.contestGroups).where(eq(s.contestGroups.contestId, full.slug))).length, 0, "промежуток модерации не сокращается");
    assert.deepEqual(operations(await run(full, full.first)), ["form", "start-first"]);
    const formed = await db.select().from(s.firstRoundFormations).where(eq(s.firstRoundFormations.contestId, full.slug));
    assert.equal(formed[0].snapshot && "groups" in formed[0].snapshot && formed[0].snapshot.groups.length, 2);
    await vote(full, new Date(+full.first + 1000), 1);
    await at(full.final, () => assert.rejects(changeBallot(token(full), "draft", { slug: full.slug, revision: 1, requestId: randomUUID(), selections: [] }, full.final), (e) => e instanceof AuthError && e.status === 409));
    assert.equal(await stage(full), "round-one", "отказ не зависит от перехода этапа");
    assert.deepEqual(operations(await run(full, new Date(+full.final - 1))), []);
    assert.deepEqual(operations(await run(full, full.final)), ["close-first", "prepare-final"]);
    const before = (await db.select().from(s.firstRoundClosures).where(eq(s.firstRoundClosures.contestId, full.slug)))[0];
    const admission = (await db.select().from(s.finalRounds).where(eq(s.finalRounds.contestId, full.slug)))[0];
    assert.equal(admission.snapshot.members.length, 3);
    assert.equal((await at(full.final, () => getPublicStory(full.slug, full.sid(4))))?.authorName, null);
    await vote(full, new Date(+full.final + 1000), 2);
    const zipBefore = await at(new Date(+full.finish - 1), () => downloadArchive(full.slug)); assert.ok(zipBefore);
    assert.deepEqual(operations(await run(full, new Date(+full.finish - 1))), []);
    await at(full.finish, () => assert.rejects(changeBallot(token(full), "draft", { slug: full.slug, revision: 1, requestId: randomUUID(), selections: [] }, full.finish, 2), (e) => e instanceof AuthError && e.status === 409));
    assert.deepEqual(operations(await run(full, full.finish)), ["finalize"]); assert.equal(await stage(full), "completed");
    const completion = (await db.select().from(s.contestFinalizations).where(eq(s.contestFinalizations.contestId, full.slug)))[0]; assert.equal(completion.snapshot.round, 2); assert.ok(completion.snapshot.winners.length);
    assert.equal((await at(full.finish, () => getPublicStory(full.slug, full.sid(4))))?.authorName, "Псевдоним 1");
    const zipAfter = await at(full.finish, () => downloadArchive(full.slug)); assert.ok(zipAfter); assert.notDeepEqual(zipAfter.bytes, zipBefore.bytes);
    const feed = await at(full.finish, () => getContestFeed()); assert.equal(feed.entries.find((e) => e.url.endsWith(full.slug))?.updated.toISOString(), full.finish.toISOString());
    assert.deepEqual((await db.select().from(s.firstRoundClosures).where(eq(s.firstRoundClosures.contestId, full.slug)))[0], before);
    const oldRuns = await runs(full); assert.equal(oldRuns.length, 7); assert.ok(oldRuns.every((r) => r.actorId === null && r.source === "scheduled" && r.outcome === "success"));
    assert.deepEqual(operations(await run(full, new Date(+full.finish + HOUR))), []); assert.deepEqual(await runs(full), oldRuns);
    const single = await fixture("single", { single: true });
    await run(single, single.first); await vote(single, new Date(+single.first + 1000), 1);
    assert.deepEqual(operations(await run(single, single.final)), ["close-first", "finalize"]);
    assert.equal(await stage(single), "completed"); assert.equal((await db.select().from(s.finalRounds).where(eq(s.finalRounds.contestId, single.slug))).length, 0);
    const missed = await fixture("missed"); const catchup = await run(missed, new Date(+missed.finish + HOUR));
    assert.deepEqual(operations(catchup), ["start-reception", "close-reception", "form", "start-first", "close-first", "finalize"]);
    assert.equal(await stage(missed), "failed"); assert.equal((await db.select().from(s.ballots).where(eq(s.ballots.contestId, missed.slug))).length, 0, "нет фиктивных голосов");
    assert.equal((await db.select().from(s.contests).where(eq(s.contests.slug, missed.slug)))[0].endsAt.toISOString(), missed.finish.toISOString());
    const missing = await fixture("missing-theme", { theme: false }); assert.deepEqual(operations(await run(missing, missing.start)), ["start-reception"]); assert.equal(await stage(missing), "failed");
    assert.equal((await db.select().from(s.contests).where(eq(s.contests.slug, missing.slug)))[0].failureReason, "theme-late");
    const empty = await fixture("empty", { count: 0 }); await run(empty, empty.first); assert.equal(await stage(empty), "failed");
    const one = await fixture("one-story", { count: 1 }); await run(one, one.first); assert.equal(await stage(one), "failed");
    // A full first round survives a long outage; final is prepared late, then actually closed, never extended.
    const lateFinal = await fixture("late-final"); await run(lateFinal, lateFinal.first); await vote(lateFinal, new Date(+lateFinal.first + 1000), 1);
    assert.deepEqual(operations(await run(lateFinal, new Date(+lateFinal.finish + HOUR))), ["close-first", "prepare-final", "finalize"]); assert.equal(await stage(lateFinal), "failed");
    assert.equal((await db.select().from(s.ballots).where(and(eq(s.ballots.contestId, lateFinal.slug), eq(s.ballots.round, 2)))).length, 0);
    // Actual first-round results can select only one author; even late preparation must initialize exemption.
    const sole = await fixture("sole-final");
    for (const [i, author] of [1, 2, 1, 2, 1, 1].entries()) await db.update(s.stories).set({ participationId: `${sole.slug}-member-${author}` }).where(eq(s.stories.id, sole.sid(i + 1)));
    await db.update(s.contests).set({ finalCapacity: 2 }).where(eq(s.contests.id, sole.slug));
    await run(sole, sole.first); await vote(sole, new Date(+sole.first + 1000), 1);
    await run(sole, new Date(+sole.finish + HOUR));
    const [soleResult] = await db.select().from(s.contestFinalizations).where(eq(s.contestFinalizations.contestId, sole.slug));
    assert.equal(soleResult.snapshot.round, 2); assert.equal(soleResult.snapshot.tally.failureReason, "one-author");
    assert.deepEqual(soleResult.snapshot.tally.audit.nonVotingParticipationIds, []); assert.equal(soleResult.snapshot.tally.audit.members[0].votingStatus, "exempt");
    const zeroChoice = await fixture("zero-choice");
    for (let i = 1; i <= 6; i++) await db.update(s.stories).set({ participationId: `${zeroChoice.slug}-member-${i <= 3 ? 1 : 2}` }).where(eq(s.stories.id, zeroChoice.sid(i)));
    await run(zeroChoice, new Date(+zeroChoice.finish + HOUR));
    const [zeroFirst] = await db.select().from(s.firstRoundClosures).where(eq(s.firstRoundClosures.contestId, zeroChoice.slug));
    assert.equal(zeroFirst.snapshot.outcome, "results"); assert.deepEqual(zeroFirst.snapshot.audit.nonVotingParticipationIds, []);
    assert.equal(zeroFirst.snapshot.audit.members.filter((m) => m.votingStatus === "exempt").length, 2);
    const wrongStage = await fixture("wrong-stage"); await run(wrongStage, wrongStage.first); await vote(wrongStage, new Date(+wrongStage.first + 1000), 1);
    await at(wrongStage.final, () => contestAction(token(wrongStage), wrongStage.slug, "close-first"));
    const frozenFirst = (await db.select().from(s.firstRoundClosures).where(eq(s.firstRoundClosures.contestId, wrongStage.slug)))[0];
    await db.update(s.contests).set({ stage: "preparation" }).where(eq(s.contests.id, wrongStage.slug));
    assert.equal((await run(wrongStage, wrongStage.final)).failed, true); assert.equal(await stage(wrongStage), "preparation");
    assert.deepEqual((await db.select().from(s.firstRoundClosures).where(eq(s.firstRoundClosures.contestId, wrongStage.slug)))[0], frozenFirst);
    const pending = await fixture("pending", { pending: true }); const blocked = await run(pending, pending.first); assert.equal(blocked.failed, true); assert.equal(await stage(pending), "moderation");
    assert.match(blocked.contests[0].reports.at(-1)!.message, /submitted/);
    const state = await at(pending.first, () => managementView(token(pending), pending.slug)); assert.equal(state.schedule.overdue, true); assert.equal(state.schedule.lastError?.outcome, "blocked");
    for (let n = 1; n <= 6; n++) await at(pending.first, () => moderateStory(token(pending), pending.slug, pending.sid(n), "admit", "Проверено"));
    await at(pending.first, () => contestAction(token(pending), pending.slug, "retry-schedule")); assert.equal(await stage(pending), "round-one");
    assert.equal((await at(pending.first, () => managementView(token(pending), pending.slug))).schedule.errorResolved, true);
    const broken = await fixture("broken"), healthy = await fixture("healthy", { theme: false });
    await db.update(s.contests).set({ stage: "moderation" }).where(eq(s.contests.slug, broken.slug));
    await client.execute("CREATE TRIGGER schedule_fail BEFORE INSERT ON first_round_formations WHEN NEW.contest_id='broken' BEGIN SELECT RAISE(ABORT,'PRIVATE SQL SECRET'); END");
    const failure = await run(broken, broken.first); assert.equal(failure.failed, true); assert.doesNotMatch(JSON.stringify(failure), /PRIVATE SQL SECRET|audit|selections|password|grelqa\.example/);
    assert.equal(await stage(broken), "moderation"); assert.equal((await db.select().from(s.contestGroups).where(eq(s.contestGroups.contestId, broken.slug))).length, 0);
    assert.equal((await runs(broken))[0].outcome, "error");
    const isolated = await processSchedule(db, { clock: () => healthy.first }); assert.equal(isolated.failed, true); assert.equal(await stage(healthy), "failed", "ошибка другого конкурса не препятствует обработке");
    await client.execute("DROP TRIGGER schedule_fail"); await run(broken, broken.first); assert.equal(await stage(broken), "round-one");
    const capped = await fixture("capped"); const cap = await run(capped, capped.first, 1); assert.equal(cap.limited, true); assert.equal(cap.contests[0].reports.length, 1); await run(capped, capped.first); assert.equal(await stage(capped), "round-one");
    const race = await fixture("race"); await run(race, race.end);
    const children = [1, 2].map(() => spawn(process.execPath, ["--import", "tsx", "tests/helpers/schedule-worker.ts"], { env: { ...env, TEST_CLOCK: race.first.toISOString(), TEST_CONTEST: race.slug }, stdio: "pipe" }));
    const exiting = Promise.all(children.map(async (c) => { let out = ""; c.stdout!.on("data", (b) => { out += b; }); c.stderr!.on("data", (b) => { out += b; }); const [code] = await once(c, "exit"); assert.equal(code, 0, out); }));
    await at(race.first, () => contestAction(token(race), race.slug, "form")); await exiting;
    assert.equal(await stage(race), "round-one"); assert.equal((await runs(race)).filter((r) => r.action === "form").length, 1); assert.equal((await runs(race)).filter((r) => r.action === "start-first").length, 1);
    const crashing = await fixture("crashing");
    const child = spawn(process.execPath, ["--import", "tsx", "tests/helpers/schedule-crash.ts"], { env: { ...env, TEST_CONTEST: crashing.slug }, stdio: "pipe" });
    await new Promise<void>((resolve, reject) => { child.stdout!.on("data", (b) => { if (b.toString().includes("LOCKED")) resolve(); }); child.once("error", reject); child.once("exit", (code) => reject(new Error(`Early crash worker exit ${code}`))); });
    const died = once(child, "exit"); child.kill("SIGKILL"); await died; await run(crashing, crashing.first);
    assert.equal((await db.select().from(s.contests).where(eq(s.contests.slug, crashing.slug)))[0].title, `Расписание ${crashing.slug}`); assert.equal(await stage(crashing), "round-one");
    // Existing in-flight write shares the lock with a due closure; latest committed ballot is read.
    const accepting = await fixture("accepting"); await run(accepting, accepting.first); await vote(accepting, new Date(+accepting.first + 1000), 1);
    let release!: () => void; let locked!: () => void; const ready = new Promise<void>((r) => { locked = r; });
    const writer = writeTransaction(db, async (tx) => { const [b] = await tx.select().from(s.ballots).where(and(eq(s.ballots.contestId, accepting.slug), eq(s.ballots.participationId, `${accepting.slug}-member-1`))); await tx.update(s.ballots).set({ updatedAt: new Date(+accepting.final - 1), submittedAt: new Date(+accepting.final - 1) }).where(eq(s.ballots.id, b.id)); locked(); await new Promise<void>((r) => { release = r; }); });
    await ready; const closing = run(accepting, accepting.final); await delay(25); release(); await writer; await closing;
    const [accepted] = await db.select().from(s.firstRoundClosures).where(eq(s.firstRoundClosures.contestId, accepting.slug)); assert.equal(accepted.snapshot.audit.votes.find((v) => v.participationId === `${accepting.slug}-member-1`)?.submittedAt, new Date(+accepting.final - 1).toISOString());
    // CLI uses real time only; the production path accepts no --at/fake-clock option.
    const cli = await fixture("cli-blocked", { start: new Date("2020-01-01T12:00:00Z"), pending: true });
    const runCli = async (slug: string) => { const c = spawn(process.execPath, ["--import", "tsx", "scripts/process-schedule.ts", "--contest", slug], { env, stdio: "pipe" }); let out = ""; c.stdout!.on("data", (b) => { out += b; }); const [code] = await once(c, "exit"); return { code, out }; };
    assert.equal((await runCli(cli.slug)).code, 1); assert.equal((await runCli("not-found")).code, 1);
    const cliOk = await fixture("cli-success", { start: new Date("2021-01-01T12:00:00Z"), theme: false }); assert.equal((await runCli(cliOk.slug)).code, 0);
    // Total run bound and fairness: old attempted failures cannot starve never-attempted contests.
    for (let n = 0; n < 101; n++) await fixture(`limit-${n}`, { theme: false, count: 0 });
    const latest = new Date("2041-01-01T00:00:00Z"); const limited = await processSchedule(db, { clock: () => latest });
    assert.ok(limited.limited); assert.ok(limited.contests.flatMap((c) => c.reports).length <= 100);
    await processSchedule(db, { clock: () => latest });
    assert.equal((await db.select().from(s.contests).where(and(inArray(s.contests.slug, Array.from({ length: 101 }, (_, n) => `limit-${n}`)), eq(s.contests.stage, "failed")))).length, 101);
    assert.deepEqual((await client.execute("pragma foreign_key_check")).rows, []);
    assert.doesNotMatch(JSON.stringify(await runs(full)), /СКРЫТАЯ ТЕМА|СЕКРЕТНОЕ|selections|password|tokenHash/);
    assert.equal((await at(full.finish, () => executeTransition(db, full.slug, schedulerAuthority, "finalize"))).status, "noop");
  } finally { client.close(); (await getDatabase()).client.close(); for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); await rm(directory, { recursive: true, force: true }); }
});
