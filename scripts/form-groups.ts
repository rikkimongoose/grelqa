import "dotenv/config";
import { openDatabase } from "../src/db/connection";
import { formFirstRound, GroupingError } from "../src/contests/grouping";

async function main() {
  if (process.env.NODE_ENV !== "development") throw new GroupingError("Задайте NODE_ENV=development. Production/test запуск запрещён.");
  const slug = process.argv[2];
  if (!slug || process.argv.length !== 3) throw new GroupingError("Использование: NODE_ENV=development npm run contest:form-groups -- <slug>");
  const { db, client } = await openDatabase();
  try {
    const result = await formFirstRound(db, slug);
    if (result.status === "blocked") {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 2;
    } else if (result.status === "failed") {
      console.log(JSON.stringify({ status: "failed", ...result.snapshot, note: "Проверка после модерации сохранена. Конкурс и его история не удалены." }, null, 2));
    } else {
      console.log(JSON.stringify({ status: "formed", formedAt: result.snapshot.formedAt, version: result.snapshot.version,
        groups: result.snapshot.groups.map((group) => ({ number: group.number, capacity: group.capacity, stories: group.storyIds.length })), assignments: result.snapshot.assignments.length,
        note: "Результат зафиксирован. Публикация и начало голосования не выполнялись." }, null, 2));
    }
  } finally { client.close(); }
}
main().catch((error) => { console.error(error instanceof GroupingError ? error.message : "Не удалось сформировать группы. Проверьте миграции и целостность данных."); process.exitCode = 1; });
