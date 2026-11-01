import { randomBytes, scryptSync } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../src/db/connection";
import * as s from "../src/db/schema";
import { countStoryText, LENGTH_ALGORITHM } from "../src/lib/submission";
export async function seedScheduleDemo(db: Database) {
  if (process.env.NODE_ENV !== "development") throw new Error("development required");
  return db.transaction(async (tx) => {
    const root = "demo-schedule-live";
    if ((await tx.select({ id: s.contests.id }).from(s.contests).where(eq(s.contests.id, root))).length) return false;
    const now = new Date(); let start = new Date(new Date(+now - 3 * 86400000).toISOString().slice(0, 10) + "T12:00:00Z");
    const used = new Set((await tx.select({ day: s.contests.startDayMoscow }).from(s.contests)).map((c) => c.day));
    while (used.has(start.toISOString().slice(0, 10))) start = new Date(+start - 86400000);
    for (let n = 1; n <= 3; n++) {
      const salt = randomBytes(16).toString("hex");
      await tx.insert(s.users).values({ id: `${root}-author-${n}`, email: `${root}-${n}@grelqa.example`, publicName: `Репортёр расписания ${n}`, passwordHash: `scrypt:${salt}:${scryptSync(randomBytes(32), salt, 64).toString("hex")}`, emailVerifiedAt: start, createdAt: start });
    }
    await tx.insert(s.contests).values({ id: root, slug: root, organizerId: `${root}-author-1`, title: "Репортаж по часам", description: "Отдельный сценарий автоматических переходов. Тексты проверены; бюллетеней нет. Повторный seed не продлевает сроки.", isDemo: true, stage: "moderation", submissionsStartAt: start, startDayMoscow: start.toISOString().slice(0, 10), submissionsEndAt: new Date(+now - 60000), roundOneStartAt: new Date(+now + 120000), roundTwoStartAt: new Date(+now + 480000), endsAt: new Date(+now + 840000), groupCapacity: 3, finalCapacity: 4, createdAt: now });
    await tx.insert(s.contestThemes).values({ contestId: root, theme: "Последний поезд не ждёт", conditions: ["Вымышленные проверенные рассказы для локального расписания."], enteredAt: new Date(+start - 1000), publishedAt: start });
    for (let n = 1; n <= 3; n++) await tx.insert(s.participations).values({ id: `${root}-member-${n}`, userId: `${root}-author-${n}`, contestId: root, createdAt: start });
    for (let n = 1; n <= 6; n++) {
      const content = [{ type: "paragraph" as const, children: [{ text: "Репортёр поставил часы рядом с блокнотом. " + "Поезд ещё не пришёл. ".repeat(n) }] }];
      await tx.insert(s.stories).values({ id: `${root}-story-${n}`, contestId: root, participationId: `${root}-member-${(n - 1) % 3 + 1}`, title: `Часы на платформе ${n}`, content, length: countStoryText(content), lengthAlgorithm: LENGTH_ALGORITHM, status: "admitted", createdAt: new Date(+start + n), updatedAt: now });
    }
    return true;
  });
}
