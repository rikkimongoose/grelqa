import { eq } from "drizzle-orm";
import { writeTransaction, type TransactionDatabase } from "../db/write-transaction";
import { contests, contestThemes, firstRoundFormations, firstRoundClosures } from "../db/schema";
import { transitionActor, adminEvent, ManagementError } from "../management/access";
import type { TransitionAuthority } from "../scheduling/authority";
import { currentTime } from "../server/clock";

export async function startContestPhase(db: TransactionDatabase, slug: string, action: "start-reception" | "start-first", authority: TransitionAuthority) {
  return writeTransaction(db, async (tx) => {
    const [contest] = await tx.select().from(contests).where(eq(contests.slug, slug));
    if (!contest) throw new ManagementError("Конкурс не найден.", 404);
    const actor = await transitionActor(tx, authority, contest);
    const now = currentTime();
    if (contest.isDraft) throw new ManagementError("Подготовка ещё не опубликована.", 409);
    if (action === "start-reception") {
      if (contest.stage !== "preparation" || +now < +contest.submissionsStartAt) throw new ManagementError("Начать приём сейчас нельзя.", 409);
      const [theme] = await tx.select({ entered: contestThemes.enteredAt }).from(contestThemes).where(eq(contestThemes.contestId, contest.id));
      const late = !theme || +theme.entered > +contest.submissionsStartAt;
      await tx.update(contests).set({ stage: late ? "failed" : "submissions", failureReason: late ? "theme-late" : null, publicUpdatedAt: now }).where(eq(contests.id, contest.id));
      // No end-date extension: past reception is immediately closed by the next operation.
    } else {
      const [formed] = await tx.select({ snapshot: firstRoundFormations.snapshot }).from(firstRoundFormations).where(eq(firstRoundFormations.contestId, contest.id));
      const [closed] = await tx.select({ id: firstRoundClosures.contestId }).from(firstRoundClosures).where(eq(firstRoundClosures.contestId, contest.id));
      if (contest.stage !== "moderation" || !formed || "kind" in formed.snapshot || closed || +now < +contest.roundOneStartAt) throw new ManagementError("Начать первый тур сейчас нельзя.", 409);
      await tx.update(contests).set({ stage: "round-one", publicUpdatedAt: now }).where(eq(contests.id, contest.id));
    }
    if (actor) await adminEvent(tx, contest.id, actor.id, action, { actor: actor.scheduled ? "scheduler" : "account" });
    return { message: "Переход зафиксирован. Право подачи и голосования определяется исходными дедлайнами." };
  });
}
