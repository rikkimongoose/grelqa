import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { migrate } from "drizzle-orm/libsql/migrator";
import { and, eq } from "drizzle-orm";
import { sealData } from "iron-session";
import { openDatabase } from "../src/db/connection";
import { getDatabase } from "../src/db";
import * as s from "../src/db/schema";
import { tokenHash } from "../src/auth/service";
import { seedCompletionDemo } from "../scripts/demo-completion-data";
import { seedClosureDemo } from "../scripts/demo-closure-data";
import { finalizeContest } from "../src/contests/finalize";
import { saveContest } from "../src/management/service";
import { saveAnnotation } from "../src/management/annotations";
import { ManagementError } from "../src/management/access";
import { criticatUrl, aiGeneration } from "../src/lib/story-annotations";
import { getPublicStory, getPublicStoryGroups, getPublicGroup } from "../src/db/public-stories";
import { publicFinalResults } from "../src/contests/final-results-queries";
import { publicFirstRoundResults } from "../src/contests/results-queries";
import { getContestFeed } from "../src/feeds/data";
import { downloadArchive } from "../src/exports/service";
import { myBallot } from "../src/voting/service";

test("Criticat и AI: строгие URL и сотые процента без округления", () => {
  for (const v of ["https://criticat.org/topic/1", "https://www.criticat.org/t?q=x#y", "https://criticat.org:443/a", ""]) assert.ok(criticatUrl.safeParse(v).success, v);
  for (const v of ["http://criticat.org/x", "https://criticat.org.example.com", "https://sub.criticat.org", "https://criticat.org:444/x", "https://u:p@criticat.org", "https://u@criticat.org", "javascript:alert(1)", "/relative", "https://criticat.org./", "https://сriticat.org/"]) assert.equal(criticatUrl.safeParse(v).success, false, v);
  for (const [input, result] of [[null, null], ["", null], [0, 0], [100, 10000], [35.25, 3525], ["35,25", 3525], ["0.01", 1]] as const) assert.equal(aiGeneration.parse(input), result);
  for (const v of [-1, 100.01, "35.255", "-0.01", "text", true, {}, NaN, Infinity, "1e2"]) assert.equal(aiGeneration.safeParse(v).success, false, String(v));
});
test("метаданные: миграция, права, журнал, публичные страницы/бюллетень, cache и неизменяемые результаты", { timeout: 120000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grelqa-annotations-")); const old = { ...process.env };
  const env = { ...process.env, NODE_ENV: "development" as const, DATABASE_URL: `file:${path.join(directory, "test.db")}`, EXPORT_CACHE_DIRECTORY: path.join(directory, "exports"), APP_URL: "https://grelqa.test", SITE_URL: "https://grelqa.test", SESSION_SECRET: "annotation-tests-secret-at-least-thirty-two-characters", MAIL_MODE: "smtp", SMTP_HOST: "127.0.0.1", SMTP_PORT: "9", MAIL_FROM: "test@grelqa.test" };
  Object.assign(process.env, env); const connection = await openDatabase(env.DATABASE_URL), { db, client } = connection;
  let server: ReturnType<typeof spawn> | undefined;
  const root = "demo-annotation", sid = `${root}-story-1`;
  const rejected = (p: Promise<unknown>, status: number) => assert.rejects(p, (e) => e instanceof ManagementError && e.status === status);
  try {
    await migrate(db, { migrationsFolder: "drizzle" }); await seedCompletionDemo(db, root); await seedClosureDemo(db, "other-contest");
    await db.update(s.contests).set({ coordinatorId: `${root}-author-3` }).where(eq(s.contests.id, root));
    const tokens = new Map<number, string>();
    for (const n of [1, 2, 3]) { const token = randomBytes(32).toString("hex"); tokens.set(n, token); await db.insert(s.authSessions).values({ tokenHash: tokenHash("session", token), userId: `${root}-author-${n}`, createdAt: new Date(), expiresAt: new Date(Date.now() + 3600000) }); }
    const owner = tokens.get(1)!, other = tokens.get(2)!, coord = tokens.get(3)!;
    const [group] = await db.select().from(s.contestGroups).where(and(eq(s.contestGroups.contestId, root), eq(s.contestGroups.round, 2)));
    const set = (annotation: unknown) => saveAnnotation(owner, root, annotation);
    // Upgrade populated v0010, preserve all old columns, foreign keys, snapshots and ballot positions.
    const legacy = await openDatabase(`file:${path.join(directory, "old.db")}`);
    try {
      const folder = path.join(directory, "old"); await mkdir(path.join(folder, "meta"), { recursive: true });
      const journal = JSON.parse(await readFile("tests/fixtures/legacy-drizzle/meta/_journal.json", "utf8")); journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 11);
      await writeFile(path.join(folder, "meta/_journal.json"), JSON.stringify(journal)); for (const e of journal.entries) await copyFile(`tests/fixtures/legacy-drizzle/${e.tag}.sql`, path.join(folder, `${e.tag}.sql`));
      await migrate(legacy.db, { migrationsFolder: folder });
      const tables = ["users", "contests", "contest_themes", "contest_groups", "participations", "stories", "story_rounds", "ballots", "ballot_entries", "ballot_drafts", "ballot_requests", "first_round_formations", "first_round_closures", "final_rounds"];
      const columns = new Map<string, string[]>();
      for (const t of tables) { const names = (await legacy.client.execute(`pragma table_info(${t})`)).rows.map((r) => String(r.name)); columns.set(t, names); for (const r of (await client.execute(`select ${names.join(",")} from ${t} order by rowid`)).rows) await legacy.client.execute({ sql: `insert into ${t} (${names.join(",")}) values (${names.map(() => "?").join(",")})`, args: names.map((_, i) => r[i]) }); }
      const query = async (t: string) => (await legacy.client.execute(`select ${columns.get(t)!.join(",")} from ${t} order by rowid`)).rows;
      const before = await Promise.all(tables.map(query)); await migrate(legacy.db, { migrationsFolder: "tests/fixtures/legacy-drizzle" }); await migrate(legacy.db, { migrationsFolder: "tests/fixtures/legacy-drizzle" }); assert.deepEqual(await Promise.all(tables.map(query)), before);
      assert.deepEqual((await legacy.client.execute("pragma foreign_key_check")).rows, []);
    } finally { legacy.client.close(); }
    const draftSettings = { title: "Подготовка Criticat", description: "Проверка настроек", discussionUrl: "https://example.test/legacy", ownerEmail: `${root}-1@grelqa.example`, coordinatorEmail: "", submissionsStartAt: "2099-01-01T15:00", submissionsEndAt: "2099-01-02T15:00", roundOneStartAt: "2099-01-03T15:00", roundTwoStartAt: "2099-01-04T15:00", endsAt: "2099-01-05T15:00", groupCapacity: 20, finalCapacity: 20, minLength: 0, maxLength: 0 };
    const draft = await saveContest(owner, { ...draftSettings, criticatDiscussionUrl: "https://criticat.org/topic/draft" });
    await saveContest(owner, draftSettings, draft.slug, 1);
    assert.equal((await db.select().from(s.contests).where(eq(s.contests.slug, draft.slug)))[0].criticatDiscussionUrl, "https://criticat.org/topic/draft", "отсутствие нового поля не очищает существующую ссылку");
    await saveContest(owner, { ...draftSettings, criticatDiscussionUrl: "" }, draft.slug, 2);
    assert.equal((await db.select().from(s.contests).where(eq(s.contests.slug, draft.slug)))[0].criticatDiscussionUrl, null);
    assert.equal((await getPublicStory(root, sid))?.aiGenerationBasisPoints, null);
    await rejected(saveAnnotation(other, root, { kind: "story-ai", id: sid, value: 35 }), 403);
    await rejected(saveAnnotation(coord, root, { kind: "contest-discussion", value: "https://criticat.org/a" }), 403);
    await rejected(saveAnnotation("", root, { kind: "story-ai", id: sid, value: 35 }), 403);
    await rejected(set({ kind: "group-discussion", id: "other-contest-group-1", value: "https://criticat.org/a" }), 404);
    await rejected(set({ kind: "story-ai", id: "other-contest-story-1", value: 30 }), 404);
    for (const value of [0, 100, "35.25", ""]) { await set({ kind: "story-ai", id: sid, value }); assert.equal((await getPublicStory(root, sid))?.aiGenerationBasisPoints, aiGeneration.parse(value)); }
    for (const value of [-1, 101, "bad", "0.001"]) await assert.rejects(set({ kind: "story-ai", id: sid, value }));
    await assert.rejects(db.update(s.stories).set({ aiGenerationBasisPoints: -1 }).where(eq(s.stories.id, sid))); await assert.rejects(db.update(s.stories).set({ aiGenerationBasisPoints: 10001 }).where(eq(s.stories.id, sid)));
    for (const value of ["https://criticat.org/topic/1", "https://www.criticat.org/topic/2", ""]) { await set({ kind: "contest-discussion", value }); await set({ kind: "group-discussion", id: group.id, value }); assert.equal((await getPublicGroup(root, group.id))?.criticatDiscussionUrl, value || null); }
    await set({ kind: "story-ai", id: sid, value: "35.25" });
    assert.equal((await myBallot(other, root, 2)).available.find((r) => r.id === sid)?.aiGenerationBasisPoints, 3525);
    assert.equal((await getPublicStoryGroups(root)).flatMap((g) => g.stories).find((r) => r.id === sid)?.aiGenerationBasisPoints, 3525);
    const publicData = JSON.stringify(await getPublicGroup(root, group.id)); assert.doesNotMatch(publicData, /author-\d|grelqa\.example|participationId|userId|password/);
    await finalizeContest(db, root);
    const frozenTables = ["contest_finalizations", "first_round_closures", "first_round_formations", "final_rounds", "story_rounds", "ballots", "ballot_entries", "ballot_drafts", "ballot_requests", "participations"];
    const frozen = await Promise.all(frozenTables.map(async (t) => (await client.execute(`select * from ${t} order by rowid`)).rows));
    const zipBefore = await downloadArchive(root), feedBefore = await getContestFeed(); assert.ok(zipBefore);
    const contentBefore = (await db.select().from(s.stories).where(eq(s.stories.id, sid)))[0];
    await set({ kind: "story-ai", id: sid, value: 100 }); await set({ kind: "contest-discussion", value: "https://criticat.org/topic/contest" }); await set({ kind: "group-discussion", id: group.id, value: "https://criticat.org/topic/group" });
    assert.deepEqual(await Promise.all(frozenTables.map(async (t) => (await client.execute(`select * from ${t} order by rowid`)).rows)), frozen);
    const { aiGenerationBasisPoints: ignored, ...storyAfter } = (await db.select().from(s.stories).where(eq(s.stories.id, sid)))[0]; void ignored;
    const { aiGenerationBasisPoints: previous, ...storyBefore } = contentBefore; void previous; assert.deepEqual(storyAfter, storyBefore);
    assert.equal((await publicFinalResults(root))?.stories.find((r) => r.id === sid)?.aiGenerationBasisPoints, 10000); assert.equal((await publicFirstRoundResults(root))?.groups.flatMap((g) => g.stories).find((r) => r.id === sid)?.aiGenerationBasisPoints, 10000);
    assert.deepEqual((await downloadArchive(root))?.bytes, zipBefore.bytes); assert.deepEqual(await getContestFeed(), feedBefore);
    const events = await db.select().from(s.contestAdminEvents).where(and(eq(s.contestAdminEvents.contestId, root), eq(s.contestAdminEvents.action, "story-ai")));
    assert.ok(events.some((e) => e.actorId === `${root}-author-1` && e.details.before === 0 && e.details.after === 10000));
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "0"], { env: { ...env, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; server.stdout!.on("data", (b) => { output += b; }); server.stderr!.on("data", (b) => { output += b; }); let base = "";
    for (let i = 0; i < 200; i++) { const m = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (m && output.includes("Ready")) { base = m[0]; break; } await delay(100); } assert.ok(base, output);
    const cookie = async (n: number) => `__Host-grelqa=${await sealData({ token: tokens.get(n) }, { password: env.SESSION_SECRET, ttl: 3600 })}`;
    const ownerCookie = await cookie(1), coordCookie = await cookie(3);
    const post = (annotation: unknown, auth = ownerCookie, origin = env.APP_URL) => fetch(base + "/api/manage/annotation", { method: "POST", headers: { Cookie: auth, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ slug: root, annotation }) });
    for (const auth of [await cookie(2), coordCookie, ""]) assert.equal((await post({ kind: "story-ai", id: sid, value: 25 }, auth)).status, 403);
    assert.equal((await post({ kind: "story-ai", id: sid, value: 25 }, ownerCookie, "https://foreign.test")).status, 403);
    assert.equal((await post({ kind: "story-ai", id: sid, value: -1 })).status, 400);
    const page = async (url: string) => { const r = await fetch(base + url); assert.equal(r.status, 200); return r.text(); };
    const pages = [`/contests/${root}`, `/contests/${root}/groups/${group.id}`, `/contests/${root}/stories/${sid}`];
    for (const url of pages) assert.match(await page(url), /AI-генерация: <!-- -->100<!-- -->%|AI-генерация: 100%|AI-генерация:.*?100.*?%/);
    assert.match(await page(pages[0]), /Обсудить конкурс на Criticat/); assert.match(await page(pages[1]), /Обсудить группу на Criticat/);
    // Prime pages, mutate through the real handler (revalidation), then verify refreshed HTTP and RSC.
    assert.equal((await post({ kind: "story-ai", id: sid, value: 0 })).status, 200);
    for (const url of pages) { const html = await page(url); assert.match(html, /AI-генерация:.*?0.*?%/); assert.match(html, /не является доказательством использования AI/); const rsc = await (await fetch(base + url, { headers: { RSC: "1" } })).text(); assert.match(rsc, /ai-generation/); }
    assert.equal((await post({ kind: "story-ai", id: sid, value: "" })).status, 200);
    const cleared = await page(pages[2]); assert.doesNotMatch(cleared, /AI-генерация:/);
    assert.equal((await post({ kind: "group-discussion", id: group.id, value: "" })).status, 200); assert.doesNotMatch(await page(pages[1]), /Обсудить группу на Criticat/);
    const hiddenId = `${root}-story-2`; assert.equal((await fetch(base + `/contests/${root}/stories/${hiddenId}`)).status, 404);
    assert.deepEqual((await client.execute("pragma foreign_key_check")).rows, []);
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) { const exit = once(server, "exit"); server.kill("SIGTERM"); await exit; } client.close(); (await getDatabase()).client.close(); for (const k of Object.keys(process.env)) if (!(k in old)) delete process.env[k]; Object.assign(process.env, old); await rm(directory, { recursive: true, force: true });
  }
});
