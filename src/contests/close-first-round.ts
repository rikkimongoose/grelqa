import { currentTime } from "../server/clock";
import type { TransitionAuthority } from "../scheduling/authority";
import { transitionActor, adminEvent } from "../management/access";
import { and, asc, eq } from "drizzle-orm";
import type { TransactionDatabase } from "../db/write-transaction";
import { writeTransaction } from "../db/write-transaction";
import { contests, contestGroups, stories, storyRounds, participations, ballots, ballotEntries, firstRoundClosures } from "../db/schema";
import { firstRoundDeadline } from "../voting/eligibility";
import { closurePolicy, POINTS, scoreStories, rankAndQualify, type ClosureSnapshot, type ClosureStory, type ClosureVote, type ClosureMember } from "./closure-rules";

export class ClosureError extends Error {}
// Server/CLI only: no HTTP handler or client import. Local command cannot touch real contests.
export async function closeFirstRound(db: TransactionDatabase, slug: string, managerToken?: TransitionAuthority) {
  if (managerToken === undefined && process.env.NODE_ENV !== "development") throw new ClosureError("Локальное закрытие разрешено только в development.");
  return writeTransaction(db, async (tx): Promise<ClosureSnapshot> => {
    const [contest] = await tx.select().from(contests).where(eq(contests.slug, slug));
    if (!contest || (managerToken === undefined && !contest.isDemo)) throw new ClosureError("Нужен существующий демонстрационный конкурс.");
    const actor = await transitionActor(tx, managerToken, contest);
    const [existing] = await tx.select({ snapshot: firstRoundClosures.snapshot }).from(firstRoundClosures).where(eq(firstRoundClosures.contestId, contest.id));
    if (existing) return existing.snapshot;
    const now = currentTime(); const deadline = firstRoundDeadline(contest);
    if (+now < +deadline) throw new ClosureError("Дедлайн первого тура ещё не наступил.");
    if (contest.stage !== "round-one") throw new ClosureError("Первичное закрытие возможно только на этапе первого тура.");
    const allGroups = await tx.select().from(contestGroups).where(eq(contestGroups.contestId, contest.id)).orderBy(asc(contestGroups.round), asc(contestGroups.number));
    const groups = allGroups.filter((group) => group.round === 1).map(({ id, number, capacity }) => ({ id, number, capacity }));
    if (!groups.length || allGroups.some((group) => group.round === 2)) throw new ClosureError("Нет групп первого тура либо уже есть история финала. Перезаписи не будет.");
    const members = await tx.select().from(participations).where(eq(participations.contestId, contest.id)).orderBy(asc(participations.id));
    const memberById = new Map(members.map((member) => [member.id, member]));
    const rounds = await tx.select({ story: stories, entry: storyRounds }).from(storyRounds).innerJoin(stories, eq(storyRounds.storyId, stories.id))
      .where(and(eq(storyRounds.contestId, contest.id), eq(storyRounds.round, 1))).orderBy(asc(stories.createdAt), asc(stories.id));
    if (rounds.some(({ entry }) => entry.points !== null || entry.place !== null)) throw new ClosureError("У тура уже есть результаты без снимка закрытия. Они не будут переписаны.");
    const inputStories: ClosureStory[] = rounds.map(({ story, entry }) => ({ id: story.id, title: story.title, groupId: entry.groupId,
      participationId: story.participationId, userId: memberById.get(story.participationId)!.userId, length: story.length, lengthAlgorithm: story.lengthAlgorithm,
      status: story.status, roundStatus: entry.status, globalWithdrawn: story.withdrawnAt !== null,
      withdrawnAt: entry.withdrawnAt?.toISOString() ?? story.withdrawnAt?.toISOString() ?? null, withdrawalReason: entry.withdrawalReason ?? story.withdrawalReason,
    }));
    const storyById = new Map(inputStories.map((story) => [story.id, story]));
    const sent = await tx.select().from(ballots).where(and(eq(ballots.contestId, contest.id), eq(ballots.round, 1))).orderBy(asc(ballots.id));
    const votes: ClosureVote[] = []; const ignoredBallotIds: string[] = [];
    for (const ballot of sent) {
      if (!ballot.submittedAt || +ballot.submittedAt < +contest.roundOneStartAt || +ballot.submittedAt >= +deadline) { ignoredBallotIds.push(ballot.id); continue; }
      const member = memberById.get(ballot.participationId);
      if (!member || member.assignedRound !== 1 || ballot.groupId !== member.assignedGroupId || (!member.mustVoteRoundOne && !member.roundOneExemptAt)) throw new ClosureError("История отправки не соответствует праву/назначению участника. Нужна проверка данных.");
      const entries = await tx.select({ storyId: ballotEntries.storyId, position: ballotEntries.position }).from(ballotEntries).where(eq(ballotEntries.ballotId, ballot.id)).orderBy(asc(ballotEntries.position));
      if (!entries.length || entries.length > 6 || entries.some((entry, index) => entry.position !== index + 1 || !storyById.has(entry.storyId) || storyById.get(entry.storyId)!.groupId !== ballot.groupId || storyById.get(entry.storyId)!.userId === member.userId)) throw new ClosureError("Отправленный бюллетень нарушает структуру, принадлежность группе или запрет своих работ. Выдуманные результаты не сохраняются.");
      // Do not revalidate against today's reduced eligible count: accepted withdrawn positions remain valid.
      votes.push({ id: ballot.id, participationId: member.id, groupId: ballot.groupId, submittedAt: ballot.submittedAt.toISOString(), entries });
    }
    const voted = new Set(votes.map((vote) => vote.participationId));
    const frozenMembers: ClosureMember[] = members.map((member) => ({ id: member.id, userId: member.userId, groupId: member.assignedGroupId,
      mustVote: member.mustVoteRoundOne, exemptAt: member.roundOneExemptAt?.toISOString() ?? null, exemptReason: member.roundOneExemptReason,
      votingStatus: member.roundOneExemptAt ? "exempt" : voted.has(member.id) ? "submitted" : member.mustVoteRoundOne ? "not-voted" : "not-eligible",
    }));
    const nonVoting = new Set(frozenMembers.filter((member) => member.votingStatus === "not-voted").map((member) => member.id));
    const results = scoreStories(inputStories, votes, nonVoting);
    const active = inputStories.filter((story) => !results.find((result) => result.id === story.id)!.withdrawn);
    const failureReason = !active.length ? "no-stories" : new Set(active.map((story) => story.userId)).size === 1 ? "one-author" : null;
    const policy = closurePolicy();
    let quota: number | null = null;
    if (!failureReason) {
      if (groups.length === 1 && policy.singleGroup === "blocked") throw new ClosureError("Завершение единственного тура пока не согласовано.");
      try { quota = rankAndQualify(results, inputStories, groups, contest.finalCapacity, policy); }
      catch (error) { throw new ClosureError((error as Error).message); }
    } else for (const result of results) { result.points = null; result.place = null; result.finalist = false; result.shared = false; }
    const snapshot: ClosureSnapshot = { version: "first-round-closure-v1", closedAt: now.toISOString(), roundStartedAt: contest.roundOneStartAt.toISOString(), deadline: deadline.toISOString(),
      outcome: failureReason ? "failed" : "results", failureReason,
      settings: { points: [...POINTS], policy: failureReason ? null : policy, finalCapacity: contest.finalCapacity, groupCount: groups.length, quota, singleRound: groups.length === 1 },
      groups, results, audit: { stories: inputStories, votes, members: frozenMembers, nonVotingParticipationIds: [...nonVoting].sort(), ignoredBallotIds } };
    // All writes, including removals and the immutable publication event, commit together.
    for (const { story, entry } of rounds) {
      const result = results.find((result) => result.id === story.id)!;
      await tx.update(storyRounds).set({ points: result.points, place: result.place,
        ...(nonVoting.has(story.participationId) && entry.status === "active" ? { status: "withdrawn" as const, withdrawnAt: now, withdrawalReason: "not-voted-first-round" } : {}),
      }).where(and(eq(storyRounds.storyId, story.id), eq(storyRounds.round, 1)));
    }
    if (failureReason) await tx.update(contests).set({ stage: "failed", failureReason }).where(eq(contests.id, contest.id));
    else if (groups.length === 1) await tx.update(contests).set({ stage: "completed", votingEndedAt: now }).where(eq(contests.id, contest.id));
    // Multiple groups: frozen finalist list is recorded, final voting is not started automatically.
    await tx.insert(firstRoundClosures).values({ contestId: contest.id, closedAt: now, snapshot });
    if (actor) await adminEvent(tx, contest.id, actor.id, "closeFirstRound", { actor: actor.scheduled ? "scheduler" : "account" });
    return snapshot;
  });
}
