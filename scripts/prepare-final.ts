import "dotenv/config";
import { openDatabase } from "../src/db/connection";
import { prepareFinal, FinalPreparationError } from "../src/contests/prepare-final";
async function main() {
  if (process.argv.length !== 3) throw new FinalPreparationError("Укажите slug демонстрационного конкурса.");
  const { db, client } = await openDatabase();
  try { const result = await prepareFinal(db, process.argv[2]); console.log(JSON.stringify({ preparedAt: result.preparedAt, stories: result.storyIds.length, voters: result.members.length, note: "Финал подготовлен. Результаты первого тура не изменены." }, null, 2)); }
  finally { client.close(); }
}
main().catch((error) => { console.error(error instanceof FinalPreparationError ? error.message : "Не удалось подготовить финал; изменения откатились."); process.exitCode = 1; });
