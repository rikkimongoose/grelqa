import "server-only";
import { and, eq, exists, inArray, lte, or, sql } from "drizzle-orm";
import type { Database } from "./connection";
import { contests, contestGroups, firstRoundFormations, stories, storyRounds } from "./schema";

// Successful formation publishes the first round immediately, including legacy snapshots.
// Failed checkpoints and merely hand-created groups are not publication events.
export function successfulFormation(db: Pick<Database, "select">) {
  return exists(db.select({ one: sql`1` }).from(firstRoundFormations).where(and(
    eq(firstRoundFormations.contestId, contests.id),
    sql`json_extract(${firstRoundFormations.snapshot}, '$.kind') is null`,
  )));
}
export function groupedStory(db: Pick<Database, "select">, storyId: typeof stories.id) {
  return exists(db.select({ one: sql`1` }).from(storyRounds).innerJoin(contestGroups, eq(storyRounds.groupId, contestGroups.id)).where(and(
    eq(storyRounds.storyId, storyId), eq(storyRounds.contestId, contests.id), eq(storyRounds.round, 1),
  )));
}
export function formedPublication(db: Pick<Database, "select">) {
  return and(inArray(contests.stage, ["moderation", "round-one", "round-two", "completed"]), successfulFormation(db));
}
export function groupPublication(db: Pick<Database, "select">, now: Date) {
  return or(
    and(inArray(contests.stage, ["round-one", "round-two", "completed"]), lte(contests.roundOneStartAt, now), lte(contestGroups.publishedAt, now),
      lte(contestGroups.round, sql`case when ${contests.stage} = 'round-one' then 1 else 2 end`)),
    and(formedPublication(db), eq(contestGroups.round, 1)),
  );
}
