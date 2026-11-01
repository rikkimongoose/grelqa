import "dotenv/config";
import { openDatabase } from "../src/db/connection";
import { seedClosureDemo } from "./demo-closure-data";
import { closeFirstRound } from "../src/contests/close-first-round";
import { prepareFinal } from "../src/contests/prepare-final";
async function main() {
  if (process.env.NODE_ENV !== "development") throw new Error("development required");
  const { db, client } = await openDatabase();
  try {
    const slug = "demo-final-voting"; await seedClosureDemo(db, slug); await closeFirstRound(db, slug); const snapshot = await prepareFinal(db, slug);
    console.log(`Демонстрационный финал /contests/${slug}: ${snapshot.storyIds.length} работ, ${snapshot.members.length} авторов. Повторный запуск не меняет данные. Для входа восстановите demo-final-voting-1@grelqa.example через локальную почту.`);
  } finally { client.close(); }
}
main().catch(() => { console.error("Не удалось подготовить демонстрационный финал. Проверьте development, миграции и отсутствие конфликтующих demo-ID."); process.exitCode = 1; });
