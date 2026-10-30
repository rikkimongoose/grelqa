import { createClient } from "@libsql/client/node";
import { drizzle } from "drizzle-orm/libsql";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as schema from "./schema";

// Используется только сервером и CLI. Удалённые URL намеренно не поддерживаются.
export async function openDatabase(url = process.env.DATABASE_URL) {
  if (!url?.startsWith("file:")) {
    throw new Error("Укажите DATABASE_URL=file:./data/grelqa.db (см. .env.example).");
  }
  const filename = url.startsWith("file://") ? fileURLToPath(url) : path.resolve(url.slice(5));
  mkdirSync(path.dirname(filename), { recursive: true });
  const client = createClient({ url: pathToFileURL(filename).href });
  try {
    await client.execute("PRAGMA foreign_keys = ON");
    await client.execute("PRAGMA busy_timeout = 5000");
    return { db: drizzle(client, { schema }), client };
  } catch (error) {
    client.close();
    throw error;
  }
}

export type Database = Awaited<ReturnType<typeof openDatabase>>["db"];
