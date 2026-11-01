import { and, asc, eq, isNull, ne, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Database } from "../db/connection";
import { contests, contestGroups, firstRoundFormations, participations, stories, storyRounds } from "../db/schema";
import { parseStoryContent } from "../lib/story-content";

export type VotingDb = Pick<Database, "select" | "update">;
export type VotingContest = typeof contests.$inferSelect;
export const firstRoundDeadline = (contest: VotingContest) => contest.roundTwoStartAt ?? contest.endsAt;
export function firstRoundOpen(contest: VotingContest, at: Date) {
  return contest.stage === "round-one" && +contest.roundOneStartAt <= +at && +at < +firstRoundDeadline(contest);
}

export async function eligibleStories(db: VotingDb, contest: VotingContest, groupId: string, userId: string, now = new Date()) {
  const [group] = await db.select().from(contestGroups).where(and(eq(contestGroups.id, groupId), eq(contestGroups.contestId, contest.id), eq(contestGroups.round, 1)));
  if (!group || !["moderation", "round-one", "round-two", "completed"].includes(contest.stage)) return [];
  const [formation] = await db.select({ snapshot: firstRoundFormations.snapshot }).from(firstRoundFormations).where(eq(firstRoundFormations.contestId, contest.id));
  const formed = formation && !("kind" in formation.snapshot);
  const legacyPublic = ["round-one", "round-two", "completed"].includes(contest.stage) && +contest.roundOneStartAt <= +now && group.publishedAt !== null && +group.publishedAt <= +now;
  if (!formed && !legacyPublic) return [];
  const withdrawn = alias(storyRounds, "voting_withdrawn");
  const rows = await db.select({ id: stories.id, title: stories.title, content: stories.content, publishedAt: stories.publishedAt }).from(storyRounds)
    .innerJoin(stories, eq(storyRounds.storyId, stories.id)).innerJoin(participations, eq(stories.participationId, participations.id))
    .where(and(eq(storyRounds.contestId, contest.id), eq(storyRounds.groupId, groupId), eq(storyRounds.round, 1), eq(storyRounds.status, "active"),
      eq(stories.status, "admitted"), isNull(stories.withdrawnAt), ne(participations.userId, userId),
      notExists(db.select({ one: sql`1` }).from(withdrawn).where(and(eq(withdrawn.storyId, stories.id), eq(withdrawn.status, "withdrawn")))),
    )).orderBy(asc(stories.createdAt), asc(stories.id));
  return rows.filter((row) => (formed || row.publishedAt && +row.publishedAt <= +now) && parseStoryContent(row.content))
    .map(({ id, title }) => ({ id, title }));
}

// Called in the same write transaction as formation/withdrawal and before accepting votes.
export async function refreshRoundOneExemptions(db: VotingDb, contestId: string, now = new Date()) {
  const [contest] = await db.select().from(contests).where(eq(contests.id, contestId));
  if (!contest || !["moderation", "round-one"].includes(contest.stage) || +now >= +firstRoundDeadline(contest)) return;
  const members = await db.select().from(participations).where(eq(participations.contestId, contestId));
  for (const member of members) {
    if (!member.assignedGroupId || member.assignedRound !== 1 || (!member.mustVoteRoundOne && !member.roundOneExemptAt)) continue;
    const available = await eligibleStories(db, contest, member.assignedGroupId, member.userId, now);
    if (!available.length && !member.roundOneExemptAt) await db.update(participations).set({ mustVoteRoundOne: false, roundOneExemptAt: now, roundOneExemptReason: "no-eligible-stories" }).where(eq(participations.id, member.id));
    if (available.length && member.roundOneExemptAt) await db.update(participations).set({ mustVoteRoundOne: true, roundOneExemptAt: null, roundOneExemptReason: null }).where(eq(participations.id, member.id));
  }
}
