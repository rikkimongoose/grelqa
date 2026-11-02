import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Client } from "@libsql/client";

// Old migration timestamps would silently make Drizzle skip the new baseline.
export async function assertMigrationBaseline(client: Client, folder = "drizzle") {
  const tables = (await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).rows.map((r) => String(r.name));
  if (!tables.length) return;
  const journal = JSON.parse(await readFile(path.join(folder, "meta/_journal.json"), "utf8"));
  const first = journal.entries[0];
  const hash = createHash("sha256").update(await readFile(path.join(folder, `${first.tag}.sql`))).digest("hex");
  if (tables.includes("__drizzle_migrations")) {
    const rows = (await client.execute("SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at")).rows;
    if (rows.length && rows[0].hash === hash && Number(rows[0].created_at) === first.when) return;
  }
  throw new Error("База использует прежнюю или неизвестную историю миграций. Не применяйте initial поверх неё. Остановите приложение и используйте db:rebuild с отдельным --output (см. README).");
}
