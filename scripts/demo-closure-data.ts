import { randomBytes, scryptSync } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../src/db/connection";
import { users, contests, contestThemes, participations, stories, storyRounds, contestGroups, firstRoundFormations, ballots, ballotEntries, ballotDrafts } from "../src/db/schema";
import { countStoryText, LENGTH_ALGORITHM } from "../src/lib/submission";
import type { FormationSnapshot } from "../src/contests/grouping-rules";

export async function seedClosureDemo(db: Database, slug = "demo-first-round-results") {
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: contests.id }).from(contests).where(eq(contests.slug, slug));
    if (existing) return false;
    const now = new Date(); const deadline = new Date(+now - 10 * 60_000); const roundStart = new Date(+deadline - 2 * 86400_000);
    let start = new Date(now.toISOString().slice(0, 10) + "T12:00:00Z");
    const used = new Set((await tx.select({ day: contests.startDayMoscow }).from(contests)).map((row) => row.day));
    while (+start >= +roundStart - 86400_000 || used.has(start.toISOString().slice(0, 10))) start = new Date(+start - 86400_000);
    const uid = (n: number) => `${slug}-author-${n}`, pid = (n: number) => `${slug}-member-${n}`, sid = (n: number) => `${slug}-story-${n}`, gid = (n: number) => `${slug}-group-${n}`;
    for (let n = 1; n <= 7; n++) {
      const salt = randomBytes(16).toString("hex");
      await tx.insert(users).values({ id: uid(n), email: `${slug}-${n}@grelqa.example`, passwordHash: `scrypt:${salt}:${scryptSync(randomBytes(32), salt, 64).toString("hex")}`, emailVerifiedAt: start, createdAt: start });
    }
    await tx.insert(contests).values({ id: slug, slug, organizerId: uid(1), title: "Итоги в читальном зале", description: "Вымышленный пример: полное равенство на границе, недобор и снятие за неголосование.",
      stage: "round-one", submissionsStartAt: start, startDayMoscow: start.toISOString().slice(0, 10), submissionsEndAt: new Date(+roundStart - 3600_000),
      roundOneStartAt: roundStart, roundTwoStartAt: deadline, endsAt: new Date(+now + 7 * 86400_000), groupCapacity: 5, finalCapacity: 6, createdAt: start, isDemo: true });
    await tx.insert(contestThemes).values({ contestId: slug, theme: "Общая полка", conditions: ["Все длины равны. Таблица заранее рассчитана для проверки закрытия."], enteredAt: new Date(+start - 1000), publishedAt: start });
    for (let n = 1; n <= 7; n++) await tx.insert(participations).values({ id: pid(n), userId: uid(n), contestId: slug, assignedGroupId: null, mustVoteRoundOne: n !== 7,
      roundOneExemptAt: n === 7 ? roundStart : null, roundOneExemptReason: n === 7 ? "no-eligible-stories" : null, createdAt: start });
    const snapshot: FormationSnapshot = { version: "size-blocks-v2", formedAt: roundStart.toISOString(), eligibleCount: 15, authorCount: 7, originalCapacity: 5, effectiveCapacity: 5,
      groups: [1, 2, 3].map((n) => ({ id: gid(n), number: n, capacity: 5, storyIds: Array.from({ length: 5 }, (_, i) => sid((n - 1) * 5 + i + 1)) })), assignments: [] };
    for (const group of snapshot.groups) await tx.insert(contestGroups).values({ id: group.id, contestId: slug, round: 1, number: group.number, capacity: 5, publishedAt: roundStart });
    const authors = [1, 2, 3, 4, 5, 5, 6, 1, 2, 3, 7, 7, 7, 7, 7];
    const content = [{ type: "paragraph" as const, children: [{ text: "Открытая книга лежала у окна. Каждый читатель находил на полях свою историю." }] }];
    for (let n = 1; n <= 15; n++) {
      await tx.insert(stories).values({ id: sid(n), contestId: slug, participationId: pid(authors[n - 1]), title: `История ${String(n).padStart(2, "0")}`, content,
        length: countStoryText(content), lengthAlgorithm: LENGTH_ALGORITHM, status: "admitted", createdAt: new Date(+start + n * 1000), updatedAt: roundStart, publishedAt: roundStart });
      const withdrawn = n >= 8 && n <= 10;
      await tx.insert(storyRounds).values({ storyId: sid(n), contestId: slug, round: 1, groupId: gid(Math.ceil(n / 5)), status: withdrawn ? "withdrawn" : "active",
        withdrawnAt: withdrawn ? new Date(+deadline - 5 * 60_000) : null, withdrawalReason: withdrawn ? "Снята автором" : null });
    }
    for (let n = 1; n <= 7; n++) {
      const selected = n <= 5 ? n : n === 6 ? 7 : 11;
      const groupId = gid(Math.ceil(selected / 5));
      snapshot.assignments.push({ participationId: pid(n), groupId, selectedStoryId: sid(selected) });
      await tx.update(participations).set({ assignedGroupId: groupId }).where(eq(participations.id, pid(n)));
    }
    await tx.insert(firstRoundFormations).values({ contestId: slug, formedAt: roundStart, snapshot });
    const choices = new Map([[1, [2, 3, 4, 5]], [2, [1, 3, 4, 5]], [3, [1, 2, 4, 5]], [4, [3, 2, 1, 5]], [6, [6, 8, 9, 10]]]);
    for (const [n, selected] of choices) {
      const ballotId = `${slug}-ballot-${n}`, groupId = gid(n === 6 ? 2 : 1), sentAt = new Date(+deadline - 3600_000);
      await tx.insert(ballots).values({ id: ballotId, participationId: pid(n), contestId: slug, round: 1, groupId, createdAt: sentAt, updatedAt: sentAt, submittedAt: sentAt });
      for (const [index, selectedId] of selected.entries()) await tx.insert(ballotEntries).values({ ballotId, storyId: sid(selectedId), contestId: slug, round: 1, groupId, position: index + 1 });
    }
    // Neither a nonvoter's incomplete draft nor a submitted voter's alternative draft counts.
    for (const n of [1, 5]) await tx.insert(ballotDrafts).values({ participationId: pid(n), contestId: slug, round: 1, groupId: gid(1), selections: n === 1 ? [sid(4), sid(3)] : [sid(1)], revision: 1, updatedAt: new Date(+deadline - 60000) });
    return true;
  });
}
