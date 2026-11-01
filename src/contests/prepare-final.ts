import { contestManager, adminEvent } from "../management/access";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/connection";
import { writeTransaction } from "../db/write-transaction";
import { contests, firstRoundClosures, finalRounds, contestGroups, stories, storyRounds, participations } from "../db/schema";
import { refreshRoundTwoExemptions } from "../voting/eligibility";
import type { FinalRoundSnapshot } from "./final-round-types";

export class FinalPreparationError extends Error {}
// Explicit decision: withdrawal of all final works ends both voting right and duty.
export const withdrawalRightsPolicy = (): FinalRoundSnapshot["withdrawalRights"] => "revoke";
export async function prepareFinal(db: Database, slug: string, managerToken?: string) {
  if (managerToken === undefined && process.env.NODE_ENV !== "development") throw new FinalPreparationError("Подготовка финала этой командой разрешена только в development.");
  return writeTransaction(db, async (tx) => {
    const [contest] = await tx.select().from(contests).where(eq(contests.slug, slug));
    if (!contest || (managerToken === undefined && !contest.isDemo)) throw new FinalPreparationError("Нужен демонстрационный конкурс.");
    const actor = managerToken === undefined ? null : await contestManager(tx, managerToken, contest);
    const [existing] = await tx.select({ snapshot: finalRounds.snapshot }).from(finalRounds).where(eq(finalRounds.contestId, contest.id));
    if (existing) return existing.snapshot;
    const [closure] = await tx.select({ snapshot: firstRoundClosures.snapshot }).from(firstRoundClosures).where(eq(firstRoundClosures.contestId, contest.id));
    if (!closure || closure.snapshot.outcome !== "results" || closure.snapshot.settings.singleRound || !contest.roundTwoStartAt || ["failed", "completed"].includes(contest.stage)) throw new FinalPreparationError("Нет успешно закрытого многогруппового первого тура с отдельным финалом.");
    if (contest.stage !== "round-one" || Date.now() >= +contest.endsAt) throw new FinalPreparationError("Подготовка финала недоступна на текущем этапе или после окончания конкурса.");
    const oldGroups = await tx.select({ id: contestGroups.id }).from(contestGroups).where(and(eq(contestGroups.contestId, contest.id), eq(contestGroups.round, 2)));
    if (oldGroups.length) throw new FinalPreparationError("Уже есть история финала без снимка допуска. Она не будет перезаписана.");
    const selected = closure.snapshot.results.filter((row) => row.finalist && !row.withdrawn);
    const source = new Map(closure.snapshot.audit.stories.map((row) => [row.id, row]));
    const owners = [...new Set(selected.map((row) => source.get(row.id)?.participationId))];
    if (!selected.length || owners.some((id) => !id)) throw new FinalPreparationError("Снимок состава финала неполон.");
    const members = await tx.select({ participationId: participations.id, userId: participations.userId }).from(participations)
      .where(and(eq(participations.contestId, contest.id), inArray(participations.id, owners as string[])));
    if (members.length !== owners.length || members.some((member) => selected.some((row) => source.get(row.id)?.participationId === member.participationId && source.get(row.id)?.userId !== member.userId))) throw new FinalPreparationError("Нарушены сохранённые связи финалистов.");
    const stored = await tx.select({ id: stories.id, participationId: stories.participationId }).from(stories).where(and(eq(stories.contestId, contest.id), inArray(stories.id, selected.map((row) => row.id))));
    if (stored.length !== selected.length || stored.some((row) => row.participationId !== source.get(row.id)?.participationId)) throw new FinalPreparationError("Состав финала не совпадает с сохранённой историей.");
    const now = new Date(), groupId = randomUUID();
    const snapshot: FinalRoundSnapshot = { version: "final-admission-v1", preparedAt: now.toISOString(), sourceClosedAt: closure.snapshot.closedAt,
      sourceHash: createHash("sha256").update(JSON.stringify(closure.snapshot)).digest("hex"), startAt: contest.roundTwoStartAt.toISOString(), endAt: contest.endsAt.toISOString(),
      groupId, storyIds: selected.map((row) => row.id), members: members.sort((a, b) => a.participationId.localeCompare(b.participationId)), withdrawalRights: withdrawalRightsPolicy() };
    await tx.insert(contestGroups).values({ id: groupId, contestId: contest.id, round: 2, number: 1, capacity: selected.length, publishedAt: now });
    for (const row of selected) await tx.insert(storyRounds).values({ storyId: row.id, contestId: contest.id, round: 2, groupId });
    for (const member of members) await tx.update(participations).set({ finalist: true, mustVoteRoundTwo: true }).where(eq(participations.id, member.participationId));
    await tx.insert(finalRounds).values({ contestId: contest.id, groupId, preparedAt: now, snapshot });
    await tx.update(contests).set({ stage: "round-two" }).where(eq(contests.id, contest.id));
    await refreshRoundTwoExemptions(tx, contest.id, now);
    if (actor) await adminEvent(tx, contest.id, actor.id, "prepareFinal");
    return snapshot;
  });
}
