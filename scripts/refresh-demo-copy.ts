import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { openDatabase } from "../src/db/connection";
import { contests, contestThemes, stories, participations, users, firstRoundFormations, firstRoundClosures } from "../src/db/schema";
import { countStoryText, LENGTH_ALGORITHM } from "../src/lib/submission";
import { demoContests } from "./demo-contests";
import { demoStoryTitles, demoStoryContents } from "./demo-stories";

async function main() {
  if (process.env.NODE_ENV !== "development") throw new Error("Обновление демотекстов разрешено только в development.");
  const { db, client } = await openDatabase();
  try {
    const changed = await db.transaction(async (tx) => {
      let count = 0;
      for (const demo of demoContests) {
        const id = `demo-contest-${demo.slug}`;
        const [contest] = await tx.select().from(contests).where(and(eq(contests.id, id), eq(contests.slug, demo.slug), eq(contests.isDemo, true), eq(contests.organizerId, "demo-user-1")));
        if (!contest) throw new Error("Не найден ожидаемый базовый демоконкурс. Выполните db:seed; пользовательские конкурсы не обновляются.");
        const [formation] = await tx.select().from(firstRoundFormations).where(eq(firstRoundFormations.contestId, id));
        const [closure] = await tx.select().from(firstRoundClosures).where(eq(firstRoundClosures.contestId, id));
        if (formation || closure) throw new Error("У базового демоконкурса уже есть неизменяемый снимок. Его тексты и историю обновлять нельзя.");
        const [theme] = await tx.select().from(contestThemes).where(eq(contestThemes.contestId, id));
        if (!theme) throw new Error("Отсутствует базовая демотема.");
        if (contest.title !== demo.title || contest.description !== demo.description) {
          await tx.update(contests).set({ title: demo.title, description: demo.description }).where(eq(contests.id, id)); count++;
        }
        const value = demo.theme ?? "СЕКРЕТНАЯ ДЕМОТЕМА: аккредитация на конец света";
        const conditions = demo.theme ? demo.conditions : ["СЕКРЕТНОЕ ДЕМОУСЛОВИЕ: репортёр прибывает после последнего автобуса."];
        if (theme.theme !== value || JSON.stringify(theme.conditions) !== JSON.stringify(conditions)) {
          await tx.update(contestThemes).set({ theme: value, conditions }).where(eq(contestThemes.contestId, id)); count++;
        }
      }
      for (let n = 1; n <= 3; n++) {
        const [row] = await tx.select({ story: stories }).from(stories).innerJoin(participations, eq(stories.participationId, participations.id))
          .innerJoin(users, eq(participations.userId, users.id)).where(and(eq(stories.id, `demo-city-story-${n}`), eq(stories.contestId, "demo-contest-city-between-lines"),
            eq(participations.id, `demo-city-participant-${n}`), eq(users.id, `demo-user-${n}`), eq(users.email, `writer-${n}@grelqa.example`)));
        if (!row) throw new Error("Не совпадает владелец/связи базового деморассказа. Обновление отменено.");
        const content = demoStoryContents[n - 1], title = demoStoryTitles[n - 1];
        if (row.story.title === title && JSON.stringify(row.story.content) === JSON.stringify(content)) continue;
        if (row.story.lengthAlgorithm !== null && row.story.lengthAlgorithm !== LENGTH_ALGORITHM) throw new Error("Неизвестная версия длины деморассказа. Обновление отменено.");
        await tx.update(stories).set({ title, content, updatedAt: new Date(), revision: row.story.revision + 1,
          ...(row.story.length === null ? {} : { length: countStoryText(content) }),
        }).where(eq(stories.id, row.story.id)); count++;
      }
      return count;
    });
    console.log(`Обновлено базовых демозаписей: ${changed}. Даты, этапы, доступ, группы, голоса и остальные работы сохранены.`);
  } finally { client.close(); }
}
main().catch((error) => { console.error(error instanceof Error && !('cause' in error) ? error.message : "Не удалось обновить демотексты; транзакция отменена."); process.exitCode = 1; });
