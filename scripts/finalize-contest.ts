import "dotenv/config";
import { openDatabase } from "../src/db/connection";
import { finalizeContest, FinalizationError } from "../src/contests/finalize";
async function main() {
  if (process.argv.length !== 3) throw new FinalizationError("Укажите slug демонстрационного конкурса.");
  const { db, client } = await openDatabase();
  try {
    const result = await finalizeContest(db, process.argv[2]);
    console.log(JSON.stringify({ outcome: result.tally.outcome, completedAt: result.completedAt, round: result.round,
      failureReason: result.tally.failureReason, winners: result.winners.length, note: "Сохранённый итог неизменяем. Бюллетени остаются приватными." }, null, 2));
  } finally { client.close(); }
}
main().catch((e) => { console.error(e instanceof FinalizationError ? e.message : "Не удалось завершить конкурс. Изменения откатились; проверьте миграции."); process.exitCode = 1; });
