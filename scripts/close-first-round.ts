import "dotenv/config";
import { openDatabase } from "../src/db/connection";
import { closeFirstRound, ClosureError } from "../src/contests/close-first-round";
async function main() {
  if (process.argv.length !== 3) throw new ClosureError("Укажите slug демонстрационного конкурса.");
  const { db, client } = await openDatabase();
  try {
    const snapshot = await closeFirstRound(db, process.argv[2]);
    console.log(JSON.stringify({ outcome: snapshot.outcome, closedAt: snapshot.closedAt, groups: snapshot.groups.length,
      finalists: snapshot.results.filter((row) => row.finalist).length, failureReason: snapshot.failureReason,
      note: "Сохранённый результат неизменяем. Авторство и чужие бюллетени не публиковались." }, null, 2));
  } finally { client.close(); }
}
main().catch((error) => { console.error(error instanceof ClosureError ? error.message : "Не удалось закрыть тур. Изменения откатились; проверьте миграции и повторите запрос."); process.exitCode = 1; });
