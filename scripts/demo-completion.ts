import "dotenv/config";
import { openDatabase } from "../src/db/connection";
import { seedCompletionDemo } from "./demo-completion-data";
async function main() {
  const { db, client } = await openDatabase();
  try {
    const created = await seedCompletionDemo(db);
    console.log(`${created ? "Создан" : "Уже существует"} /contests/demo-completed-contest. Дедлайн истёк. Запустите contest:finalize -- demo-completed-contest. Вход: восстановление demo-completed-contest-1@grelqa.example через локальную почту.`);
  } finally { client.close(); }
}
main().catch(() => { console.error("Не удалось подготовить сценарий. Проверьте development, миграции и demo-ID."); process.exitCode = 1; });
