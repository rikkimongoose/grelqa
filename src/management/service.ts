import { currentTime } from "../server/clock";
import { actions } from "../scheduling/plan";
import { executeTransition } from "../scheduling/execute";
import { processContestSchedule } from "../scheduling/process";
import { scheduleStatus } from "../scheduling/status";
import "server-only";
import { eventView } from "./event-view";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { getDatabase } from "../db";
import { writeTransaction, type WriteTx } from "../db/write-transaction";
import * as s from "../db/schema";
import { contestSettings } from "./settings";
import { adminEvent, contestManager, verifiedManager, ManagementError } from "./access";
import { authConfig } from "../auth/config";
import { coordinatorVotingStatuses } from "../voting/service";
import { canWithdraw } from "../stories/service";
import { withdrawRound } from "../stories/withdrawal";

const inviteHash = (token: string) => createHash("sha256").update(`contest-theme:${token}`).digest("hex");
async function findContest(tx: Pick<WriteTx, "select">, slug: string) {
  const [contest] = await tx.select().from(s.contests).where(eq(s.contests.slug, slug));
  if (!contest) throw new ManagementError("Конкурс не найден.", 404);
  return contest;
}
export async function managedContests(token: string) {
  const { db } = await getDatabase(); const user = await verifiedManager(db, token);
  const rows = await db.select({ slug: s.contests.slug, title: s.contests.title, stage: s.contests.stage, draft: s.contests.isDraft }).from(s.contests)
    .where(or(eq(s.contests.organizerId, user.id), eq(s.contests.coordinatorId, user.id))).orderBy(desc(s.contests.createdAt));
  return { canCreate: true, rows }; // Registered verified users may create: original §2.1 rule.
}
export async function saveContest(token: string, input: unknown, slug?: string, revision?: number) {
  const value = contestSettings.parse(input); const { db } = await getDatabase();
  return writeTransaction(db, async (tx) => {
    const user = await verifiedManager(tx, token);
    const existing = slug ? await findContest(tx, slug) : undefined;
    if (existing) {
      await contestManager(tx, token, existing, true);
      if (!existing.isDraft || existing.stage !== "preparation") throw new ManagementError("После публикации настройки и расписание заблокированы.", 409);
      if (existing.settingsRevision !== revision) throw new ManagementError("Настройки изменились в другой вкладке. Обновите страницу.", 409);
      if ((await tx.select({ id: s.stories.id }).from(s.stories).where(eq(s.stories.contestId, existing.id))).length) throw new ManagementError("У конкурса уже есть работы.", 409);
    }
    if (existing) {
      const [theme] = await tx.select({ id: s.contestThemes.contestId }).from(s.contestThemes).where(eq(s.contestThemes.contestId, existing.id));
      if (theme && +value.submissionsStartAt !== +existing.submissionsStartAt) throw new ManagementError("После ввода темы начало приёма не меняется.", 409);
    }
    if (+value.submissionsStartAt <= +currentTime()) throw new ManagementError("Начало приёма должно быть в будущем.");
    const [owner] = await tx.select({ id: s.users.id }).from(s.users).where(and(sql`lower(trim(${s.users.email})) = ${value.ownerEmail}`, sql`${s.users.emailVerifiedAt} is not null`));
    const [coordinator] = value.coordinatorEmail ? await tx.select({ id: s.users.id }).from(s.users).where(and(sql`lower(trim(${s.users.email})) = ${value.coordinatorEmail}`, sql`${s.users.emailVerifiedAt} is not null`)) : [];
    if (!owner || (value.coordinatorEmail && !coordinator)) throw new ManagementError("Владелец и координатор должны иметь подтверждённые аккаунты.");
    if (!existing && owner.id !== user.id) throw new ManagementError("Новый конкурс сначала принадлежит создателю. Сменить владельца можно в его черновике.", 403);
    const day = value.submissionsStartAt.toISOString().slice(0, 10);
    const [busyDay] = await tx.select({ id: s.contests.id }).from(s.contests).where(eq(s.contests.startDayMoscow, day));
    if (busyDay && busyDay.id !== existing?.id) throw new ManagementError("В этот московский день уже начинается конкурс.", 409);
    const fields = { title: value.title, description: value.description, discussionUrl: value.discussionUrl || null, criticatDiscussionUrl: value.criticatDiscussionUrl === undefined ? existing?.criticatDiscussionUrl ?? null : value.criticatDiscussionUrl,
      organizerId: owner.id, coordinatorId: coordinator?.id ?? null, submissionsStartAt: value.submissionsStartAt, startDayMoscow: day,
      submissionsEndAt: value.submissionsEndAt, roundOneStartAt: value.roundOneStartAt, roundTwoStartAt: value.roundTwoStartAt || null, endsAt: value.endsAt,
      groupCapacity: value.groupCapacity, finalCapacity: value.finalCapacity, minLength: value.minLength, maxLength: value.maxLength };
    const contestId = existing?.id ?? randomUUID(), contestSlug = existing?.slug ?? `contest-${randomUUID()}`;
    if (existing) await tx.update(s.contests).set({ ...fields, settingsRevision: existing.settingsRevision + 1 }).where(eq(s.contests.id, contestId));
    else await tx.insert(s.contests).values({ id: contestId, slug: contestSlug, ...fields, stage: "preparation", isDraft: true, createdAt: currentTime() });
    const auditSettings = (row: typeof fields | typeof s.contests.$inferSelect) => ({ title: row.title, description: row.description, discussionUrl: row.discussionUrl, criticatDiscussionUrl: row.criticatDiscussionUrl, submissionsStartAt: row.submissionsStartAt.toISOString(), submissionsEndAt: row.submissionsEndAt.toISOString(), roundOneStartAt: row.roundOneStartAt.toISOString(), roundTwoStartAt: row.roundTwoStartAt?.toISOString() ?? null, endsAt: row.endsAt.toISOString(), groupCapacity: row.groupCapacity, finalCapacity: row.finalCapacity, minLength: row.minLength, maxLength: row.maxLength });
    await adminEvent(tx, contestId, user.id, existing ? "settings" : "create", { before: existing ? auditSettings(existing) : null, after: auditSettings(fields), roles: { before: existing ? { ownerId: existing.organizerId, coordinatorId: existing.coordinatorId } : null, after: { ownerId: owner.id, coordinatorId: coordinator?.id ?? null } }, rolesChanged: existing ? existing.organizerId !== owner.id || existing.coordinatorId !== (coordinator?.id ?? null) : true, fields: Object.keys(fields), previousRevision: existing?.settingsRevision ?? null, nextRevision: (existing?.settingsRevision ?? 0) + 1 });
    return { slug: contestSlug };
  });
}
export async function assignCoordinator(token: string, slug: string, email: string, revision: number) {
  const { db } = await getDatabase();
  return writeTransaction(db, async (tx) => {
    const contest = await findContest(tx, slug); const actor = await contestManager(tx, token, contest, true);
    if (["completed", "failed"].includes(contest.stage)) throw new ManagementError("Завершённый конкурс не меняется.", 409);
    if (revision !== contest.settingsRevision) throw new ManagementError("Права или настройки уже изменены. Обновите страницу.", 409);
    const normalized = email.trim().toLowerCase();
    const [next] = normalized ? await tx.select({ id: s.users.id }).from(s.users).where(and(sql`lower(trim(${s.users.email})) = ${normalized}`, sql`${s.users.emailVerifiedAt} is not null`)) : [];
    if (normalized && !next) throw new ManagementError("Нужен существующий подтверждённый аккаунт.");
    await tx.update(s.contests).set({ coordinatorId: next?.id ?? null, settingsRevision: contest.settingsRevision + 1 }).where(eq(s.contests.id, contest.id));
    await adminEvent(tx, contest.id, actor.id, "coordinator", { rolesChanged: true, beforeCoordinatorId: contest.coordinatorId, afterCoordinatorId: next?.id ?? null });
    return { message: "Координатор назначен. Прежний доступ отозван; настройки конкурса не изменены." };
  });
}
export async function issueThemeInvite(token: string, slug: string) {
  const { db } = await getDatabase();
  return writeTransaction(db, async (tx) => {
    const contest = await findContest(tx, slug); const actor = await contestManager(tx, token, contest, true);
    if (+currentTime() > +contest.submissionsStartAt || contest.stage !== "preparation") throw new ManagementError("Срок ввода темы истёк.", 409);
    const [theme] = await tx.select({ id: s.contestThemes.contestId }).from(s.contestThemes).where(eq(s.contestThemes.contestId, contest.id));
    if (theme) throw new ManagementError("Тема уже введена. Повторный ввод недоступен.", 409);
    const secret = randomBytes(32).toString("base64url"); const expiresAt = new Date(Math.min(+currentTime() + 7 * 86400_000, +contest.submissionsStartAt));
    await tx.insert(s.contestThemeInvites).values({ contestId: contest.id, tokenHash: inviteHash(secret), expiresAt }).onConflictDoUpdate({ target: s.contestThemeInvites.contestId, set: { tokenHash: inviteHash(secret), expiresAt, usedAt: null } });
    await adminEvent(tx, contest.id, actor.id, "issue-theme-link", { expiresAt: expiresAt.toISOString() });
    return { link: `${authConfig().origin}/enter-theme#token=${secret}`, expiresAt: expiresAt.toISOString() };
  });
}
export async function enterTheme(token: string, theme: string, conditions: string[]) {
  const { db } = await getDatabase();
  return writeTransaction(db, async (tx) => {
    const [row] = await tx.select({ invite: s.contestThemeInvites, contest: s.contests }).from(s.contestThemeInvites).innerJoin(s.contests, eq(s.contestThemeInvites.contestId, s.contests.id)).where(eq(s.contestThemeInvites.tokenHash, inviteHash(token)));
    if (!row) throw new ManagementError("Ссылка неверна или отозвана.", 400);
    if (row.invite.usedAt) throw new ManagementError("Ссылка уже использована.", 409);
    const now = currentTime();
    if (+now > +row.invite.expiresAt || +now > +row.contest.submissionsStartAt || row.contest.stage !== "preparation") throw new ManagementError("Срок ссылки или ввода темы истёк.", 410);
    if (!theme.trim()) throw new ManagementError("Пустая тема пока не согласована. Введите непустую тему.");
    const [taken] = await tx.select({ id: s.contestThemes.contestId }).from(s.contestThemes).where(eq(s.contestThemes.contestId, row.contest.id));
    if (taken) throw new ManagementError("Тема уже введена.", 409);
    const changed = await tx.update(s.contestThemeInvites).set({ usedAt: now }).where(and(eq(s.contestThemeInvites.contestId, row.contest.id), isNull(s.contestThemeInvites.usedAt))).returning({ id: s.contestThemeInvites.contestId });
    if (!changed.length) throw new ManagementError("Ссылка уже использована.", 409);
    await tx.insert(s.contestThemes).values({ contestId: row.contest.id, theme: theme.trim(), conditions, enteredAt: now, publishedAt: row.contest.submissionsStartAt });
    // The recipient is not authenticated: journal the event without falsely attributing entry to the owner.
    await adminEvent(tx, row.contest.id, null, "theme-entered-by-link", { actor: "token-recipient" });
    return { message: "Тема принята. Повторный ввод закрыт. Она будет опубликована при старте конкурса." };
  });
}
export async function contestAction(token: string, slug: string, action: string) {
  const { db } = await getDatabase();
  if (action === "retry-schedule") {
    const contest = await findContest(db, slug); await contestManager(db, token, contest);
    if (contest.isDraft) throw new ManagementError("Подготовка ещё не опубликована.", 409);
    const result = await processContestSchedule(db, slug, token);
    const error = result.reports.find((r) => r.status === "blocked" || r.status === "error");
    if (error) throw new ManagementError(error.message, error.status === "blocked" ? 409 : 500);
    return { message: result.limited ? "Достигнут предел переходов; безопасно повторите запуск." : result.reports.length ? "Все наступившие переходы выполнены." : "Наступивших невыполненных переходов нет." };
  }
  if (actions.includes(action as typeof actions[number])) {
    const result = await executeTransition(db, slug, token, action as typeof actions[number]);
    if (result.status === "blocked" || result.status === "error") throw new ManagementError(result.message, result.status === "blocked" ? 409 : 500);
    const messages: Record<string, string> = { "close-reception": "Приём закрыт.", "close-first": "Результат первого тура сохранён.", "prepare-final": "Финал подготовлен.", finalize: "Окончательный результат сохранён." };
    return { message: result.status === "noop" || action === "form" ? result.message : messages[action] ?? "Действие выполнено. Обновите страницу управления." };
  }
  return writeTransaction(db, async (tx) => {
    const contest = await findContest(tx, slug); const actor = await contestManager(tx, token, contest, action === "publish");
    const now = currentTime();
    if (action === "publish") {
      if (!contest.isDraft) return { message: "Конкурс уже опубликован." };
      if (contest.stage !== "preparation" || +now >= +contest.submissionsStartAt) throw new ManagementError("Опубликуйте подготовку до начала приёма.", 409);
      await tx.update(s.contests).set({ isDraft: false, publicUpdatedAt: now }).where(eq(s.contests.id, contest.id));
    } else throw new ManagementError("Действие не найдено.", 404);
    await adminEvent(tx, contest.id, actor.id, action);
    return { message: "Действие выполнено. Обновите страницу управления." };
  });
}
export async function moderateStory(token: string, slug: string, storyId: string, action: "admit" | "reject" | "withdraw", reason: string) {
  const { db } = await getDatabase();
  return writeTransaction(db, async (tx) => {
    const contest = await findContest(tx, slug); const actor = await contestManager(tx, token, contest);
    const [story] = await tx.select().from(s.stories).where(and(eq(s.stories.id, storyId), eq(s.stories.contestId, contest.id)));
    if (!story) throw new ManagementError("Работа не найдена.", 404);
    if (!reason.trim()) throw new ManagementError("Укажите причину.");
    const [closed] = await tx.select().from(s.contestFinalizations).where(eq(s.contestFinalizations.contestId, contest.id));
    if (closed) throw new ManagementError("Окончательные результаты уже опубликованы.", 409);
    if (action === "withdraw") {
      const round = contest.stage === "round-one" ? 1 : contest.stage === "round-two" ? 2 : null;
      const now = currentTime();
      if (!round) throw new ManagementError("Снятие доступно только в активном туре до дедлайна.", 409);
      const [first] = await tx.select().from(s.firstRoundClosures).where(eq(s.firstRoundClosures.contestId, contest.id));
      if (round === 1 && first) throw new ManagementError("Первый тур уже закрыт.", 409);
      const [entry] = await tx.select().from(s.storyRounds).where(and(eq(s.storyRounds.storyId, story.id), eq(s.storyRounds.round, round)));
      if (!entry || !canWithdraw(story, contest, [entry], now)) throw new ManagementError("Работа уже снята или не участвует в туре.", 409);
      await withdrawRound(tx, contest.id, story.id, round, now, reason.trim());
      await adminEvent(tx, contest.id, actor.id, "moderate", { storyId, round, before: "active", after: "withdrawn", reason: reason.trim() });
    } else {
      const [formed] = await tx.select().from(s.firstRoundFormations).where(eq(s.firstRoundFormations.contestId, contest.id));
      const [group] = await tx.select({ id: s.contestGroups.id }).from(s.contestGroups).where(eq(s.contestGroups.contestId, contest.id));
      if (contest.isDraft || contest.stage !== "moderation" || formed || group || story.status !== "submitted") throw new ManagementError("Проверять submitted можно на этапе модерации до формирования групп.", 409);
      const status = action === "admit" ? "admitted" : "rejected";
      await tx.update(s.stories).set({ status, updatedAt: currentTime(), revision: story.revision + 1 }).where(eq(s.stories.id, story.id));
      await adminEvent(tx, contest.id, actor.id, "moderate", { storyId, before: story.status, after: status, reason: reason.trim() });
    }
    await tx.update(s.contests).set({ publicUpdatedAt: currentTime() }).where(eq(s.contests.id, contest.id));
    return { message: "Решение сохранено с причиной и историей." };
  });
}
export async function managementView(token: string, slug: string) {
  const { db } = await getDatabase();
  const view = await db.transaction(async (tx) => {
    const contest = await findContest(tx, slug); const user = await contestManager(tx, token, contest);
    const own = user.id === contest.organizerId;
    const [owner] = own ? await tx.select({ email: s.users.email }).from(s.users).where(eq(s.users.id, contest.organizerId)) : [];
    const [coord] = own && contest.coordinatorId ? await tx.select({ email: s.users.email }).from(s.users).where(eq(s.users.id, contest.coordinatorId)) : [];
    const works = await tx.select({ id: s.stories.id, title: s.stories.title, content: s.stories.content, status: s.stories.status, aiGenerationBasisPoints: s.stories.aiGenerationBasisPoints, length: s.stories.length }).from(s.stories).where(and(eq(s.stories.contestId, contest.id), ne(s.stories.status, "draft"))).orderBy(asc(s.stories.createdAt));
    const [theme] = await tx.select({ enteredAt: s.contestThemes.enteredAt }).from(s.contestThemes).where(eq(s.contestThemes.contestId, contest.id));
    const [formation] = await tx.select({ at: s.firstRoundFormations.formedAt }).from(s.firstRoundFormations).where(eq(s.firstRoundFormations.contestId, contest.id));
    const members = await tx.select({ id: s.participations.id, mustOne: s.participations.mustVoteRoundOne, mustTwo: s.participations.mustVoteRoundTwo, exemptOne: s.participations.roundOneExemptAt, exemptTwo: s.participations.roundTwoExemptAt }).from(s.participations).where(eq(s.participations.contestId, contest.id));
    const events = await tx.select({ action: s.contestAdminEvents.action, details: s.contestAdminEvents.details, at: s.contestAdminEvents.createdAt, actorName: s.users.publicName }).from(s.contestAdminEvents).leftJoin(s.users, eq(s.contestAdminEvents.actorId, s.users.id)).where(eq(s.contestAdminEvents.contestId, contest.id)).orderBy(desc(s.contestAdminEvents.createdAt)).limit(100);
    const groups = await tx.select({ id: s.contestGroups.id, round: s.contestGroups.round, number: s.contestGroups.number, criticatDiscussionUrl: s.contestGroups.criticatDiscussionUrl }).from(s.contestGroups).where(eq(s.contestGroups.contestId, contest.id));
    const schedule = await scheduleStatus(tx, contest);
    const { organizerId: _owner, coordinatorId: _coord, ...safe } = contest;
    void _owner; void _coord;
    return { groups, schedule, contest: safe, owner: own, ownerEmail: owner?.email ?? "", coordinatorEmail: coord?.email ?? "", works, themeEntered: Boolean(theme), formedAt: formation?.at?.toISOString() ?? null, participantCount: members.length,
      events: events.map((e) => ({ action: e.action, at: e.at.toISOString(), actor: e.action === "theme-entered-by-link" ? "Получатель ссылки" : e.details.actor === "scheduler" ? "Автоматический обработчик" : e.actorName || "Уполномоченный пользователь", ...eventView(e.action, e.details, works) })) };
  });
  const rounds = [];
  for (const round of [1, 2] as const) {
    const statuses = await coordinatorVotingStatuses(token, slug, round);
    rounds.push({ round, submitted: statuses.filter((m) => m.status === "submitted").length,
      exempt: statuses.filter((m) => m.status === "exempt").length,
      pending: statuses.filter((m) => ["pending", "not-voted"].includes(m.status)).length });
  }
  return { ...view, rounds };
}
