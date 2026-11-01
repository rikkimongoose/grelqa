import "server-only";
import { and, asc, eq, isNull, lte, notExists, sql } from "drizzle-orm";
import { groupPublication } from "../db/story-publication";
import { getDatabase } from "../db";
import { contestGroups, contests, firstRoundFormations, participations, stories, storyRounds } from "../db/schema";
import { isOwnStory, publicFailureMessage } from "./grouping-rules";
import { alias } from "drizzle-orm/sqlite-core";

export async function publicGroupingState(slug: string) {
  const { db } = await getDatabase();
  const [contest] = await db.select({ id: contests.id, stage: contests.stage, start: contests.roundOneStartAt }).from(contests).where(eq(contests.slug, slug));
  if (!contest) return "not-formed" as const;
  if (contest.stage === "failed") return "failed" as const;
  const groups = await db.select({ id: contestGroups.id }).from(contestGroups).innerJoin(contests, eq(contestGroups.contestId, contests.id))
    .where(and(eq(contests.slug, slug), eq(contestGroups.round, 1), groupPublication(db, new Date())));
  if (groups.length) return "published" as const;
  const [hidden] = await db.select({ id: contestGroups.id }).from(contestGroups).where(and(eq(contestGroups.contestId, contest.id), eq(contestGroups.round, 1))).limit(1);
  return hidden ? "formed-private" as const : "not-formed" as const;
}

export async function myVotingGroups(userId: string) {
  const { db } = await getDatabase();
  const rows = await db.select({ id: participations.id, groupId: participations.assignedGroupId,
    contestId: contests.id, title: contests.title, slug: contests.slug, stage: contests.stage, failureReason: contests.failureReason, start: contests.roundOneStartAt,
    number: contestGroups.number, publishedAt: contestGroups.publishedAt, formationId: firstRoundFormations.contestId,
  }).from(participations).innerJoin(contests, eq(participations.contestId, contests.id))
    .leftJoin(contestGroups, eq(participations.assignedGroupId, contestGroups.id))
    .leftJoin(firstRoundFormations, eq(firstRoundFormations.contestId, contests.id))
    .where(eq(participations.userId, userId)).orderBy(asc(contests.title));
  const author = alias(participations, "story_author");
  const withdrawn = alias(storyRounds, "withdrawn_round");
  return Promise.all(rows.map(async (row) => {
    const published = (row.formationId !== null && ["moderation", "round-one", "round-two", "completed"].includes(row.stage)) || (row.publishedAt !== null && +row.publishedAt <= Date.now() && +row.start <= Date.now() && ["round-one", "round-two", "completed"].includes(row.stage));
    let otherWorks: number | null = null;
    if (published && row.groupId && row.stage === "round-one") {
      const targets = await db.select({ authorUserId: author.userId }).from(storyRounds)
        .innerJoin(stories, eq(storyRounds.storyId, stories.id)).innerJoin(author, eq(stories.participationId, author.id))
        .where(and(eq(storyRounds.groupId, row.groupId), eq(storyRounds.round, 1), eq(storyRounds.status, "active"), eq(stories.status, "admitted"),
          isNull(stories.withdrawnAt), row.formationId ? undefined : lte(stories.publishedAt, new Date()),
          notExists(db.select({ one: sql`1` }).from(withdrawn).where(and(eq(withdrawn.storyId, stories.id), eq(withdrawn.status, "withdrawn")))),
        ));
      // Исключаются все работы автора, а не только самая длинная.
      otherWorks = targets.filter((target) => !isOwnStory(userId, target.authorUserId)).length;
    }
    return { slug: row.slug, title: row.title, number: row.number, assigned: row.groupId !== null,
      href: `/contests/${encodeURIComponent(row.slug)}${published && row.groupId ? `#group-${row.groupId}` : "#stories"}`,
      waitingPublication: row.groupId !== null && !published,
      message: row.stage === "failed" ? `Конкурс не состоялся. ${publicFailureMessage(row.failureReason)}` : row.groupId ? null : row.formationId ? "Группа для голосования не назначена." : "Группы ещё не сформированы.",
      otherWorks };
  }));
}
