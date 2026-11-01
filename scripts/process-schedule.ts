import "dotenv/config";
import { openDatabase } from "../src/db/connection";
import { processSchedule } from "../src/scheduling/process";
async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--contest")) throw new Error("Использование: schedule:run [--contest slug]");
  const { db, client } = await openDatabase();
  try {
    const result = await processSchedule(db, { slug: args[1] });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.failed ? 1 : result.limited ? 2 : 0;
  } finally { client.close(); }
}
main().catch(() => { console.error("Обработка расписания не завершена. Проверьте DATABASE_URL, миграции и аргументы команды. Секреты и данные запросов не выводятся."); process.exitCode = 1; });
