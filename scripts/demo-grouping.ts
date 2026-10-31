import "dotenv/config";
import { randomBytes, scryptSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/db/connection";
import { contests, contestThemes, participations, stories, users } from "../src/db/schema";
import { countStoryText, LENGTH_ALGORITHM } from "../src/lib/submission";

async function main() {
  if (process.env.NODE_ENV !== "development") throw new Error("Демосценарий разрешён только при NODE_ENV=development.");
  const { db, client } = await openDatabase();
  try {
    await db.transaction(async (tx) => {
      const blocks = process.argv[2] === "--blocks";
      if (process.argv.length > 3 || (process.argv[2] && !blocks)) throw new Error("Неизвестный аргумент демосценария.");
      const id = blocks ? "demo-first-round-blocks" : "demo-first-round";
      const prefix = blocks ? "demo-block" : "demo-group";
      const admittedCount = blocks ? 10 : 8;
      const [existing] = await tx.select({ id: contests.id }).from(contests).where(eq(contests.id, id));
      if (existing) { console.log("Демосценарий уже существует. Состояние и данные не изменены."); return; }
      const now = new Date();
      const deadline = new Date(+now - 2 * 3600_000);
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
      let start = new Date(`${day}T15:00:00+03:00`);
      const used = new Set((await tx.select({ day: contests.startDayMoscow }).from(contests)).map((row) => row.day));
      while (+start + 60_000 >= +deadline || used.has(new Date(+start + 3 * 3600_000).toISOString().slice(0, 10))) start = new Date(+start - 86400_000);
      for (let n = 1; n <= 4; n++) {
        const salt = randomBytes(16).toString("hex");
        await tx.insert(users).values({ id: `${prefix}-author-${n}`, email: `${blocks ? "block" : "group"}-author-${n}@grelqa.example`, passwordHash: `scrypt:${salt}:${scryptSync(randomBytes(32), salt, 64).toString("hex")}`, emailVerifiedAt: now, createdAt: start }).onConflictDoNothing({ target: users.id });
      }
      await tx.insert(contests).values({ id, slug: id, organizerId: `${prefix}-author-1`, title: blocks ? "Десять историй: сбалансированные блоки" : "Восемь историй у окна", description: blocks ? "Десять допущенных рассказов четырёх авторов: исходная вместимость 2, финал 3. Проверка увеличения до 4 и распределения 4/3/3." : "Базовый одногрупповой демосценарий: приём завершён, четыре автора и восемь допущенных рассказов.", stage: "moderation", submissionsStartAt: start, startDayMoscow: new Date(+start + 3 * 3600_000).toISOString().slice(0, 10), submissionsEndAt: deadline, roundOneStartAt: new Date(+now + 86400_000), endsAt: new Date(+now + 30 * 86400_000), groupCapacity: blocks ? 2 : 8, finalCapacity: blocks ? 3 : 4, minLength: 0, maxLength: 0, isDemo: true, createdAt: now });
      await tx.insert(contestThemes).values({ contestId: id, theme: "Окно, которого раньше не было", conditions: ["Вымышленные тексты для локальной проверки формирования и назначения групп."], enteredAt: new Date(+start - 60_000), publishedAt: start });
      for (let n = 1; n <= 4; n++) await tx.insert(participations).values({ id: `${prefix}-participation-${n}`, userId: `${prefix}-author-${n}`, contestId: id, createdAt: start });
      for (let n = 1; n <= admittedCount + 3; n++) {
        const admitted = n <= admittedCount;
        const author = admitted ? (blocks ? (n - 1) % 4 + 1 : Math.ceil(n / 2)) : 1;
        const content = [{ type: "paragraph" as const, children: [{ text: n >= admittedCount - 1 && n <= admittedCount ? "Две одинаковые истории смотрели в одно окно." : `У окна остановился путник. Он ждал свет, который ещё никто не видел. ${"Тихо шёл дождь. ".repeat(n)}`, italic: true }] }];
        const status = admitted ? "admitted" as const : n === admittedCount + 1 ? "rejected" as const : n === admittedCount + 2 ? "draft" as const : "withdrawn" as const;
        await tx.insert(stories).values({ id: `${prefix}-story-${n}`, participationId: `${prefix}-participation-${author}`, contestId: id, title: n >= admittedCount - 1 && n <= admittedCount ? "Полное совпадение" : `История у окна ${n}`, content, length: countStoryText(content), lengthAlgorithm: LENGTH_ALGORITHM, status, createdAt: new Date(+start + Math.min(n, admittedCount - 1) * 1000), updatedAt: now, publishedAt: null,
          withdrawnAt: status === "withdrawn" ? now : null, withdrawalReason: status === "withdrawn" ? "Демонстрационное снятие" : null });
      }
      console.log(`Создан /contests/${id}: приём завершён, ${admittedCount} допущенных работ, 4 автора. Рассказы не публиковались, пользовательские конкурсы не изменены.`);
    });
  } finally { client.close(); }
}
main().catch((error) => { console.error(error.message === "Демосценарий разрешён только при NODE_ENV=development." ? error.message : "Не удалось создать демосценарий. Проверьте миграции и отсутствие конфликтующих demo-ID/slug/email."); process.exitCode = 1; });
