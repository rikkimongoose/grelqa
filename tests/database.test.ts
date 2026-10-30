import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/db/connection";
import * as s from "../src/db/schema";

test("миграции, seed, ограничения, история и публичные данные на отдельной SQLite", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grelqa-db-test-"));
  const url = `file:${path.join(directory, "test.db")}`;
  // Никогда не берём DATABASE_URL из пользовательского .env для проверок.
  const env = { ...process.env, DATABASE_URL: url };
  const run = (script: string) => execFileSync(process.execPath, ["--import", "tsx", script], { env, stdio: "pipe" });
  let connection: Awaited<ReturnType<typeof openDatabase>> | undefined;
  let publicConnection: Awaited<ReturnType<typeof openDatabase>> | undefined;
  const originalUrl = process.env.DATABASE_URL;
  try {
    run("scripts/migrate.ts");
    run("scripts/migrate.ts");
    connection = await openDatabase(url);
    const { db, client } = connection;
    assert.equal((await db.select().from(s.contests)).length, 0);
    assert.equal((await client.execute("PRAGMA foreign_keys")).rows[0].foreign_keys, 1);
    run("scripts/seed.ts");
    const before = (await client.execute("SELECT * FROM users ORDER BY id")).rows;
    const now = new Date();
    await db.insert(s.users).values({ id: "test-user", email: "untouched@example.test", passwordHash: "test-only", createdAt: now });
    await db.update(s.contests).set({ title: "Название из SQLite после изменения" }).where(eq(s.contests.slug, "letters-to-november"));
    run("scripts/seed.ts");
    const after = (await client.execute("SELECT * FROM users WHERE id LIKE 'demo-%' ORDER BY id")).rows;
    assert.deepEqual(after, before, "seed не перезаписывает даже хеши существующих пользователей");
    assert.equal((await db.select().from(s.users)).length, 4);
    assert.equal((await db.select().from(s.contests)).length, 3);
    assert.equal((await db.select().from(s.participations)).length, 3);
    assert.equal((await db.select().from(s.stories)).length, 3);
    assert.equal((await db.select().from(s.contestGroups)).length, 1);
    assert.equal((await db.select().from(s.ballots)).length, 3);
    assert.equal((await db.select().from(s.ballotEntries)).length, 6);

    const violates = async (operation: PromiseLike<unknown>, pattern: RegExp) => {
      await assert.rejects(async () => { await operation; }, (error: unknown) => {
        const messages: string[] = [];
        for (let current = error; current instanceof Error; current = current.cause) messages.push(current.message);
        assert.match(messages.join("\n"), pattern);
        return true;
      });
    };
    await violates(db.insert(s.users).values({ id: "duplicate", email: "untouched@example.test", passwordHash: "x", createdAt: now }), /UNIQUE/);
    const [participant] = await db.select().from(s.participations).limit(1);
    await violates(db.insert(s.participations).values({ ...participant, id: "duplicate-participation" }), /UNIQUE/);
    await violates(db.insert(s.participations).values({ ...participant, id: "missing-user", userId: "nonexistent" }), /FOREIGN KEY/);
    const [ballot] = await db.select().from(s.ballots).limit(1);
    await violates(db.insert(s.ballots).values({ ...ballot, id: "duplicate-ballot" }), /UNIQUE/);
    const entries = await db.select().from(s.ballotEntries).where(eq(s.ballotEntries.ballotId, ballot.id));
    await violates(db.insert(s.ballotEntries).values({ ...entries[0], position: 3 }), /UNIQUE/);
    await violates(db.update(s.ballotEntries).set({ position: entries[0].position }).where(eq(s.ballotEntries.storyId, entries[1].storyId)), /UNIQUE/);
    await violates(db.insert(s.ballotEntries).values({ ...entries[0], storyId: "not-a-story", position: 3 }), /FOREIGN KEY/);
    await violates(db.update(s.ballotEntries).set({ position: 7 }).where(eq(s.ballotEntries.ballotId, ballot.id)), /CHECK/);
    await violates(db.update(s.contests).set({ stage: "failed", failureReason: null }).where(eq(s.contests.slug, "winter-notebook")), /CHECK/);
    const [winter] = await db.select().from(s.contests).where(eq(s.contests.slug, "winter-notebook"));
    await violates(db.insert(s.contestGroups).values({ id: "wrong-round-group", contestId: winter.id, round: 3, number: 1, capacity: 20 }), /CHECK/);
    await db.insert(s.contestGroups).values({ id: "other-contest-group", contestId: winter.id, round: 1, number: 1, capacity: 20 });
    await violates(db.update(s.participations).set({ assignedGroupId: "other-contest-group" }).where(eq(s.participations.id, participant.id)), /FOREIGN KEY/);
    await violates(db.delete(s.stories).where(eq(s.stories.id, entries[0].storyId)), /FOREIGN KEY/);
    await violates(db.update(s.stories).set({ length: null, lengthAlgorithm: "unagreed" }).where(eq(s.stories.id, entries[0].storyId)), /CHECK/);

    await db.insert(s.contestGroups).values({ id: "test-final-group", contestId: participant.contestId, round: 2, number: 1, capacity: 12 });
    await db.insert(s.storyRounds).values({ storyId: entries[0].storyId, contestId: participant.contestId, round: 2, groupId: "test-final-group", status: "withdrawn", withdrawnAt: now, withdrawalReason: "Тест снятия только в финале" });
    const rounds = await db.select().from(s.storyRounds).where(eq(s.storyRounds.storyId, entries[0].storyId));
    assert.equal(rounds.find((item) => item.round === 1)?.status, "active");
    assert.equal(rounds.find((item) => item.round === 2)?.status, "withdrawn");
    assert.equal((await db.select().from(s.ballotEntries)).length, 6, "снятие не уничтожает бюллетени");

    process.env.DATABASE_URL = url;
    const { getPublicContests, getPublicContest } = await import("../src/db/public-contests");
    publicConnection = await (await import("../src/db/index")).getDatabase();
    const publicRows = await getPublicContests();
    assert.equal(publicRows.length, 3);
    assert.equal((await getPublicContest("letters-to-november"))?.title, "Название из SQLite после изменения");
    assert.equal(await getPublicContest("unknown"), undefined);
    const hidden = await getPublicContest("winter-notebook");
    assert.equal(hidden?.theme, null);
    assert.doesNotMatch(JSON.stringify(publicRows), /СЕКРЕТ|grelqa\.example|passwordHash|participationId|organizerId|demo-user/);
    // Одного изменения этапа недостаточно для публикации.
    await db.update(s.contests).set({ stage: "submissions" }).where(eq(s.contests.id, winter.id));
    await db.update(s.contestThemes).set({ publishedAt: now }).where(eq(s.contestThemes.contestId, winter.id));
    await db.update(s.contests).set({ submissionsStartAt: new Date("2099-12-01T12:00:00Z"), startDayMoscow: "2099-12-01", submissionsEndAt: new Date("2099-12-15T12:00:00Z"), roundOneStartAt: new Date("2099-12-17T12:00:00Z"), roundTwoStartAt: null, endsAt: new Date("2099-12-31T12:00:00Z") }).where(eq(s.contests.id, winter.id));
    assert.equal((await getPublicContest("winter-notebook"))?.theme, null);
    await db.update(s.contests).set({ submissionsStartAt: new Date("2020-12-01T12:00:00Z"), startDayMoscow: "2020-12-01", preparationAt: null }).where(eq(s.contests.id, winter.id));
    await db.update(s.contestThemes).set({ publishedAt: new Date("2099-12-01T12:00:00Z") }).where(eq(s.contestThemes.contestId, winter.id));
    assert.equal((await getPublicContest("winter-notebook"))?.theme, null);
    await db.update(s.contestThemes).set({ publishedAt: new Date("2020-12-01T12:00:00Z") }).where(eq(s.contestThemes.contestId, winter.id));
    assert.match((await getPublicContest("winter-notebook"))!.theme!, /СЕКРЕТНАЯ ДЕМОТЕМА/);
    assert.deepEqual((await client.execute("PRAGMA foreign_key_check")).rows, []);
  } finally {
    publicConnection?.client.close();
    connection?.client.close();
    if (originalUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalUrl;
    await rm(directory, { recursive: true, force: true });
  }
});
