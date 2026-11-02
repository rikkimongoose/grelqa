import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "../db";
import { writeTransaction } from "../db/write-transaction";
import { contests, contestGroups, stories, storyRounds } from "../db/schema";
import { adminEvent, contestManager, ManagementError } from "./access";
import { criticatUrl, aiGeneration } from "../lib/story-annotations";

export const annotationInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("contest-discussion"), value: criticatUrl }).strict(),
  z.object({ kind: z.literal("group-discussion"), id: z.string().min(1).max(200), value: criticatUrl }).strict(),
  z.object({ kind: z.literal("story-ai"), id: z.string().min(1).max(200), value: aiGeneration }).strict(),
]);
export async function saveAnnotation(token: string, slug: string, input: unknown) {
  const data = annotationInput.parse(input); const { db } = await getDatabase();
  return writeTransaction(db, async (tx) => {
    const [contest] = await tx.select().from(contests).where(eq(contests.slug, slug));
    if (!contest) throw new ManagementError("Конкурс не найден.", 404);
    const actor = await contestManager(tx, token, contest, true);
    let before: string | number | null; let groupIds: string[] = [];
    if (data.kind === "contest-discussion") {
      before = contest.criticatDiscussionUrl;
      if (before !== data.value) await tx.update(contests).set({ criticatDiscussionUrl: data.value, settingsRevision: contest.settingsRevision + 1 }).where(eq(contests.id, contest.id));
    } else if (data.kind === "group-discussion") {
      const [group] = await tx.select().from(contestGroups).where(and(eq(contestGroups.id, data.id), eq(contestGroups.contestId, contest.id)));
      if (!group) throw new ManagementError("Группа этого конкурса не найдена.", 404);
      before = group.criticatDiscussionUrl; groupIds = [group.id];
      if (before !== data.value) await tx.update(contestGroups).set({ criticatDiscussionUrl: data.value }).where(eq(contestGroups.id, group.id));
    } else {
      const [story] = await tx.select({ id: stories.id, value: stories.aiGenerationBasisPoints }).from(stories).where(and(eq(stories.id, data.id), eq(stories.contestId, contest.id)));
      if (!story) throw new ManagementError("Рассказ этого конкурса не найден.", 404);
      before = story.value;
      if (before !== data.value) await tx.update(stories).set({ aiGenerationBasisPoints: data.value }).where(eq(stories.id, story.id));
      groupIds = (await tx.select({ id: storyRounds.groupId }).from(storyRounds).where(and(eq(storyRounds.storyId, story.id), eq(storyRounds.contestId, contest.id)))).map((g) => g.id);
    }
    if (before !== data.value) await adminEvent(tx, contest.id, actor.id, data.kind, { ...(data.kind === "contest-discussion" ? {} : { id: data.id }), before, after: data.value, ...(data.kind === "story-ai" ? { unit: "hundredths-percent" } : {}) });
    // These annotations are live metadata; never rewrite scores, snapshots, ballots, story revision
    // or publicUpdatedAt consumed by the unchanged announcement feed.
    return { groupIds, storyId: data.kind === "story-ai" ? data.id : null, message: "Информация сохранена. Баллы, места и права участия не изменены." };
  });
}
