import "dotenv/config";
import { migrate } from "drizzle-orm/libsql/migrator";
import { openDatabase } from "../src/db/connection";

async function main() {
  const { db, client } = await openDatabase();
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("Миграции применены.");
  } finally {
    client.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
