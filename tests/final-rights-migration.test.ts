import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { migrate } from "drizzle-orm/libsql/migrator";
import { and, eq } from "drizzle-orm";
import { openDatabase } from "../src/db/connection";
import { seedClosureDemo } from "../scripts/demo-closure-data";
import { closeFirstRound } from "../src/contests/close-first-round";
import { prepareFinal } from "../src/contests/prepare-final";
import * as s from "../src/db/schema";

test("миграция принятого правила: старый финал, отзыв права и сохранение всех версий/первого тура", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grelqa-rights-upgrade-"));
  const originalMode = process.env.NODE_ENV; Object.assign(process.env, { NODE_ENV: "development" });
  const fixture = await openDatabase(`file:${path.join(directory, "fixture.db")}`);
  const legacy = await openDatabase(`file:${path.join(directory, "legacy.db")}`);
  const root = "demo-rights-upgrade", memberId = `${root}-member-1`;
  try {
    await migrate(fixture.db, { migrationsFolder: "drizzle" }); await seedClosureDemo(fixture.db, root); await closeFirstRound(fixture.db, root);
    const final = await prepareFinal(fixture.db, root);
    final.withdrawalRights = "unresolved";
    await fixture.db.update(s.finalRounds).set({ snapshot: final }).where(eq(s.finalRounds.contestId, root));
    await delay(5); const sentAt = new Date();
    await fixture.db.insert(s.ballots).values({ id: "retained-final-ballot", participationId: memberId, contestId: root, groupId: final.groupId, round: 2, createdAt: sentAt, updatedAt: sentAt, submittedAt: sentAt });
    for (const [index, n] of [2, 3, 7, 11, 12, 13].entries()) await fixture.db.insert(s.ballotEntries).values({ ballotId: "retained-final-ballot", storyId: `${root}-story-${n}`, contestId: root, groupId: final.groupId, round: 2, position: index + 1 });
    await fixture.db.insert(s.ballotDrafts).values({ participationId: memberId, contestId: root, groupId: final.groupId, round: 2, selections: [`${root}-story-3`], revision: 7, updatedAt: sentAt });
    await fixture.db.insert(s.ballotRequests).values({ participationId: memberId, round: 2, requestId: "retained-receipt", payloadHash: "retained-hash", response: { revision: 7, message: "Сохранено", submittedAt: sentAt.toISOString() }, receivedAt: sentAt });
    await delay(5); const removedAt = new Date();
    await fixture.db.update(s.storyRounds).set({ status: "withdrawn", withdrawnAt: removedAt, withdrawalReason: "Снята автором" }).where(and(eq(s.storyRounds.storyId, `${root}-story-1`), eq(s.storyRounds.round, 2)));
    const oldFolder = path.join(directory, "old"); await mkdir(path.join(oldFolder, "meta"), { recursive: true });
    const journal = JSON.parse(await readFile("tests/fixtures/legacy-drizzle/meta/_journal.json", "utf8")); journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 7);
    await writeFile(path.join(oldFolder, "meta/_journal.json"), JSON.stringify(journal));
    for (const entry of journal.entries) await copyFile(`tests/fixtures/legacy-drizzle/${entry.tag}.sql`, path.join(oldFolder, `${entry.tag}.sql`));
    await migrate(legacy.db, { migrationsFolder: oldFolder });
    const tables = ["users", "contests", "contest_themes", "contest_groups", "participations", "stories", "story_rounds", "ballots", "ballot_entries", "ballot_drafts", "ballot_requests", "first_round_formations", "first_round_closures", "final_rounds"];
    const oldColumns = new Map<string, string[]>();
    for (const table of tables) {
      const names = (await legacy.client.execute(`PRAGMA table_info(${table})`)).rows.map((row) => String(row.name));
      oldColumns.set(table, names);
      for (const row of (await fixture.client.execute(`SELECT ${names.join(",")} FROM ${table} ORDER BY rowid`)).rows) await legacy.client.execute({ sql: `INSERT INTO ${table} (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`, args: names.map((_, i) => row[i]) });
    }
    const preservedTables = tables.filter((table) => table !== "participations");
    const before = await Promise.all(preservedTables.map(async (table) => (await legacy.client.execute(`SELECT ${oldColumns.get(table)!.join(",")} FROM ${table} ORDER BY rowid`)).rows));
    await migrate(legacy.db, { migrationsFolder: "tests/fixtures/legacy-drizzle" }); await migrate(legacy.db, { migrationsFolder: "tests/fixtures/legacy-drizzle" });
    assert.deepEqual(await Promise.all(preservedTables.map(async (table) => (await legacy.client.execute(`SELECT ${oldColumns.get(table)!.join(",")} FROM ${table} ORDER BY rowid`)).rows)), before);
    assert.ok((await legacy.db.select({ name: s.users.publicName }).from(s.users)).every((row) => row.name === null));
    assert.deepEqual(await legacy.db.select().from(s.contestFinalizations), []);
    const [member] = await legacy.db.select().from(s.participations).where(eq(s.participations.id, memberId));
    assert.equal(member.mustVoteRoundTwo, false); assert.equal(+member.roundTwoRightsEndedAt!, +removedAt); assert.equal(member.roundTwoExemptAt, null); assert.equal(member.roundTwoExemptReason, null);
    assert.equal(member.mustVoteRoundOne, true); assert.equal(member.assignedRound, 1); assert.equal(member.assignedGroupId, `${root}-group-1`);
    const [other] = await legacy.db.select().from(s.participations).where(eq(s.participations.id, `${root}-member-2`));
    assert.equal(other.mustVoteRoundTwo, true); assert.equal(other.roundTwoRightsEndedAt, null);
    assert.deepEqual((await legacy.client.execute("PRAGMA foreign_key_check")).rows, []);
  } finally {
    fixture.client.close(); legacy.client.close();
    if (originalMode === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: originalMode });
    await rm(directory, { recursive: true, force: true });
  }
});
