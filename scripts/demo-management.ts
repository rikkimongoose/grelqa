import "dotenv/config";
import { openDatabase } from "../src/db/connection";
import { seedManagementDemo } from "./demo-management-data";
async function main() {
  const { db, client } = await openDatabase();
  try { const created = await seedManagementDemo(db); console.log(`${created ? "Созданы" : "Уже существуют"} отдельные demo-management-draft и demo-management-moderation. Владелец management-owner@grelqa.example, координатор management-coordinator@grelqa.example; вход через восстановление пароля и локальную почту. Существующие данные не меняются.`); } finally { client.close(); }
}
main().catch(() => { console.error("Не удалось подготовить управление. Проверьте development, миграции и отсутствие конфликтующих demo-ID."); process.exitCode = 1; });
