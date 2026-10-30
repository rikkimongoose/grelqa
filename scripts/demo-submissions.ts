import "dotenv/config";
import { randomBytes, scryptSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/db/connection";
import { contests, contestThemes, users } from "../src/db/schema";

async function main() {
  const { db, client } = await openDatabase();
  try {
    await db.transaction(async (tx) => {
      const id = "demo-open-submissions";
      const [existing] = await tx.select({ id: contests.id }).from(contests).where(eq(contests.id, id));
      if (existing) { console.log("Демоконкурс уже существует. Его даты и данные не изменены."); return; }
      const now = new Date();
      const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
      let start = new Date(`${date}T15:00:00+03:00`);
      const used = new Set((await tx.select({ day: contests.startDayMoscow }).from(contests)).map((row) => row.day));
      while (+start > +now || used.has(new Date(+start + 3 * 3600_000).toISOString().slice(0, 10))) start = new Date(+start - 86400_000);
      const day = new Date(+start + 3 * 3600_000).toISOString().slice(0, 10);
      const end = new Date(+now + 30 * 86400_000);
      const salt = randomBytes(16).toString("hex");
      await tx.insert(users).values({ id: "demo-submission-organizer", email: "submission-organizer@grelqa.example", passwordHash: `scrypt:${salt}:${scryptSync(randomBytes(32), salt, 64).toString("hex")}`, emailVerifiedAt: now, createdAt: now }).onConflictDoNothing({ target: users.id });
      await tx.insert(contests).values({ id, slug: id, organizerId: "demo-submission-organizer", title: "Проба пера", description: "Демонстрационный конкурс для проверки подачи и редактирования рассказов.", stage: "submissions", submissionsStartAt: start, startDayMoscow: day, submissionsEndAt: end, roundOneStartAt: new Date(+end + 86400_000), endsAt: new Date(+end + 14 * 86400_000), minLength: 10, maxLength: 20000, groupCapacity: 20, finalCapacity: 12, isDemo: true, createdAt: now });
      await tx.insert(contestThemes).values({ contestId: id, theme: "Вещь, которая помнит", conditions: ["Любой вымышленный сюжет. Текст предназначен для проверки подачи работ.", "Не указывайте авторство в названии и тексте."], enteredAt: new Date(+start - 60_000), publishedAt: start });
      console.log("Создан демоконкурс /contests/demo-open-submissions. Приём открыт на 30 дней; чужие конкурсы не изменены.");
    });
  } finally { client.close(); }
}
main().catch(() => { console.error("Не удалось создать демоконкурс. Проверьте миграции и отсутствие конфликтующих demo-ID/slug/email."); process.exitCode = 1; });
