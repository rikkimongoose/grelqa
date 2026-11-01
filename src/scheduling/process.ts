import { and, asc, eq, exists, inArray, lte, notExists, or, sql } from "drizzle-orm";
import { ManagementError } from "../management/access";
import type { TransactionDatabase } from "../db/write-transaction";
import { contests, firstRoundClosures, contestFinalizations } from "../db/schema";
import { withClock, currentTime } from "../server/clock";
import { executeTransition, type TransitionReport } from "./execute";
import { schedulerAuthority, type TransitionAuthority } from "./authority";

export const MAX_TRANSITIONS_PER_CONTEST = 10;
export const MAX_TRANSITIONS_PER_RUN = 100;
export async function processContestSchedule(db: TransactionDatabase, slug: string, authority: TransitionAuthority = schedulerAuthority, maxSteps = MAX_TRANSITIONS_PER_CONTEST) {
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > MAX_TRANSITIONS_PER_CONTEST) throw new Error("Invalid transition bound");
  const reports: TransitionReport[] = [];
  for (let step = 0; step < maxSteps; step++) {
    try {
      const result = await executeTransition(db, slug, authority);
      if (result.status === "wait" || result.status === "noop") return { reports, limited: false };
      reports.push(result);
      if (result.status !== "success") return { reports, limited: false };
    } catch (error) {
      if (authority !== schedulerAuthority && error instanceof ManagementError) throw error;
      // Includes a journal/database failure: the outer transaction rolled back, including the operation.
      // A disconnected DB cannot store its own error. Preserve a safe CLI report and continue other contests.
      reports.push({ slug, action: null, status: "error", at: currentTime().toISOString(), message: "Не удалось зафиксировать обработку конкурса. Последняя незавершённая транзакция откатилась; повторите запуск." });
      return { reports, limited: false };
    }
  }
  return { reports, limited: true };
}
export async function processSchedule(db: TransactionDatabase, options: { slug?: string; maxSteps?: number; clock?: () => Date } = {}) {
  const run = async () => {
    const due = or(
      and(eq(contests.stage, "preparation"), lte(contests.submissionsStartAt, currentTime())),
      and(eq(contests.stage, "submissions"), lte(contests.submissionsEndAt, currentTime())),
      and(eq(contests.stage, "moderation"), lte(contests.roundOneStartAt, currentTime())),
      and(eq(contests.stage, "round-one"), sql`coalesce(${contests.roundTwoStartAt}, ${contests.endsAt}) <= ${+currentTime()}`),
      and(eq(contests.stage, "round-two"), lte(contests.endsAt, currentTime())),
      and(inArray(contests.stage, ["completed", "failed"]),
        exists(db.select({ one: sql`1` }).from(firstRoundClosures).where(eq(firstRoundClosures.contestId, contests.id))),
        notExists(db.select({ one: sql`1` }).from(contestFinalizations).where(eq(contestFinalizations.contestId, contests.id)))),
    );
    const rows = await db.select({ slug: contests.slug }).from(contests).where(and(eq(contests.isDraft, false), options.slug ? eq(contests.slug, options.slug) : due)).orderBy(sql`coalesce((select max(finished_at) from contest_transition_runs where contest_id = ${contests.id}), 0)`, asc(contests.id));
    if (options.slug && !rows.some((r) => r.slug === options.slug)) throw new Error("Опубликованный конкурс с указанным slug не найден.");
    const results = []; let used = 0; let capped = false;
    for (const row of rows) {
      if (options.slug && row.slug !== options.slug) continue;
      if (used >= MAX_TRANSITIONS_PER_RUN) { capped = true; break; }
      const result = await processContestSchedule(db, row.slug, schedulerAuthority, Math.min(options.maxSteps ?? MAX_TRANSITIONS_PER_CONTEST, MAX_TRANSITIONS_PER_RUN - used));
      used += result.reports.length;
      results.push({ slug: row.slug, ...result });
    }
    return { contests: results, failed: results.some((r) => r.reports.some((e) => e.status === "blocked" || e.status === "error")), limited: capped || results.some((r) => r.limited) };
  };
  return options.clock ? withClock(options.clock, run) : run();
}
