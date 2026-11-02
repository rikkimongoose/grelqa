import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { openDatabase } from "../src/db/connection";
import { compareDatabaseData, rebuildDatabase } from "../scripts/lib/rebuild-database";
import { assertMigrationBaseline } from "../scripts/lib/migration-baseline";
import { seedCompletionDemo } from "../scripts/demo-completion-data";
import { finalizeContest } from "../src/contests/finalize";
import * as s from "../src/db/schema";

test("свёртка: заполненная старая цепочка → initial, все данные и история, guard и повторные миграции", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "grelqa-baseline-"));
  const source = path.join(dir, "old.db"), output = path.join(dir, "rebuilt.db"), root = "demo-rebase";
  const mode = process.env.NODE_ENV; Object.assign(process.env, { NODE_ENV: "development" });
  const legacy = await openDatabase(`file:${source}`);
  try {
    await migrate(legacy.db, { migrationsFolder: "tests/fixtures/legacy-drizzle" });
    await seedCompletionDemo(legacy.db, root); await finalizeContest(legacy.db, root);
    const now = new Date();
    await legacy.db.update(s.contests).set({ criticatDiscussionUrl: "https://criticat.org/discuss", discussionUrl: "https://example.test/old" }).where(eq(s.contests.id, root));
    await legacy.db.update(s.contestGroups).set({ criticatDiscussionUrl: "https://criticat.org/group" });
    await legacy.db.update(s.stories).set({ aiGenerationBasisPoints: 0 }).where(eq(s.stories.id, `${root}-story-1`));
    await legacy.db.update(s.stories).set({ aiGenerationBasisPoints: 3525 }).where(eq(s.stories.id, `${root}-story-3`));
    await legacy.db.insert(s.authSessions).values({ tokenHash: "existing-session-hash", userId: `${root}-author-1`, createdAt: now, expiresAt: new Date(+now + 3600000) });
    await legacy.db.insert(s.authTokens).values({ tokenHash: "existing-email-token-hash", userId: `${root}-author-1`, purpose: "verify", createdAt: now, expiresAt: new Date(+now + 3600000) });
    await legacy.db.insert(s.authRateLimits).values({ key: "retained-rate-limit", attempts: 3, resetsAt: new Date(+now + 3600000) });
    await legacy.db.insert(s.contestAdminEvents).values({ id: "retained-event", contestId: root, actorId: `${root}-author-1`, action: "test", details: { before: null, after: 0 }, createdAt: now });
    await assert.rejects(assertMigrationBaseline(legacy.client), /прежнюю или неизвестную/);
    legacy.client.close();
    const bytes = await readFile(source);
    const result = await rebuildDatabase(source, output);
    assert.ok(result.rows > 100); assert.deepEqual(await readFile(source), bytes, "источник не изменён");
    const a = new DatabaseSync(source, { readOnly: true }), b = new DatabaseSync(output, { readOnly: true }), saved = new DatabaseSync(result.backup, { readOnly: true });
    try {
      assert.equal(compareDatabaseData(a, b), result.rows); compareDatabaseData(a, saved);
      assert.equal(a.prepare("select count(*) as n from __drizzle_migrations").get()!.n, 12);
      assert.equal(b.prepare("select count(*) as n from __drizzle_migrations").get()!.n, 1);
      assert.notDeepEqual(a.prepare("select sql from sqlite_master where name='contests'").get(), b.prepare("select sql from sqlite_master where name='contests'").get(), "база действительно пересоздана, а не скопирована целиком");
    } finally { a.close(); b.close(); saved.close(); }
    const rebuilt = await openDatabase(`file:${output}`);
    try {
      await assertMigrationBaseline(rebuilt.client);
      await migrate(rebuilt.db, { migrationsFolder: "drizzle" }); await migrate(rebuilt.db, { migrationsFolder: "drizzle" });
      assert.equal((await rebuilt.db.select().from(s.contestFinalizations)).length, 1);
      await assert.rejects(rebuilt.client.execute("update stories set ai_generation_basis_points=10001"));
      await assert.rejects(rebuilt.client.execute("update stories set participation_id='missing'"));
      await assert.rejects(rebuilt.client.execute("update users set email='same@example.test'"));
    } finally { rebuilt.client.close(); }
    const outputBytes = await readFile(output);
    await assert.rejects(rebuildDatabase(source, output), /EEXIST/); assert.deepEqual(await readFile(output), outputBytes);
    await assert.rejects(rebuildDatabase(source, source), /должен отличаться/);
    // Unrecognised tables/columns are not discarded, and a failed copy leaves the source intact.
    const changed = new DatabaseSync(source); changed.exec("create table extra_user_data (value text); insert into extra_user_data values ('keep me')"); changed.close();
    await assert.rejects(rebuildDatabase(source, path.join(dir, "invalid.db")), /Наборы таблиц/);
    const unchanged = new DatabaseSync(source, { readOnly: true });
    try { assert.equal(unchanged.prepare("select value from extra_user_data").get()!.value, "keep me"); } finally { unchanged.close(); }
  } finally {
    // libsql close() is safe to repeat.
    legacy.client.close();
    if (mode === undefined) Reflect.deleteProperty(process.env, "NODE_ENV"); else Object.assign(process.env, { NODE_ENV: mode });
    await rm(dir, { recursive: true, force: true });
  }
});
