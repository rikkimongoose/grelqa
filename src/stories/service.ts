import { withdrawRound } from "./withdrawal";
import "server-only";
import { firstRoundDeadline } from "../voting/eligibility";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, isNotNull, notExists, sql } from "drizzle-orm";
import { getDatabase } from "../db";
import type { Database } from "../db/connection";
import { authSessions, users, contests, participations, stories, storyRounds, contestGroups, firstRoundFormations, firstRoundClosures, contestFinalizations } from "../db/schema";
import { AuthError, tokenHash } from "../auth/service";
import { countStoryText, LENGTH_ALGORITHM, lengthError, submissionContent, withinReception } from "../lib/submission";

type Contest = typeof contests.$inferSelect;
type Story = typeof stories.$inferSelect;

export function canWithdraw(story: Story, contest: Contest, rounds: (typeof storyRounds.$inferSelect)[], now = new Date()) {
  if (withinReception(contest, now)) return story.status === "submitted" && rounds.length === 0;
  const round = contest.stage === "round-one" ? 1 : contest.stage === "round-two" ? 2 : 0;
  const start = round === 1 ? contest.roundOneStartAt : contest.roundTwoStartAt;
  return Boolean(round && start && +start <= +now && +now < +(round === 1 ? firstRoundDeadline(contest) : contest.endsAt) && story.status === "admitted" && rounds.some((entry) => entry.round === round && entry.status === "active"));
}

// A saved formation closes submissions even if the stage/dates were changed accidentally.
function beforeGrouping(db: Pick<Database, "select">) {
  return and(
    notExists(db.select({ one: sql`1` }).from(contestGroups).where(eq(contestGroups.contestId, contests.id))),
    eq(contests.isDraft, false), notExists(db.select({ one: sql`1` }).from(firstRoundFormations).where(eq(firstRoundFormations.contestId, contests.id))),
  );
}
async function groupingStarted(db: Pick<Database, "select">, contestId: string) {
  const [row] = await db.select({ id: contests.id }).from(contests).where(and(eq(contests.id, contestId), beforeGrouping(db)));
  return !row;
}

export async function receptionContests() {
  const { db } = await getDatabase();
  const now = new Date();
  return db.select({ slug: contests.slug, title: contests.title }).from(contests).where(and(eq(contests.stage, "submissions"), sql`${contests.submissionsStartAt} <= ${+now}`, gt(contests.submissionsEndAt, now), beforeGrouping(db))).orderBy(asc(contests.submissionsStartAt));
}

export async function submissionContest(slug: string) {
  const { db } = await getDatabase();
  const [contest] = await db.select().from(contests).where(eq(contests.slug, slug));
  if (!contest) return undefined;
  // В интерфейс передаём только параметры формы, не organizerId.
  return { slug: contest.slug, title: contest.title, minLength: contest.minLength, maxLength: contest.maxLength,
    open: withinReception(contest) && !await groupingStarted(db, contest.id), deadline: contest.submissionsEndAt.toISOString() };
}

export async function ownStories(userId: string, contestSlug?: string) {
  const { db } = await getDatabase();
  const rows = await db.select({ id: stories.id, title: stories.title, status: stories.status, content: stories.content, length: stories.length,
    contestTitle: contests.title, contestSlug: contests.slug }).from(stories)
    .innerJoin(participations, eq(stories.participationId, participations.id))
    .innerJoin(contests, eq(stories.contestId, contests.id)).where(and(eq(participations.userId, userId), contestSlug === undefined ? undefined : eq(contests.slug, contestSlug)))
    .orderBy(desc(stories.createdAt), asc(stories.id));
  const withdrawn = await db.select({ id: storyRounds.storyId, round: storyRounds.round }).from(storyRounds)
    .innerJoin(stories, eq(storyRounds.storyId, stories.id)).innerJoin(participations, eq(stories.participationId, participations.id))
    .where(and(eq(participations.userId, userId), eq(storyRounds.status, "withdrawn")));
  return rows.map((row) => ({ ...row, withdrawnRounds: withdrawn.filter((entry) => entry.id === row.id).map((entry) => entry.round) }));
}

export async function ownStory(userId: string, id: string) {
  const { db } = await getDatabase();
  const [row] = await db.select({ story: stories, contest: contests }).from(stories)
    .innerJoin(participations, eq(stories.participationId, participations.id))
    .innerJoin(contests, eq(stories.contestId, contests.id)).where(and(eq(stories.id, id), eq(participations.userId, userId)));
  if (!row) return undefined;
  const rounds = await db.select().from(storyRounds).where(eq(storyRounds.storyId, id));
  const [closed] = await db.select({ id: firstRoundClosures.contestId }).from(firstRoundClosures).where(eq(firstRoundClosures.contestId, row.contest.id));
  const [completed] = await db.select({ id: contestFinalizations.contestId }).from(contestFinalizations).where(eq(contestFinalizations.contestId, row.contest.id));
  return { story: row.story, contest: { slug: row.contest.slug, title: row.contest.title, minLength: row.contest.minLength, maxLength: row.contest.maxLength },
    editable: withinReception(row.contest) && row.story.status === "submitted" && row.story.publishedAt === null && rounds.length === 0 && !await groupingStarted(db, row.contest.id),
    withdrawable: !completed && !(closed && row.contest.stage === "round-one") && canWithdraw(row.story, row.contest, rounds),
    withdrawnRounds: rounds.filter((entry) => entry.status === "withdrawn").map((entry) => entry.round) };
}

export type SaveInput = { title: string; content: unknown; id?: string; revision?: number };

// Внутри write-транзакции повторно проверяем сессию, владельца, этап и дедлайн.
export async function saveStory(sessionToken: string | undefined, slug: string, input: SaveInput) {
  const { db } = await getDatabase();
  let content;
  try { content = submissionContent(input.content); } catch (error) { throw new AuthError((error as Error).message); }
  const title = input.title.trim();
  if (!title || Array.from(title).length > 200) throw new AuthError("Название: от 1 до 200 знаков.");
  const length = countStoryText(content);
  return db.transaction(async (tx) => {
    const now = new Date();
    const [user] = await tx.select({ id: users.id }).from(authSessions).innerJoin(users, eq(authSessions.userId, users.id))
      .where(and(eq(authSessions.tokenHash, tokenHash("session", sessionToken || "")), gt(authSessions.expiresAt, now), isNotNull(users.emailVerifiedAt)));
    if (!user) throw new AuthError("Требуется вход с подтверждённым email.", 403);
    const [contest] = await tx.select().from(contests).where(eq(contests.slug, slug));
    if (!contest) throw new AuthError("Конкурс не найден.", 404);
    if (!withinReception(contest, now)) throw new AuthError("Приём работ закрыт. Сохранение недоступно.", 409);
    if (await groupingStarted(tx, contest.id)) throw new AuthError("Группы уже сформированы. Подача и редактирование закрыты.", 409);
    const invalidLength = lengthError(length, contest.minLength, contest.maxLength);
    if (invalidLength) throw new AuthError(invalidLength);
    if (input.id) {
      const [existing] = await tx.select({ story: stories }).from(stories).innerJoin(participations, eq(stories.participationId, participations.id))
        .where(and(eq(stories.id, input.id), eq(stories.contestId, contest.id), eq(participations.userId, user.id)));
      if (!existing) throw new AuthError("Работа не найдена.", 404);
      const assigned = await tx.select({ id: storyRounds.storyId }).from(storyRounds).where(eq(storyRounds.storyId, input.id));
      if (existing.story.status !== "submitted" || existing.story.publishedAt || assigned.length) throw new AuthError("Этот статус не допускает редактирование.", 409);
      if (existing.story.revision !== input.revision) throw new AuthError("Работа уже изменена в другом окне. Скопируйте свой текст и обновите страницу.", 409);
      await tx.update(stories).set({ title, content, length, lengthAlgorithm: LENGTH_ALGORITHM, updatedAt: now, revision: existing.story.revision + 1 })
        .where(and(eq(stories.id, input.id), eq(stories.revision, input.revision!)));
      return { id: input.id, revision: existing.story.revision + 1, length };
    }
    // Работ у автора может быть сколько угодно. UNIQUE гарантирует одно участие
    // даже при двух одновременных подачах; обе работы сохраняются атомарно.
    await tx.insert(participations).values({ id: randomUUID(), userId: user.id, contestId: contest.id, createdAt: now })
      .onConflictDoNothing({ target: [participations.userId, participations.contestId] });
    const [participation] = await tx.select({ id: participations.id }).from(participations).where(and(eq(participations.userId, user.id), eq(participations.contestId, contest.id)));
    const id = randomUUID();
    await tx.insert(stories).values({ id, contestId: contest.id, participationId: participation.id, title, content, length, lengthAlgorithm: LENGTH_ALGORITHM,
      status: "submitted", createdAt: now, updatedAt: now, publishedAt: null });
    return { id, revision: 1, length };
  });
}

export async function withdrawStory(sessionToken: string | undefined, id: string, revision: number) {
  const { db } = await getDatabase();
  await db.transaction(async (tx) => {
    const now = new Date();
    const [user] = await tx.select({ id: users.id }).from(authSessions).innerJoin(users, eq(authSessions.userId, users.id))
      .where(and(eq(authSessions.tokenHash, tokenHash("session", sessionToken || "")), gt(authSessions.expiresAt, now), isNotNull(users.emailVerifiedAt)));
    if (!user) throw new AuthError("Требуется вход с подтверждённым email.", 403);
    const [row] = await tx.select({ story: stories, contest: contests }).from(stories)
      .innerJoin(participations, eq(stories.participationId, participations.id)).innerJoin(contests, eq(stories.contestId, contests.id))
      .where(and(eq(stories.id, id), eq(participations.userId, user.id)));
    if (!row) throw new AuthError("Работа не найдена.", 404);
    const rounds = await tx.select().from(storyRounds).where(eq(storyRounds.storyId, id));
    const [closed] = await tx.select({ id: firstRoundClosures.contestId }).from(firstRoundClosures).where(eq(firstRoundClosures.contestId, row.contest.id));
    const [completed] = await tx.select({ id: contestFinalizations.contestId }).from(contestFinalizations).where(eq(contestFinalizations.contestId, row.contest.id));
    if (completed) throw new AuthError("Конкурс уже завершён. Его историю нельзя изменить.", 409);
    if (closed && row.contest.stage === "round-one") throw new AuthError("Первый тур уже закрыт. Его историю нельзя изменить.", 409);
    if (!canWithdraw(row.story, row.contest, rounds, now)) throw new AuthError("На этом этапе или в этом статусе снятие недоступно.", 409);
    if (row.story.revision !== revision) throw new AuthError("Работа уже изменена. Обновите страницу.", 409);
    const reception = withinReception(row.contest, now);
    if (!reception) {
      const round = row.contest.stage === "round-one" ? 1 : 2;
      await withdrawRound(tx, row.contest.id, id, round, now, "Снята автором");
    }
    await tx.update(stories).set({ ...(reception ? { status: "withdrawn" as const, withdrawnAt: now, withdrawalReason: "Снята автором во время приёма" } : {}), updatedAt: now, revision: revision + 1 }).where(eq(stories.id, id));
  });
}
