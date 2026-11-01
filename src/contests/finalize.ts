import { contestManager, adminEvent } from "../management/access";
import { createHash } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../db/connection";
import { writeTransaction } from "../db/write-transaction";
import * as s from "../db/schema";
import { closurePolicy, POINTS, scoreStories, rankAndQualify, type ClosureSnapshot, type ClosureStory, type ClosureVote, type ClosureMember } from "./closure-rules";
import type { FinalizationSnapshot } from "./finalization-types";

export class FinalizationError extends Error {}
export async function finalizeContest(db: Database, slug: string, managerToken?: string) {
  if (managerToken === undefined && process.env.NODE_ENV !== "development") throw new FinalizationError("Команда завершения разрешена только в development.");
  return writeTransaction(db, async (tx): Promise<FinalizationSnapshot> => {
    const [contest] = await tx.select().from(s.contests).where(eq(s.contests.slug, slug));
    if (!contest || (managerToken === undefined && !contest.isDemo)) throw new FinalizationError("Нужен существующий демонстрационный конкурс.");
    const actor = managerToken === undefined ? null : await contestManager(tx, managerToken, contest);
    const [saved] = await tx.select().from(s.contestFinalizations).where(eq(s.contestFinalizations.contestId, contest.id));
    if (saved) return saved.snapshot;
    const [first] = await tx.select().from(s.firstRoundClosures).where(eq(s.firstRoundClosures.contestId, contest.id));
    if (!first) throw new FinalizationError("Сначала требуется закрыть первый тур.");
    const now = new Date();
    let tally: ClosureSnapshot; let round: 1 | 2;
    if (first.snapshot.settings.singleRound || first.snapshot.outcome === "failed") {
      if (+now < +new Date(first.snapshot.deadline) || !["completed", "failed"].includes(contest.stage)) throw new FinalizationError("Единственный тур ещё не закрыт.");
      // The single-round outcome is already frozen. No recount and no second sanctions.
      tally = first.snapshot; round = 1;
    } else {
      round = 2;
      if (contest.stage !== "round-two" || !contest.roundTwoStartAt || +now < +contest.endsAt) throw new FinalizationError("Финал не открыт либо его дедлайн ещё не наступил.");
      const [final] = await tx.select().from(s.finalRounds).where(eq(s.finalRounds.contestId, contest.id));
      if (!final || final.snapshot.sourceHash !== createHash("sha256").update(JSON.stringify(first.snapshot)).digest("hex")) throw new FinalizationError("Нет согласованного снимка допуска финала.");
      const members = await tx.select().from(s.participations).where(and(eq(s.participations.contestId, contest.id), inArray(s.participations.id, final.snapshot.members.map((m) => m.participationId))));
      const byId = new Map(members.map((m) => [m.id, m]));
      if (members.length !== final.snapshot.members.length || final.snapshot.members.some((m) => byId.get(m.participationId)?.userId !== m.userId)) throw new FinalizationError("Нарушена история участников финала.");
      const rounds = await tx.select({ story: s.stories, entry: s.storyRounds }).from(s.storyRounds).innerJoin(s.stories, eq(s.storyRounds.storyId, s.stories.id))
        .where(and(eq(s.storyRounds.contestId, contest.id), eq(s.storyRounds.round, 2))).orderBy(asc(s.stories.id));
      if (rounds.length !== final.snapshot.storyIds.length || rounds.some(({ story, entry }) => !final.snapshot.storyIds.includes(story.id) || entry.groupId !== final.groupId || entry.points !== null || entry.place !== null || !byId.has(story.participationId))) throw new FinalizationError("Финальные работы или результаты не соответствуют снимку. Перезаписи не будет.");
      const input: ClosureStory[] = rounds.map(({ story, entry }) => ({ id: story.id, title: story.title, groupId: entry.groupId, participationId: story.participationId,
        userId: byId.get(story.participationId)!.userId, length: story.length, lengthAlgorithm: story.lengthAlgorithm, status: story.status, roundStatus: entry.status,
        globalWithdrawn: story.withdrawnAt !== null, withdrawnAt: entry.withdrawnAt?.toISOString() ?? story.withdrawnAt?.toISOString() ?? null, withdrawalReason: entry.withdrawalReason ?? story.withdrawalReason }));
      const storyById = new Map(input.map((story) => [story.id, story]));
      const sent = await tx.select().from(s.ballots).where(and(eq(s.ballots.contestId, contest.id), eq(s.ballots.round, 2))).orderBy(asc(s.ballots.id));
      const votes: ClosureVote[] = []; const ignoredBallotIds: string[] = [];
      for (const ballot of sent) {
        if (!ballot.submittedAt || +ballot.submittedAt < +contest.roundTwoStartAt || +ballot.submittedAt >= +contest.endsAt) { ignoredBallotIds.push(ballot.id); continue; }
        const member = byId.get(ballot.participationId);
        if (!member || ballot.groupId !== final.groupId) throw new FinalizationError("Неверный допуск финального бюллетеня.");
        const entries = await tx.select({ storyId: s.ballotEntries.storyId, position: s.ballotEntries.position }).from(s.ballotEntries).where(eq(s.ballotEntries.ballotId, ballot.id)).orderBy(asc(s.ballotEntries.position));
        if (!entries.length || entries.length > 6 || entries.some((e, i) => e.position !== i + 1 || !storyById.has(e.storyId) || storyById.get(e.storyId)!.userId === member.userId)) throw new FinalizationError("Нарушена структура отправленного финального бюллетеня.");
        // An accepted version remains valid after withdrawal: do not recheck today's eligible count.
        votes.push({ id: ballot.id, participationId: member.id, groupId: ballot.groupId, submittedAt: ballot.submittedAt.toISOString(), entries });
      }
      const voted = new Set(votes.map((v) => v.participationId));
      // Freeze obligations BEFORE sanction withdrawals. No refresh against the reduced field.
      const frozen: ClosureMember[] = members.map((m) => ({ id: m.id, userId: m.userId, groupId: final.groupId, mustVote: m.mustVoteRoundTwo,
        exemptAt: m.roundTwoExemptAt?.toISOString() ?? null, exemptReason: m.roundTwoExemptReason,
        votingStatus: m.roundTwoRightsEndedAt ? "not-eligible" : m.roundTwoExemptAt ? "exempt" : voted.has(m.id) ? "submitted" : m.mustVoteRoundTwo ? "not-voted" : "not-eligible" }));
      const nonVoting = new Set(frozen.filter((m) => m.votingStatus === "not-voted").map((m) => m.id));
      const results = scoreStories(input, votes, nonVoting);
      const active = input.filter((story) => !results.find((r) => r.id === story.id)!.withdrawn);
      const failureReason = !active.length ? "no-stories" : new Set(active.map((story) => story.userId)).size === 1 ? "one-author" : null;
      const [group] = await tx.select().from(s.contestGroups).where(eq(s.contestGroups.id, final.groupId));
      if (!group) throw new FinalizationError("Нет финальной группы.");
      const groups = [{ id: group.id, number: group.number, capacity: group.capacity }];
      const policy = closurePolicy();
      if (!failureReason) rankAndQualify(results, input, groups, contest.finalCapacity, policy);
      else for (const result of results) { result.points = null; result.place = null; result.shared = false; }
      tally = { version: "first-round-closure-v1", closedAt: now.toISOString(), roundStartedAt: contest.roundTwoStartAt.toISOString(), deadline: contest.endsAt.toISOString(), outcome: failureReason ? "failed" : "results", failureReason,
        settings: { points: [...POINTS], policy, finalCapacity: contest.finalCapacity, groupCount: 1, quota: null, singleRound: false }, groups, results,
        audit: { stories: input, votes, members: frozen, nonVotingParticipationIds: [...nonVoting].sort(), ignoredBallotIds } };
      for (const { story, entry } of rounds) {
        const r = results.find((r) => r.id === story.id)!;
        await tx.update(s.storyRounds).set({ points: r.points, place: r.place,
          ...(nonVoting.has(story.participationId) && entry.status === "active" ? { status: "withdrawn" as const, withdrawnAt: now, withdrawalReason: "not-voted-final-round" } : {}),
        }).where(and(eq(s.storyRounds.storyId, story.id), eq(s.storyRounds.round, 2)));
      }
    }
    const authors: FinalizationSnapshot["authors"] = [];
    if (tally.outcome === "results") {
      const all = await tx.select({ id: s.stories.id, name: s.users.publicName, status: s.stories.status, withdrawn: s.stories.withdrawnAt }).from(s.stories)
        .innerJoin(s.participations, eq(s.stories.participationId, s.participations.id)).innerJoin(s.users, eq(s.participations.userId, s.users.id)).where(eq(s.stories.contestId, contest.id));
      const withdrawn = await tx.select({ id: s.storyRounds.storyId }).from(s.storyRounds).where(and(eq(s.storyRounds.contestId, contest.id), eq(s.storyRounds.status, "withdrawn")));
      const excluded = new Set(withdrawn.map((r) => r.id));
      // Includes nonfinalists; never includes withdrawn/unadmitted works or account identifiers.
      for (const row of all) if (row.status === "admitted" && !row.withdrawn && !excluded.has(row.id) && first.snapshot.audit.stories.some((story) => story.id === row.id)) authors.push({ storyId: row.id, name: row.name?.trim() || "Публичное имя не указано" });
    }
    const snapshot: FinalizationSnapshot = { version: "contest-finalization-v1", completedAt: now.toISOString(), round, sourceClosedAt: first.snapshot.closedAt,
      sourceHash: createHash("sha256").update(JSON.stringify(first.snapshot)).digest("hex"), tally, authors,
      winners: tally.outcome === "results" ? tally.results.filter((r) => !r.withdrawn && r.place === 1).map((r) => r.id) : [] };
    await tx.update(s.contests).set({ stage: tally.outcome === "failed" ? "failed" : "completed", failureReason: tally.failureReason, votingEndedAt: now }).where(eq(s.contests.id, contest.id));
    await tx.insert(s.contestFinalizations).values({ contestId: contest.id, completedAt: now, snapshot });
    if (actor) await adminEvent(tx, contest.id, actor.id, "finalizeContest");
    return snapshot;
  });
}
