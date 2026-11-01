import "dotenv/config";
import { openDatabase } from "../src/db/connection";
import { seedClosureDemo } from "./demo-closure-data";
async function main() {
  if (process.env.NODE_ENV !== "development") throw new Error("development required");
  const { db, client } = await openDatabase();
  try { console.log(await seedClosureDemo(db) ? "Создан /contests/demo-first-round-results: приём бюллетеней завершён, группы 5/5/5. Закройте тур отдельной командой." : "Сценарий уже существует. Данные и сроки не изменены."); }
  finally { client.close(); }
}
main().catch(() => { console.error("Не удалось создать сценарий итогов. Нужны development, миграции и свободные demo-ID/email/slug."); process.exitCode = 1; });
