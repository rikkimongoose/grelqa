import "dotenv/config";
import { openDatabase } from "../src/db/connection";
import { closeReception, GroupingError } from "../src/contests/grouping";

async function main() {
  if (process.env.NODE_ENV !== "development") throw new GroupingError("Задайте NODE_ENV=development. Production/test запуск запрещён.");
  const slug = process.argv[2];
  if (!slug || process.argv.length !== 3) throw new GroupingError("Использование: NODE_ENV=development npm run contest:close-reception -- <slug>");
  const { db, client } = await openDatabase();
  try { console.log(JSON.stringify(await closeReception(db, slug))); }
  finally { client.close(); }
}
main().catch((error) => { console.error(error instanceof GroupingError ? error.message : "Не удалось закрыть приём. Данные конкурса не удалены."); process.exitCode = 1; });
