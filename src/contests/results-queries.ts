import "server-only";
import { getPublicStoryGroups } from "../db/public-stories";
import { eq } from "drizzle-orm";
import { getDatabase } from "../db";
import { contests, firstRoundClosures, participations } from "../db/schema";
import type { ClosureResult } from "./closure-rules";
import { publicFailureMessage } from "./grouping-rules";

function publicRow(row: ClosureResult, failed: boolean) {
  return { id: row.id, title: row.title, points: failed ? null : row.points, place: failed ? null : row.place,
    shared: !failed && row.shared, finalist: !failed && row.finalist, withdrawn: row.withdrawn,
    readable: !failed && !row.withdrawn,
    withdrawalMessage: row.withdrawalCode === "not-voted" ? "Снята: обязательное голосование не выполнено." : row.withdrawn ? "Работа снята с первого тура." : null,
  };
}
export async function publicFirstRoundResults(slug: string) {
  const { db } = await getDatabase();
  const [row] = await db.select({ snapshot: firstRoundClosures.snapshot, stage: contests.stage }).from(firstRoundClosures)
    .innerJoin(contests, eq(firstRoundClosures.contestId, contests.id)).where(eq(contests.slug, slug));
  if (!row || ["preparation", "submissions"].includes(row.stage)) return undefined;
  const { snapshot } = row; const failed = snapshot.outcome === "failed";
  const readable = new Set((await getPublicStoryGroups(slug)).flatMap((g) => g.stories.map((s) => s.id)));
  // Explicit DTO: no audit, user/participation IDs, ballots, vote counts or unpublished drafts.
  return { closedAt: snapshot.closedAt, failed, failureMessage: failed ? publicFailureMessage(snapshot.failureReason) : null,
    singleRound: snapshot.settings.singleRound, quota: snapshot.settings.quota,
    groups: snapshot.groups.map((group) => ({ key: group.id, number: group.number,
      stories: snapshot.results.filter((item) => item.groupId === group.id)
        .sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity))
        .map((item) => ({ ...publicRow(item, failed), readable: !failed && readable.has(item.id) })),
    })),
  };
}

export async function ownFirstRoundResults(userId: string) {
  const { db } = await getDatabase();
  const rows = await db.select({ title: contests.title, slug: contests.slug, snapshot: firstRoundClosures.snapshot, memberId: participations.id })
    .from(participations).innerJoin(contests, eq(participations.contestId, contests.id))
    .innerJoin(firstRoundClosures, eq(firstRoundClosures.contestId, contests.id)).where(eq(participations.userId, userId));
  return rows.map(({ title, slug, snapshot, memberId }) => {
    const ownIds = new Set(snapshot.audit.stories.filter((story) => story.participationId === memberId).map((story) => story.id));
    return { title, slug, failed: snapshot.outcome === "failed", status: snapshot.audit.members.find((member) => member.id === memberId)?.votingStatus ?? "not-eligible",
      stories: snapshot.results.filter((item) => ownIds.has(item.id)).map((item) => publicRow(item, snapshot.outcome === "failed")),
    };
  });
}
