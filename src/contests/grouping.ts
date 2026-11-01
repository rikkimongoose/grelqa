import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "../db/connection";
import { ballots, contestGroups, contests, contestThemes, firstRoundFormations, participations, stories, storyRounds } from "../db/schema";
import { balancedBlockPlan, isFailureSnapshot, selectVotingStory, type FailureCode, type FailureSnapshot, type FormationSnapshot } from "./grouping-rules";

export class GroupingError extends Error {}

export type GroupingDiagnostics = {
  admittedCount: number;
  admittedAuthorCount: number;
  pendingModeration: number;
  failureChecks: FailureCode[];
  theme: "on-time" | "missing" | "late" | "empty-open";
};

export type GroupingResult = { status: "formed"; snapshot: FormationSnapshot } | { status: "failed"; snapshot: FailureSnapshot } | { status: "blocked"; questions: string[]; diagnostics: GroupingDiagnostics };

export async function closeReception(db: Database, slug: string) {
  if (process.env.NODE_ENV !== "development") throw new GroupingError("Закрытие через эту операцию разрешено только в development.");
  return db.transaction(async (tx) => {
    const [contest] = await tx.select().from(contests).where(eq(contests.slug, slug));
    if (!contest || !contest.isDemo) throw new GroupingError("Нужен существующий демонстрационный конкурс.");
    if (+contest.submissionsEndAt > Date.now()) throw new GroupingError("Приём работ ещё не завершён.");
    if (contest.stage === "preparation") throw new GroupingError("Конкурс ещё не активирован.");
    if (contest.stage !== "submissions") return { stage: contest.stage };
    await tx.update(contests).set({ stage: "moderation" }).where(eq(contests.id, contest.id));
    return { stage: "moderation" as const };
  });
}

// Низкоуровневый модуль используется только сервером/CLI и тестами.
// Здесь нет импорта next/headers и нет публичного обработчика запуска.
export async function formFirstRound(db: Database, slug: string): Promise<GroupingResult> {
  if (process.env.NODE_ENV !== "development") throw new GroupingError("Формирование через эту операцию разрешено только в development.");
  // Драйвер libSQL начинает write-транзакцию до выполнения callback:
  // второй процесс ждёт первого и читает уже зафиксированный снимок.
  return db.transaction(async (tx) => {
    const [contest] = await tx.select().from(contests).where(eq(contests.slug, slug));
    if (!contest) throw new GroupingError("Конкурс не найден.");
    if (!contest.isDemo) throw new GroupingError("Локальная операция разрешена только для демонстрационного конкурса.");
    const [existing] = await tx.select({ snapshot: firstRoundFormations.snapshot }).from(firstRoundFormations).where(eq(firstRoundFormations.contestId, contest.id));
    if (existing) return isFailureSnapshot(existing.snapshot) ? { status: "failed", snapshot: existing.snapshot } : { status: "formed", snapshot: existing.snapshot };
    const now = new Date();
    if (+contest.submissionsEndAt > +now) throw new GroupingError("Приём работ ещё не завершён.");
    if (!["submissions", "moderation"].includes(contest.stage)) throw new GroupingError("Первичное распределение запрещено после начала голосования или завершения конкурса.");
    const oldGroups = await tx.select({ id: contestGroups.id }).from(contestGroups).where(eq(contestGroups.contestId, contest.id));
    const oldRounds = await tx.select({ id: storyRounds.storyId }).from(storyRounds).where(eq(storyRounds.contestId, contest.id));
    const oldBallots = await tx.select({ id: ballots.id }).from(ballots).where(eq(ballots.contestId, contest.id));
    const participants = await tx.select().from(participations).where(eq(participations.contestId, contest.id));
    if (oldGroups.length || oldRounds.length || oldBallots.length || participants.some((row) => row.assignedGroupId !== null || row.mustVoteRoundOne)) throw new GroupingError("У конкурса уже есть распределение, назначения или история голосования. Они не будут перезаписаны.");
    const rows = await tx.select().from(stories).where(eq(stories.contestId, contest.id));
    const admitted = rows.filter((row) => row.status === "admitted" && row.withdrawnAt === null);
    const authors = new Set(admitted.map((row) => row.participationId));
    const [themeRow] = await tx.select({ theme: contestThemes.theme, enteredAt: contestThemes.enteredAt }).from(contestThemes).where(eq(contestThemes.contestId, contest.id));
    const theme: GroupingDiagnostics["theme"] = !themeRow ? "missing" : +themeRow.enteredAt > +contest.submissionsStartAt ? "late" : !themeRow.theme.trim() ? "empty-open" : "on-time";
    const failureChecks: GroupingDiagnostics["failureChecks"] = [];
    if (!admitted.length) failureChecks.push("no-stories");
    else if (admitted.length === 1) failureChecks.push("one-story");
    if (admitted.length && authors.size === 1) failureChecks.push("one-author");
    if (theme === "missing" || theme === "late") failureChecks.push("theme-late");
    const diagnostics = { admittedCount: admitted.length, admittedAuthorCount: authors.size, pendingModeration: rows.filter((row) => row.status === "submitted").length, failureChecks, theme };
    const questions: string[] = [];
    if (contest.stage !== "moderation") questions.push("Сначала закройте приём и завершите модерацию. Проверка проводится на этапе moderation.");
    if (diagnostics.pendingModeration) questions.push("Остались submitted: сначала требуется завершить проверку работ; операция не допускает их автоматически.");
    if (questions.length) return { status: "blocked", questions, diagnostics };
    if (failureChecks.length) {
      const snapshot: FailureSnapshot = { kind: "failed", version: "admitted-viability-v1", checkedAt: now.toISOString(), admittedCount: admitted.length, admittedAuthorCount: authors.size, reasons: failureChecks };
      await tx.update(contests).set({ stage: "failed", failureReason: JSON.stringify(failureChecks) }).where(eq(contests.id, contest.id));
      await tx.insert(firstRoundFormations).values({ contestId: contest.id, formedAt: now, snapshot });
      return { status: "failed", snapshot };
    }
    if (theme === "empty-open") questions.push("В ТЗ не определено, считается ли пустое/пробельное значение темой.");
    if (questions.length) return { status: "blocked", questions, diagnostics };
    let plan;
    try { plan = balancedBlockPlan(admitted, contest.groupCapacity, contest.finalCapacity); }
    catch (error) { return { status: "blocked", questions: [(error as Error).message], diagnostics }; }
    const snapshot: FormationSnapshot = {
      version: "size-blocks-v2", formedAt: now.toISOString(), eligibleCount: admitted.length, authorCount: authors.size,
      originalCapacity: contest.groupCapacity, effectiveCapacity: plan.effectiveCapacity,
      groups: plan.groups.map((group) => ({ ...group, id: randomUUID() })), assignments: [],
    };
    const groupByStory = new Map(snapshot.groups.flatMap((group) => group.storyIds.map((id) => [id, group.id] as const)));
    for (const participationId of authors) {
      const selected = selectVotingStory(admitted.filter((row) => row.participationId === participationId));
      if (!selected) throw new GroupingError("Для назначения нужны сопоставимые длины работ.");
      snapshot.assignments.push({ participationId, groupId: groupByStory.get(selected.id)!, selectedStoryId: selected.id });
    }
    snapshot.assignments.sort((a, b) => a.participationId.localeCompare(b.participationId, "en"));
    for (const group of snapshot.groups) {
      await tx.insert(contestGroups).values({ id: group.id, contestId: contest.id, round: 1, number: group.number, capacity: group.capacity, publishedAt: now });
      for (const storyId of group.storyIds) {
        await tx.insert(storyRounds).values({ storyId, contestId: contest.id, round: 1, groupId: group.id });
        await tx.update(stories).set({ publishedAt: now }).where(eq(stories.id, storyId));
      }
    }
    for (const assignment of snapshot.assignments) await tx.update(participations).set({ assignedGroupId: assignment.groupId, assignedRound: 1, mustVoteRoundOne: true })
      .where(and(eq(participations.id, assignment.participationId), eq(participations.contestId, contest.id), isNull(participations.assignedGroupId)));
    await tx.insert(firstRoundFormations).values({ contestId: contest.id, formedAt: now, snapshot });
    // Формирование публикует допущенные работы, но не запускает голосование.
    return { status: "formed", snapshot };
  });
}
