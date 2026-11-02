import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { rebuildDatabase } from "./lib/rebuild-database";

async function main() {
  const { values } = parseArgs({ options: { source: { type: "string" }, output: { type: "string" } }, strict: true });
  const url = process.env.DATABASE_URL;
  const source = values.source ?? (url?.startsWith("file://") ? fileURLToPath(url) : url?.startsWith("file:") ? path.resolve(url.slice(5)) : undefined);
  if (!source || !values.output) throw new Error("Использование: npm run db:rebuild -- --output /путь/к/новой.db [--source /путь/к/старой.db]. Остановите приложение и worker. Исходная база не заменяется.");
  const result = await rebuildDatabase(source, values.output);
  console.log(`Новая база: ${result.output}\nРезервная копия: ${result.backup}\nСохранено записей: ${result.rows}. Целостность, внешние ключи и точное совпадение данных проверены. Исходная база не изменена.`);
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Ошибка переноса SQLite"); process.exitCode = 1; });
