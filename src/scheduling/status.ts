import { and, desc, eq, ne } from "drizzle-orm";
import type { TransactionDatabase } from "../db/write-transaction";
import { contests, contestTransitionRuns } from "../db/schema";
import { currentTime } from "../server/clock";
import { nextTransition, transitionState, actionLabels, type TransitionAction } from "./plan";
export async function scheduleStatus(db: Pick<TransactionDatabase, "select">, contest: typeof contests.$inferSelect) {
  const [lastSuccess] = await db.select().from(contestTransitionRuns).where(and(eq(contestTransitionRuns.contestId, contest.id), eq(contestTransitionRuns.outcome, "success"))).orderBy(desc(contestTransitionRuns.id)).limit(1);
  const [lastError] = await db.select().from(contestTransitionRuns).where(and(eq(contestTransitionRuns.contestId, contest.id), ne(contestTransitionRuns.outcome, "success"))).orderBy(desc(contestTransitionRuns.id)).limit(1);
  const rows = await db.select().from(contestTransitionRuns).where(eq(contestTransitionRuns.contestId, contest.id)).orderBy(desc(contestTransitionRuns.id)).limit(30);
  const next = nextTransition(await transitionState(db, contest));
  const dto = (row: typeof lastSuccess | undefined) => row ? { action: actionLabels[row.action as TransitionAction] ?? "Переход", at: row.finishedAt.toISOString(), outcome: row.outcome, message: row.message, source: row.source } : null;
  return { lastSuccess: dto(lastSuccess), lastError: dto(lastError), errorResolved: Boolean(lastSuccess && lastError && lastSuccess.id > lastError.id), next,
    overdue: Boolean(next && +new Date(next.at) <= +currentTime()), history: rows.map(dto) };
}
