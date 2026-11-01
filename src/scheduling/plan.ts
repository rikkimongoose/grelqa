import { eq } from "drizzle-orm";
import type { TransactionDatabase } from "../db/write-transaction";
import { contests, firstRoundFormations, firstRoundClosures, finalRounds, contestFinalizations } from "../db/schema";
import { firstRoundDeadline } from "../voting/eligibility";
export const actions = ["start-reception", "close-reception", "form", "start-first", "close-first", "prepare-final", "finalize"] as const;
export type TransitionAction = typeof actions[number];
export const actionLabels: Record<TransitionAction, string> = {
  "start-reception": "Опубликовать тему и начать приём", "close-reception": "Закрыть приём", form: "Сформировать группы", "start-first": "Начать первый тур", "close-first": "Закрыть первый тур", "prepare-final": "Подготовить финал", finalize: "Опубликовать окончательный итог",
};
export async function transitionState(db: Pick<TransactionDatabase, "select">, contest: typeof contests.$inferSelect) {
  const [formation] = await db.select().from(firstRoundFormations).where(eq(firstRoundFormations.contestId, contest.id));
  const [first] = await db.select().from(firstRoundClosures).where(eq(firstRoundClosures.contestId, contest.id));
  const [final] = await db.select().from(finalRounds).where(eq(finalRounds.contestId, contest.id));
  const [completed] = await db.select().from(contestFinalizations).where(eq(contestFinalizations.contestId, contest.id));
  return { contest, formation, first, final, completed };
}
export type TransitionState = Awaited<ReturnType<typeof transitionState>>;
export function nextTransition(state: TransitionState) {
  const { contest: c, formation, first, final, completed } = state;
  if (c.isDraft || completed) return null;
  const step = (action: TransitionAction, at: Date) => ({ action, at: at.toISOString(), label: actionLabels[action] });
  if (c.stage === "preparation") return step("start-reception", c.submissionsStartAt);
  if (c.stage === "submissions") return step("close-reception", c.submissionsEndAt);
  if (c.stage === "moderation") return step(formation ? "start-first" : "form", c.roundOneStartAt);
  if (c.stage === "round-one") return !first ? step("close-first", firstRoundDeadline(c)) : step("prepare-final", c.roundTwoStartAt ?? c.endsAt);
  if (c.stage === "round-two") return step("finalize", c.endsAt);
  if (first && (first.snapshot.settings.singleRound || first.snapshot.outcome === "failed")) return step("finalize", new Date(first.snapshot.deadline));
  // Failed theme/formation and legacy terminal records have nothing safe to recount.
  void final;
  return null;
}
export function operationDone(state: TransitionState, action: TransitionAction) {
  const { contest: c, formation, first, final, completed } = state;
  switch (action) {
    case "start-reception": return !c.isDraft && c.stage !== "preparation";
    case "close-reception": return !["preparation", "submissions"].includes(c.stage);
    case "form": return Boolean(formation);
    case "start-first": return Boolean(first || final || completed) || c.stage === "round-one" || c.stage === "round-two";
    case "close-first": return Boolean(first);
    case "prepare-final": return Boolean(final);
    case "finalize": return Boolean(completed);
  }
}

export function inconsistentHistory(state: TransitionState) {
  const { contest: c, formation, first, final } = state;
  if ((first && ["preparation", "submissions", "moderation"].includes(c.stage)) ||
      (final && !["round-two", "completed", "failed"].includes(c.stage)) ||
      (formation && ["preparation", "submissions"].includes(c.stage)) ||
      (formation && "kind" in formation.snapshot && c.stage !== "failed")) {
    return "Этап не соответствует уже сохранённой истории конкурса. Нужна проверка данных; автоматического возврата или перезаписи нет.";
  }
  return null;
}
