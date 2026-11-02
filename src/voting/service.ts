import { currentTime } from "../server/clock";
import "server-only";
import { contestManager, ManagementError } from "../management/access";
import { randomUUID, createHash } from "node:crypto";
import { and, asc, eq, gt, isNotNull } from "drizzle-orm";
import { writeTransaction } from "../db/write-transaction";
import { getDatabase } from "../db";
import { authSessions, users, contests, participations, ballots, ballotEntries, ballotDrafts, ballotRequests, stories, firstRoundClosures, finalRounds, contestFinalizations } from "../db/schema";
import { AuthError, tokenHash } from "../auth/service";
import { eligibleStories, firstRoundDeadline, firstRoundOpen, finalRoundOpen, refreshRoundOneExemptions, refreshRoundTwoExemptions, type VotingDb } from "./eligibility";

type Tx = Parameters<Parameters<Awaited<ReturnType<typeof getDatabase>>["db"]["transaction"]>[0]>[0];
async function votingTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const { db } = await getDatabase();
  return writeTransaction(db, work);
}

async function verified(db: VotingDb, token?: string) {
  const [user] = await db.select({ id: users.id }).from(authSessions).innerJoin(users, eq(authSessions.userId, users.id))
    .where(and(eq(authSessions.tokenHash, tokenHash("session", token || "")), gt(authSessions.expiresAt, currentTime()), isNotNull(users.emailVerifiedAt)));
  if (!user) throw new AuthError("Требуется вход с подтверждённым email.", 403);
  return user;
}
async function context(tx: Tx, token: string | undefined, slug: string, round: 1 | 2) {
  const user = await verified(tx, token);
  const [contest] = await tx.select().from(contests).where(eq(contests.slug, slug));
  if (!contest) throw new AuthError("Конкурс не найден.", 404);
  if (round === 1) await refreshRoundOneExemptions(tx, contest.id); else await refreshRoundTwoExemptions(tx, contest.id);
  const [member] = await tx.select().from(participations).where(and(eq(participations.contestId, contest.id), eq(participations.userId, user.id)));
  const [closure] = await tx.select({ snapshot: firstRoundClosures.snapshot }).from(firstRoundClosures).where(eq(firstRoundClosures.contestId, contest.id));
  const [final] = round === 2 ? await tx.select({ snapshot: finalRounds.snapshot }).from(finalRounds).where(eq(finalRounds.contestId, contest.id)) : [];
  const [completed] = await tx.select({ snapshot: contestFinalizations.snapshot }).from(contestFinalizations).where(eq(contestFinalizations.contestId, contest.id));
  if (round === 1 && (!member?.assignedGroupId || member.assignedRound !== 1 || (!member.mustVoteRoundOne && !member.roundOneExemptAt))) throw new AuthError("У вас нет назначения для голосования в первом туре.", 403);
  if (round === 2 && (!member || !closure || closure.snapshot.outcome !== "results" || closure.snapshot.settings.singleRound || !final || !final.snapshot.members.some((owner) => owner.participationId === member.id && owner.userId === user.id) || (contest.stage === "failed" && !completed))) throw new AuthError("Финальное голосование доступно только авторам работ из зафиксированного состава финала после подготовки тура.", 403);
  if (!member) throw new AuthError("Нет участия в конкурсе.", 403);
  const groupId = round === 1 ? member.assignedGroupId! : final!.snapshot.groupId;
  const available = await eligibleStories(tx, contest, groupId, user.id, currentTime(), round);
  const rightsEnded = round === 2 && member.roundTwoRightsEndedAt !== null;
  const blockedMessage = rightsEnded ? "Все ваши финальные работы сняты. Право и обязанность финального голоса прекращены; сохранённые версии доступны для просмотра." : null;
  const [draft] = await tx.select().from(ballotDrafts).where(and(eq(ballotDrafts.participationId, member.id), eq(ballotDrafts.round, round)));
  const [sent] = await tx.select().from(ballots).where(and(eq(ballots.participationId, member.id), eq(ballots.round, round)));
  const entries = sent?.submittedAt ? await tx.select({ id: ballotEntries.storyId, position: ballotEntries.position }).from(ballotEntries).where(eq(ballotEntries.ballotId, sent.id)).orderBy(asc(ballotEntries.position)) : [];
  return { user, contest, member, available, draft, sent, entries, groupId, blockedMessage, rightsEnded, preparedAt: final?.snapshot.preparedAt, closed: round === 1 ? Boolean(closure) : Boolean(completed), closedSnapshot: round === 1 ? closure?.snapshot : completed?.snapshot.tally };

}

export async function myBallot(token: string | undefined, slug: string, round: 1 | 2 = 1) {
  return votingTransaction(async (tx) => {
    const state = await context(tx, token, slug, round);
    const { contest, member, available, draft, sent, entries } = state;
    const frozen = state.closedSnapshot;
    const required = frozen ? Math.min(6, frozen.audit.stories.filter((story) => story.groupId === state.groupId && story.userId !== state.user.id && story.status === "admitted" && story.roundStatus === "active" && !story.globalWithdrawn).length) : Math.min(6, available.length);
    const ids = new Set(available.map((story) => story.id));
    const aiValues = new Map(available.map((s) => [s.id, s.aiGenerationBasisPoints]));
    const visible = new Map(available.map((story) => [story.id, story.title]));
    // Only titles already present in this owner's selections; no authors or foreign votes.
    for (const id of new Set([...(draft?.selections ?? []), ...entries.map((entry) => entry.id)])) {
      if (!visible.has(id)) {
        const [row] = await tx.select({ title: stories.title, aiGenerationBasisPoints: stories.aiGenerationBasisPoints }).from(stories).where(eq(stories.id, id));
        visible.set(id, row?.title ?? "Недоступная работа");
        aiValues.set(id, row?.aiGenerationBasisPoints ?? null);
      }
    }
    const selected = draft?.selections ?? entries.map((entry) => entry.id);
    return { slug, round, title: contest.title, groupId: state.groupId, deadline: (round === 1 ? firstRoundDeadline(contest) : contest.endsAt).toISOString(),
      open: !state.closed && !state.blockedMessage && (round !== 2 || +currentTime() >= +new Date(state.preparedAt!)) && (round === 1 ? firstRoundOpen(contest, currentTime()) : finalRoundOpen(contest, currentTime())), blockedMessage: state.blockedMessage, rightsEnded: state.rightsEnded, exempt: (round === 1 ? member.roundOneExemptAt : member.roundTwoExemptAt) !== null,
      required, available, revision: draft?.revision ?? 0,
      hasDraft: draft?.selections !== null && draft?.selections !== undefined,
      selected: selected.map((id, index) => ({ aiGenerationBasisPoints: aiValues.get(id) ?? null, id, title: visible.get(id)!, position: index + 1, unavailable: !ids.has(id) })),
      submittedAt: sent?.submittedAt?.toISOString() ?? null,
      submitted: entries.map(({ id, position }) => ({ aiGenerationBasisPoints: aiValues.get(id) ?? null, id, title: visible.get(id)!, position, unavailable: !ids.has(id) })),
    };
  });
}
export type BallotView = Awaited<ReturnType<typeof myBallot>>;
export type BallotInput = { slug: string; revision: number; requestId: string; selections?: string[]; storyId?: string };

export async function changeBallot(token: string | undefined, action: "draft" | "submit" | "add", input: BallotInput, receivedAt: Date, round: 1 | 2 = 1) {
  return votingTransaction(async (tx) => {
    const state = await context(tx, token, input.slug, round);
    const { contest, member, available, draft, sent, entries } = state;
    const digest = createHash("sha256").update(JSON.stringify({ ...(round === 2 ? { round: 2 } : {}), action, revision: input.revision, selections: input.selections ?? null, storyId: input.storyId ?? null })).digest("hex");
    const [receipt] = await tx.select().from(ballotRequests).where(and(eq(ballotRequests.participationId, member.id), eq(ballotRequests.round, round), eq(ballotRequests.requestId, input.requestId)));
    if (receipt) {
      if (receipt.payloadHash !== digest) throw new AuthError("Идентификатор запроса уже использован для другого варианта.", 409);
      return receipt.response;
    }
    if (state.rightsEnded) throw new AuthError(state.blockedMessage!, 403);
    if (state.closed || (round === 2 && +receivedAt < +new Date(state.preparedAt!)) || !(round === 1 ? firstRoundOpen(contest, receivedAt) : finalRoundOpen(contest, receivedAt))) throw new AuthError(`${round === 1 ? "Первый тур" : "Финал"} ещё не начался или срок голосования истёк. Данные формы сохранены в браузере.`, 409);
    if ((round === 1 ? member.roundOneExemptAt : member.roundTwoExemptAt) || !available.length) throw new AuthError("Нет доступных чужих работ: вы освобождены от голосования.", 409);
    const revision = draft?.revision ?? 0;
    if (input.revision !== revision) throw new AuthError("Бюллетень изменён в другой вкладке. Скопируйте свой выбор и обновите страницу.", 409);
    const activeIds = new Set(available.map((story) => story.id));
    let selections = input.selections ?? [];
    if (action === "add") {
      if (!input.storyId || !activeIds.has(input.storyId)) throw new AuthError("Эту работу нельзя добавить в вашу назначенную группу.", 403);
      selections = [...(draft?.selections ?? entries.map((entry) => entry.id))];
      if (!selections.includes(input.storyId)) {
        if (selections.length >= 6) throw new AuthError("Выбрано шесть работ. Откройте бюллетень и измените выбор.", 409);
        selections.push(input.storyId);
      }
    }
    if (selections.length > 6 || new Set(selections).size !== selections.length) throw new AuthError("Не больше шести разных работ; повторы запрещены.");
    if (selections.some((id) => !activeIds.has(id))) throw new AuthError("Есть свои, снятые или недоступные работы. Исправьте выбор перед сохранением/отправкой.");
    if (action === "submit" && selections.length !== Math.min(6, available.length)) throw new AuthError(`Нужно выбрать ${Math.min(6, available.length)} работ и расставить их с первого места.`);
    const now = currentTime();
    if (action === "submit") {
      const ballotId = sent?.id ?? randomUUID();
      if (sent) {
        await tx.delete(ballotEntries).where(eq(ballotEntries.ballotId, sent.id));
        await tx.update(ballots).set({ updatedAt: now, submittedAt: receivedAt }).where(eq(ballots.id, sent.id));
      } else await tx.insert(ballots).values({ id: ballotId, participationId: member.id, contestId: contest.id, groupId: state.groupId, round, createdAt: now, updatedAt: now, submittedAt: receivedAt });
      for (const [index, storyId] of selections.entries()) await tx.insert(ballotEntries).values({ ballotId, storyId, contestId: contest.id, groupId: state.groupId, round, position: index + 1 });
    }
    await tx.insert(ballotDrafts).values({ participationId: member.id, contestId: contest.id, round, groupId: state.groupId,
      selections: action === "submit" ? null : selections, revision: revision + 1, updatedAt: now,
    }).onConflictDoUpdate({ target: [ballotDrafts.participationId, ballotDrafts.round], set: { selections: action === "submit" ? null : selections, revision: revision + 1, updatedAt: now } });
    const result = { revision: revision + 1, submittedAt: action === "submit" ? receivedAt.toISOString() : sent?.submittedAt?.toISOString() ?? null, message: action === "submit" ? "Бюллетень отправлен и засчитан." : "Черновик сохранён. Он не считается отправленным бюллетенем." };
    await tx.insert(ballotRequests).values({ participationId: member.id, round, requestId: input.requestId, payloadHash: digest, response: result, receivedAt });
    return result;
  });
}

export async function coordinatorVotingStatuses(token: string | undefined, slug: string, round: 1 | 2 = 1) {
  return votingTransaction(async (tx) => {
    await verified(tx, token);
    const [contest] = await tx.select().from(contests).where(eq(contests.slug, slug));
    if (!contest) throw new AuthError("Доступ запрещён.", 403);
    try { await contestManager(tx, token || "", contest); } catch (e) { if (e instanceof ManagementError) throw new AuthError(e.message, e.status); throw e; }
    if (round === 1) await refreshRoundOneExemptions(tx, contest.id); else await refreshRoundTwoExemptions(tx, contest.id);
    const [closed] = await tx.select({ snapshot: firstRoundClosures.snapshot }).from(firstRoundClosures).where(eq(firstRoundClosures.contestId, contest.id));
    if (round === 1 && closed) return closed.snapshot.audit.members.map((member) => ({ participationId: member.id, status: member.votingStatus }));
    const [completed] = await tx.select({ snapshot: contestFinalizations.snapshot }).from(contestFinalizations).where(eq(contestFinalizations.contestId, contest.id));
    if (round === 2 && completed) return completed.snapshot.tally.audit.members.map((m) => ({ participationId: m.id, status: m.votingStatus }));
    const members = await tx.select().from(participations).where(eq(participations.contestId, contest.id));
    const sent = await tx.select({ participationId: ballots.participationId, submittedAt: ballots.submittedAt }).from(ballots).where(and(eq(ballots.contestId, contest.id), eq(ballots.round, round)));
    return members.map((member) => ({ participationId: member.id,
      status: round === 2 && member.roundTwoRightsEndedAt ? "rights-ended" : (round === 1 ? member.roundOneExemptAt : member.roundTwoExemptAt) ? "exempt" : sent.some((row) => row.participationId === member.id && row.submittedAt) ? "submitted" : (round === 1 ? member.mustVoteRoundOne : member.mustVoteRoundTwo) ? "pending" : "not-eligible",
    }));
  });
}
