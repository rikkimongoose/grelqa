import assert from "node:assert/strict";
import { backup, DatabaseSync } from "node:sqlite";
import { chmod, mkdir, mkdtemp, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { openDatabase } from "../../src/db/connection";

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const tables = (db: DatabaseSync) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name!='__drizzle_migrations' ORDER BY name").all().map((r) => String(r.name));
const columns = (db: DatabaseSync, table: string) => db.prepare(`PRAGMA table_info(${quote(table)})`).all().map((r) => String(r.name)).sort();
function check(db: DatabaseSync) {
  assert.deepEqual(db.prepare("PRAGMA integrity_check").all().map((r) => r.integrity_check), ["ok"], "Нарушена целостность SQLite");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), [], "Нарушены внешние ключи");
}
export function compareDatabaseData(source: DatabaseSync, target: DatabaseSync) {
  assert.deepEqual(tables(target), tables(source), "Наборы прикладных таблиц различаются");
  let count = 0;
  for (const table of tables(source)) {
    const names = columns(source, table);
    assert.deepEqual(columns(target, table), names, `Столбцы ${table} различаются`);
    // Preserve exact INTEGERs (including 64-bit values), BLOBs, NULLs and row order.
    const sql = `SELECT rowid AS "__source_rowid", ${names.map(quote).join(",")} FROM ${quote(table)} ORDER BY rowid`;
    const a = source.prepare(sql), b = target.prepare(sql);
    a.setReadBigInts(true); b.setReadBigInts(true);
    const before = a.all(), after = b.all();
    assert.deepEqual(after, before, `Содержимое ${table} изменилось`);
    count += before.length;
  }
  return count;
}

// Creates an independent database; never replaces or mutates the source.
export async function rebuildDatabase(sourceFile: string, outputFile: string) {
  const source = path.resolve(sourceFile), output = path.resolve(outputFile);
  if (source === output) throw new Error("--output должен отличаться от исходной базы.");
  if (!(await stat(source)).isFile()) throw new Error("Исходная база не является файлом.");
  await mkdir(path.dirname(output), { recursive: true });
  // Reserve output exclusively; an existing file, including a symlink, is never overwritten.
  const reserved = await open(output, "wx", 0o600); await reserved.close();
  let work: string | undefined;
  let success = false;
  try {
    work = await mkdtemp(path.join(path.dirname(output), ".grelqa-rebuild-"));
    await chmod(work, 0o700);
    const snapshot = path.join(work, "source.db"), candidate = path.join(work, "rebuilt.db");
    const live = new DatabaseSync(source, { readOnly: true });
    try { await backup(live, snapshot); } finally { live.close(); }
    await chmod(snapshot, 0o600);
    const original = new DatabaseSync(snapshot, { readOnly: true });
    try {
      check(original);
      // Extra user-defined views/triggers must not disappear silently.
      assert.deepEqual(original.prepare("SELECT name FROM sqlite_master WHERE type IN ('view','trigger')").all(), [], "В базе есть дополнительные представления/триггеры; требуется отдельный перенос");
      const connection = await openDatabase(`file:${candidate}`);
      try { await migrate(connection.db, { migrationsFolder: "drizzle" }); } finally { connection.client.close(); }
      const rebuilt = new DatabaseSync(candidate);
      let count: number;
      try {
        const indexes = (db: DatabaseSync) => db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name").all();
        assert.deepEqual(indexes(rebuilt), indexes(original), "Индексы различаются; требуется отдельный перенос");
        assert.deepEqual(tables(rebuilt), tables(original), "Наборы таблиц различаются");
        // The tables have cyclic FKs. Disable only for this offline copy, then verify all references.
        rebuilt.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE");
        try {
          for (const table of tables(original)) {
            const names = columns(original, table);
            assert.deepEqual(columns(rebuilt, table), names, `Столбцы ${table} различаются`);
            const query = original.prepare(`SELECT rowid, ${names.map(quote).join(",")} FROM ${quote(table)} ORDER BY rowid`);
            query.setReadBigInts(true); query.setReturnArrays(true);
            const insert = rebuilt.prepare(`INSERT INTO ${quote(table)} (rowid, ${names.map(quote).join(",")}) VALUES (${Array(names.length + 1).fill("?").join(",")})`);
            for (const row of query.all()) insert.run(...row as unknown as Parameters<typeof insert.run>);
          }
          check(rebuilt); count = compareDatabaseData(original, rebuilt);
          rebuilt.exec("COMMIT; PRAGMA foreign_keys=ON");
        } catch (error) { rebuilt.exec("ROLLBACK"); throw error; }
      } finally { rebuilt.close(); }
      await chmod(candidate, 0o600);
      await rename(candidate, output);
      success = true;
      // Keep the consistent snapshot, including the OLD migration journal, for rollback.
      return { output, backup: snapshot, rows: count! };
    } finally { original.close(); }
  } finally {
    if (!success) { await rm(output, { force: true }); if (work) await rm(work, { recursive: true, force: true }); }
  }
}
