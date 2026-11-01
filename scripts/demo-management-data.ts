import { randomBytes, scryptSync } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../src/db/connection";
import * as s from "../src/db/schema";
import { countStoryText, LENGTH_ALGORITHM } from "../src/lib/submission";
export async function seedManagementDemo(db: Database) {
  if (process.env.NODE_ENV !== "development") throw new Error("development required");
  return db.transaction(async (tx) => {
    if ((await tx.select({ id: s.contests.id }).from(s.contests).where(eq(s.contests.id, "demo-management-draft"))).length) return false;
    const now = new Date();
    for (const name of ["owner", "coordinator", "author-one", "author-two"]) {
      const salt = randomBytes(16).toString("hex");
      await tx.insert(s.users).values({ id: `demo-management-${name}`, email: `management-${name}@grelqa.example`, publicName: `Демонстрационный ${name}`, passwordHash: `scrypt:${salt}:${scryptSync(randomBytes(32), salt, 64).toString("hex")}`, emailVerifiedAt: now, createdAt: now });
    }
    const used = new Set((await tx.select({ day: s.contests.startDayMoscow }).from(s.contests)).map((c) => c.day));
    let future = new Date(new Date(+now + 10 * 86400000).toISOString().slice(0, 10) + "T12:00:00Z");
    while (used.has(future.toISOString().slice(0, 10))) future = new Date(+future + 86400000);
    used.add(future.toISOString().slice(0, 10));
    let past = new Date(new Date(+now - 5 * 86400000).toISOString().slice(0, 10) + "T12:00:00Z");
    while (used.has(past.toISOString().slice(0, 10))) past = new Date(+past - 86400000);
    for (const draft of [true, false]) {
      const id = draft ? "demo-management-draft" : "demo-management-moderation", start = draft ? future : past;
      const end = draft ? new Date(+start + 86400000) : new Date(+now - 3600000), round = draft ? new Date(+end + 86400000) : new Date(+now + 86400000);
      await tx.insert(s.contests).values({ id, slug: id, title: draft ? "Секретный репортаж: подготовка" : "Проверка репортажей перед выпуском", description: "Отдельный вымышленный сценарий веб-управления.", organizerId: "demo-management-owner", coordinatorId: "demo-management-coordinator", stage: draft ? "preparation" : "moderation", isDraft: draft, isDemo: true, submissionsStartAt: start, startDayMoscow: start.toISOString().slice(0, 10), submissionsEndAt: end, roundOneStartAt: round, roundTwoStartAt: draft ? new Date(+round + 3 * 86400000) : null, endsAt: new Date(+round + 7 * 86400000), minLength: 10, maxLength: 10000, groupCapacity: 20, finalCapacity: 20, createdAt: now });
      if (!draft) {
        await tx.insert(s.contestThemes).values({ contestId: id, theme: "Репортаж с закрытой станции", conditions: ["Проверка анонимной модерации."], enteredAt: new Date(+start - 1000), publishedAt: start });
        for (const [index, author] of ["author-one", "author-two", "author-one"].entries()) {
          const memberId = `demo-management-member-${author}`;
          await tx.insert(s.participations).values({ id: memberId, userId: `demo-management-${author}`, contestId: id, createdAt: start }).onConflictDoNothing();
          const content = [{ type: "paragraph" as const, children: [{ text: "На станции пахло мокрым железом. Репортёр развернул блокнот и записал первый вопрос, на который никто не хотел отвечать." }] }];
          await tx.insert(s.stories).values({ id: `demo-management-story-${index + 1}`, contestId: id, participationId: memberId, title: `Репортаж ${index + 1}`, content, status: "submitted", length: countStoryText(content), lengthAlgorithm: LENGTH_ALGORITHM, createdAt: start, updatedAt: start });
        }
      }
    }
    return true;
  });
}
