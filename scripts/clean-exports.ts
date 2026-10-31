import "dotenv/config";
import { cleanExportCache } from "../src/exports/cache";
cleanExportCache().then((count) => console.log(`Удалено устаревших файлов экспорта: ${count}`)).catch(() => {
  console.error("Не удалось очистить кэш экспорта. Проверьте путь и права доступа."); process.exitCode = 1;
});
