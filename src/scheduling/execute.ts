import { eq } from "drizzle-orm";
import { writeTransaction, type TransactionDatabase } from "../db/write-transaction";
import { contests, contestTransitionRuns } from "../db/schema";
import { currentTime } from "../server/clock";
import { contestManager, ManagementError } from "../management/access";
import { closeReception, formFirstRound, GroupingError } from "../contests/grouping";
import { startContestPhase } from "../contests/start";
import { closeFirstRound, ClosureError } from "../contests/close-first-round";
import { prepareFinal, FinalPreparationError } from "../contests/prepare-final";
import { finalizeContest, FinalizationError } from "../contests/finalize";
import { publicFailureMessage } from "../contests/grouping-rules";
import { schedulerAuthority, type TransitionAuthority } from "./authority";
import { nextTransition, operationDone, transitionState, inconsistentHistory, type TransitionAction } from "./plan";

export type TransitionReport = { slug: string; action: TransitionAction | null; status: "success" | "blocked" | "error" | "wait" | "noop"; at: string; message: string };
function safeError(error: unknown) {
  if (error instanceof ManagementError || error instanceof GroupingError || error instanceof ClosureError || error instanceof FinalPreparationError || error instanceof FinalizationError) return { status: "blocked" as const, message: error.message };
  return { status: "error" as const, message: "Операция откатилась из-за внутренней ошибки. Проверьте миграции и журнал службы; безопасно повторите запуск." };
}
async function dispatch(db: TransactionDatabase, slug: string, action: TransitionAction, actor: TransitionAuthority) {
  switch (action) {
    case "start-reception": case "start-first": return startContestPhase(db, slug, action, actor);
    case "close-reception": return closeReception(db, slug, actor);
    case "form": { const result = await formFirstRound(db, slug, actor); if (result.status === "blocked") throw new ManagementError(result.questions.join(" "), 409); return result; }
    case "close-first": return closeFirstRound(db, slug, actor);
    case "prepare-final": return prepareFinal(db, slug, actor);
    case "finalize": return finalizeContest(db, slug, actor);
  }
}
// The outer SQLite write lock covers decision, nested operation and run journal.
// Drizzle's nested transaction is a SAVEPOINT: failed business writes roll back before logging failure.
export async function executeTransition(db: TransactionDatabase, slug: string, authority: TransitionAuthority, requested?: TransitionAction): Promise<TransitionReport> {
  return writeTransaction(db, async (tx) => {
    const [contest] = await tx.select().from(contests).where(eq(contests.slug, slug));
    if (!contest) throw new ManagementError("Конкурс не найден.", 404);
    const actor = authority === schedulerAuthority ? null : await contestManager(tx, authority, contest);
    if (contest.isDraft) throw new ManagementError("Подготовка не опубликована.", 409);
    const state = await transitionState(tx, contest), next = nextTransition(state), started = currentTime();
    const action = requested ?? next?.action ?? null;
    const report = (status: TransitionReport["status"], message: string): TransitionReport => ({ slug, action, status, at: started.toISOString(), message });
    if (!action || (!requested && next && +started < +new Date(next.at))) return report("wait", "Наступивших переходов нет.");
    const inconsistency = inconsistentHistory(state);
    if (!inconsistency && operationDone(state, action)) return report("noop", "Операция уже выполнена; сохранённый результат не изменён.");
    let outcome: "success" | "blocked" | "error" = "success", message = "Переход выполнен и зафиксирован.";
    try {
      if (inconsistency) throw new ManagementError(inconsistency, 409);
      await dispatch(tx, slug, action, authority);
      const [after] = await tx.select({ stage: contests.stage, reason: contests.failureReason }).from(contests).where(eq(contests.id, contest.id));
      if (after.stage === "failed") message = `Конкурс не состоялся. ${publicFailureMessage(after.reason)}`;
      else if (action === "form") message = "Группы сформированы и опубликованы.";
    }
    catch (error) { const failure = safeError(error); outcome = failure.status; message = failure.message; }
    await tx.insert(contestTransitionRuns).values({ contestId: contest.id, action, source: authority === schedulerAuthority ? "scheduled" : "manual", actorId: actor?.id ?? null,
      startedAt: started, finishedAt: currentTime(), outcome, message });
    return report(outcome, message);
  });
}
