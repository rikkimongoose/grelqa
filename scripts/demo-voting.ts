import "dotenv/config";
import { randomBytes, scryptSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/db/connection";
import { contests, contestThemes, users, participations, stories, contestGroups, storyRounds, firstRoundFormations } from "../src/db/schema";
import { balancedBlockPlan, selectVotingStory, type FormationSnapshot } from "../src/contests/grouping-rules";
import { countStoryText, LENGTH_ALGORITHM } from "../src/lib/submission";
import { refreshRoundOneExemptions } from "../src/voting/eligibility";

async function main() {
  if (process.env.NODE_ENV !== "development") throw new Error("Демосценарий разрешён только в development.");
  const { db, client } = await openDatabase();
  try {
    await db.transaction(async (tx) => {
      const id = "demo-first-round-voting";
      const [existing] = await tx.select({ id: contests.id }).from(contests).where(eq(contests.id, id));
      if (existing) { console.log("Демоконкурс голосования уже существует; данные и сроки не изменены."); return; }
      const now = new Date();
      let start = new Date(now.toISOString().slice(0, 10) + "T12:00:00Z");
      const used = new Set((await tx.select({ day: contests.startDayMoscow }).from(contests)).map((row) => row.day));
      while (+start >= +now - 3 * 86400_000 || used.has(start.toISOString().slice(0, 10))) start = new Date(+start - 86400_000);
      for (let n = 1; n <= 9; n++) {
        const salt = randomBytes(16).toString("hex");
        await tx.insert(users).values({ id: `demo-vote-author-${n}`, email: `voting-reader-${n}@grelqa.example`,
          passwordHash: `scrypt:${salt}:${scryptSync(randomBytes(32), salt, 64).toString("hex")}`, emailVerifiedAt: now, createdAt: start });
      }
      await tx.insert(contests).values({ id, slug: id, organizerId: "demo-vote-author-1", title: "Голоса в читальном зале", description: "Отдельный вымышленный конкурс для проверки первого тура: две группы 9/8, девять авторов.",
        stage: "round-one", submissionsStartAt: start, startDayMoscow: start.toISOString().slice(0, 10), submissionsEndAt: new Date(+now - 2 * 3600_000),
        roundOneStartAt: new Date(+now - 3600_000), roundTwoStartAt: new Date(+now + 7 * 86400_000), endsAt: new Date(+now + 14 * 86400_000),
        groupCapacity: 9, finalCapacity: 6, isDemo: true, createdAt: now });
      await tx.insert(contestThemes).values({ contestId: id, theme: "Открытая книга", conditions: ["Демонстрация первого тура; все авторы вымышлены."], enteredAt: new Date(+start - 60000), publishedAt: start });
      for (let n = 1; n <= 9; n++) await tx.insert(participations).values({ id: `demo-vote-member-${n}`, contestId: id, userId: `demo-vote-author-${n}`, createdAt: start });
      const ranked = [];
      for (let n = 1; n <= 17; n++) {
        const author = Math.min(n, 9);
        const content = [{ type: "paragraph" as const, children: [{ text: `В читальном зале открыли книгу. ${"За окном шёл дождь. ".repeat(n)}`, italic: n % 2 === 0, bold: n % 3 === 0 }] }];
        const row = { id: `demo-vote-story-${n}`, contestId: id, participationId: `demo-vote-member-${author}`, title: `Рассказ ${String(n).padStart(2, "0")}`, content,
          length: countStoryText(content), lengthAlgorithm: LENGTH_ALGORITHM, status: "admitted" as const, createdAt: new Date(+start + n * 1000), updatedAt: now, publishedAt: now };
        await tx.insert(stories).values(row); ranked.push(row);
      }
      const plan = balancedBlockPlan(ranked, 9, 6);
      const snapshot: FormationSnapshot = { version: "size-blocks-v2", formedAt: now.toISOString(), eligibleCount: 17, authorCount: 9, originalCapacity: 9, effectiveCapacity: plan.effectiveCapacity,
        groups: plan.groups.map((group) => ({ ...group, id: `demo-vote-group-${group.number}` })), assignments: [] };
      for (const group of snapshot.groups) {
        await tx.insert(contestGroups).values({ id: group.id, contestId: id, round: 1, number: group.number, capacity: group.capacity, publishedAt: now });
        for (const storyId of group.storyIds) await tx.insert(storyRounds).values({ storyId, contestId: id, round: 1, groupId: group.id });
      }
      for (let n = 1; n <= 9; n++) {
        const selected = selectVotingStory(ranked.filter((row) => row.participationId === `demo-vote-member-${n}`))!;
        const group = snapshot.groups.find((group) => group.storyIds.includes(selected.id))!;
        snapshot.assignments.push({ participationId: `demo-vote-member-${n}`, groupId: group.id, selectedStoryId: selected.id });
        await tx.update(participations).set({ assignedGroupId: group.id, assignedRound: 1, mustVoteRoundOne: true }).where(eq(participations.id, `demo-vote-member-${n}`));
      }
      await tx.insert(firstRoundFormations).values({ contestId: id, formedAt: now, snapshot });
      await refreshRoundOneExemptions(tx, id, now);
      console.log("Создан /contests/demo-first-round-voting: первый тур открыт на 7 дней. Восстановите доступ voting-reader-1@grelqa.example через локальную почту; voting-reader-9 освобождён от голосования.");
    });
  } finally { client.close(); }
}
main().catch(() => { console.error("Не удалось создать демоконкурс голосования. Нужны development, миграции и свободные demo-ID/email/slug."); process.exitCode = 1; });
