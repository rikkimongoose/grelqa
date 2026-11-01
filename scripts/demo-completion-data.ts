import { eq } from "drizzle-orm";
import type { Database } from "../src/db/connection";
import * as s from "../src/db/schema";
import { seedClosureDemo } from "./demo-closure-data";
import { closeFirstRound } from "../src/contests/close-first-round";
import { prepareFinal } from "../src/contests/prepare-final";

// A dedicated, fictional fixture. Existing contests (even demos) are never changed on rerun.
export async function seedCompletionDemo(db: Database, slug = "demo-completed-contest") {
  if (process.env.NODE_ENV !== "development") throw new Error("development required");
  const created = await seedClosureDemo(db, slug);
  if (!created) return false;
  await closeFirstRound(db, slug);
  const final = await prepareFinal(db, slug);
  await db.transaction(async (tx) => {
    const now = new Date();
    // All dates belong to this newly created fixture. No changes to user contests.
    const start = new Date(+now - 8 * 60_000), sentAt = new Date(+now - 5 * 60_000), end = new Date(+now - 60_000);
    for (let n = 1; n <= 7; n++) await tx.update(s.users).set({ publicName: n === 6 ? null : `Репортёр ${n}` }).where(eq(s.users.id, `${slug}-author-${n}`));
    await tx.update(s.contests).set({ title: "Последний репортаж с обочины", description: "Вымышленный финал: один голос автора, отдельные черновики и снятие всех работ за неголосование.", roundTwoStartAt: start, endsAt: end }).where(eq(s.contests.id, slug));
    // The admission snapshot records the original dates; current fixture schedule is explicit.
    // Works 1,2,3 belong to distinct authors, 7 to author 6, 11..15 to author 7.
    // Author 2 has a draft only and is sanctioned. Author 7 has five works and no vote: all five removed.
    const choices = new Map([[1, [2, 3, 7, 11, 12, 13]], [3, [2, 1, 7, 11, 12, 13]], [6, [1, 3, 2, 11, 12, 13]]]);
    for (const [n, selected] of choices) {
      const ballotId = `${slug}-final-ballot-${n}`;
      await tx.insert(s.ballots).values({ id: ballotId, contestId: slug, participationId: `${slug}-member-${n}`, round: 2, groupId: final.groupId, createdAt: sentAt, updatedAt: sentAt, submittedAt: sentAt });
      for (const [i, story] of selected.entries()) await tx.insert(s.ballotEntries).values({ ballotId, storyId: `${slug}-story-${story}`, contestId: slug, round: 2, groupId: final.groupId, position: i + 1 });
    }
    for (const n of [1, 2]) await tx.insert(s.ballotDrafts).values({ contestId: slug, participationId: `${slug}-member-${n}`, round: 2, groupId: final.groupId, selections: [`${slug}-story-3`], revision: 1, updatedAt: sentAt });
  });
  return true;
}
