import "dotenv/config";
import { openDatabase } from "../src/db/connection";
import { seedScheduleDemo } from "./demo-schedule-data";
async function main() {
  const { db, client } = await openDatabase();
  try { const made = await seedScheduleDemo(db); console.log(`${made ? "Создан" : "Уже существует"} demo-schedule-live. Первый тур +2 минуты, финал +8, конец +14 от первоначального создания. Вход через восстановление demo-schedule-live-1@grelqa.example. Явный запуск: npm run schedule:run -- --contest demo-schedule-live. Повторный seed не меняет даты и данные.`); } finally { client.close(); }
}
main().catch(() => { console.error("Не удалось создать отдельный сценарий. Проверьте development, миграции и конфликт demo-ID."); process.exitCode = 1; });
