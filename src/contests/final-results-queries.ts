import "server-only";
import { eq } from "drizzle-orm";
import { getDatabase } from "../db";
import { contests, contestFinalizations, participations } from "../db/schema";
import type { FinalizationSnapshot } from "./finalization-types";
import { publicFailureMessage } from "./grouping-rules";

function publicResult(snapshot: FinalizationSnapshot) {
  const failed = snapshot.tally.outcome === "failed";
  const names = new Map(snapshot.authors.map((a) => [a.storyId, a.name]));
  return { completedAt: snapshot.completedAt, round: snapshot.round, failed, failureMessage: publicFailureMessage(snapshot.tally.failureReason),
    stories: snapshot.tally.results.map((r) => ({ id: r.id, title: r.title, points: failed ? null : r.points, place: failed ? null : r.place,
      shared: !failed && r.shared, winner: !failed && snapshot.winners.includes(r.id), authorName: failed ? null : names.get(r.id) ?? null,
      readable: !failed && !r.withdrawn, withdrawn: r.withdrawn,
      withdrawalMessage: r.withdrawalCode === "not-voted" ? "Снята: обязательное голосование не выполнено." : r.withdrawn ? "Работа снята с тура." : null,
    })).sort((a, b) => (a.place ?? Infinity) - (b.place ?? Infinity)) };
}
export async function publicFinalResults(slug: string) {
  const { db } = await getDatabase();
  const [row] = await db.select({ snapshot: contestFinalizations.snapshot, stage: contests.stage }).from(contestFinalizations)
    .innerJoin(contests, eq(contestFinalizations.contestId, contests.id)).where(eq(contests.slug, slug));
  if (!row || !["completed", "failed"].includes(row.stage)) return undefined;
  return publicResult(row.snapshot);
}
export async function ownFinalResults(userId: string) {
  const { db } = await getDatabase();
  const rows = await db.select({ title: contests.title, slug: contests.slug, snapshot: contestFinalizations.snapshot, memberId: participations.id }).from(participations)
    .innerJoin(contests, eq(participations.contestId, contests.id)).innerJoin(contestFinalizations, eq(contestFinalizations.contestId, contests.id)).where(eq(participations.userId, userId));
  return rows.map(({ title, slug, snapshot, memberId }) => {
    const ids = new Set(snapshot.tally.audit.stories.filter((s) => s.participationId === memberId).map((s) => s.id));
    const result = publicResult(snapshot);
    return { ...result, title, slug, stories: result.stories.filter((s) => ids.has(s.id)) };
  });
}
