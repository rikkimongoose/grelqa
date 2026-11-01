import type { FinalizationSnapshot } from "../contests/finalization-types";
import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { FinalRoundSnapshot } from "../contests/final-round-types";
import type { ClosureSnapshot } from "../contests/closure-rules";
import type { FirstRoundOutcome } from "../contests/grouping-rules";

export const stages = ["preparation", "submissions", "moderation", "round-one", "round-two", "completed", "failed"] as const;
const id = () => text("id").primaryKey();
const instant = (name: string) => integer(name, { mode: "timestamp_ms" });
const roundCheck = (value: unknown) => sql`${value} in (1, 2)`;

export const users = sqliteTable("users", {
  id: id(),
  publicName: text("public_name"),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  emailVerifiedAt: instant("email_verified_at"),
  createdAt: instant("created_at").notNull(),
}, (t) => [uniqueIndex("users_normalized_email").on(sql`lower(trim(${t.email}))`)]);

export const authSessions = sqliteTable("auth_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: instant("created_at").notNull(),
  expiresAt: instant("expires_at").notNull(),
}, (t) => [index("auth_session_user").on(t.userId)]);

export const authTokens = sqliteTable("auth_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  purpose: text("purpose", { enum: ["verify", "reset"] }).notNull(),
  createdAt: instant("created_at").notNull(),
  expiresAt: instant("expires_at").notNull(),
  usedAt: instant("used_at"),
}, (t) => [index("auth_token_user").on(t.userId, t.purpose), check("auth_token_purpose", sql`${t.purpose} in ('verify','reset')`)]);

export const authRateLimits = sqliteTable("auth_rate_limits", {
  key: text("key").primaryKey(),
  attempts: integer("attempts").notNull(),
  resetsAt: instant("resets_at").notNull(),
});

export const contests = sqliteTable("contests", {
  id: id(),
  slug: text("slug").notNull().unique(),
  organizerId: text("organizer_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  coordinatorId: text("coordinator_id").references(() => users.id, { onDelete: "restrict" }),
  isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(false),
  publicUpdatedAt: instant("public_updated_at"),
  settingsRevision: integer("settings_revision").notNull().default(1),
  title: text("title").notNull(),
  description: text("description").notNull(),
  discussionUrl: text("discussion_url"),
  stage: text("stage", { enum: stages }).notNull().default("preparation"),
  failureReason: text("failure_reason"),
  preparationAt: instant("preparation_at"),
  submissionsStartAt: instant("submissions_start_at").notNull(),
  // Московский календарный день; проверяется на соответствие точному времени.
  startDayMoscow: text("start_day_moscow").notNull().unique(),
  submissionsEndAt: instant("submissions_end_at").notNull(),
  roundOneStartAt: instant("round_one_start_at").notNull(),
  roundTwoStartAt: instant("round_two_start_at"),
  endsAt: instant("ends_at").notNull(),
  votingEndedAt: instant("voting_ended_at"),
  groupCapacity: integer("group_capacity").notNull(),
  finalCapacity: integer("final_capacity").notNull(),
  minLength: integer("min_length").notNull().default(0),
  maxLength: integer("max_length").notNull().default(0),
  isDemo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  createdAt: instant("created_at").notNull(),
}, (t) => [
  check("contest_stage", sql`${t.stage} in ('preparation','submissions','moderation','round-one','round-two','completed','failed')`),
  check("contest_failure_reason", sql`${t.stage} != 'failed' or length(trim(${t.failureReason})) > 0 and ${t.failureReason} is not null`),
  check("contest_capacity", sql`${t.groupCapacity} > 0 and ${t.finalCapacity} > 0`),
  check("contest_lengths", sql`${t.minLength} >= 0 and ${t.maxLength} >= 0 and (${t.maxLength} = 0 or ${t.minLength} <= ${t.maxLength})`),
  check("contest_start_moscow", sql`strftime('%H:%M:%f', ${t.submissionsStartAt} / 1000.0, 'unixepoch', '+3 hours') = '15:00:00.000' and ${t.startDayMoscow} = strftime('%Y-%m-%d', ${t.submissionsStartAt} / 1000.0, 'unixepoch', '+3 hours')`),
  check("contest_schedule", sql`(${t.preparationAt} is null or ${t.preparationAt} <= ${t.submissionsStartAt}) and ${t.submissionsStartAt} < ${t.submissionsEndAt} and ${t.submissionsEndAt} <= ${t.roundOneStartAt} and ${t.roundOneStartAt} < ${t.endsAt} and (${t.roundTwoStartAt} is null or (${t.roundOneStartAt} < ${t.roundTwoStartAt} and ${t.roundTwoStartAt} < ${t.endsAt}))`),
]);

export const contestThemes = sqliteTable("contest_themes", {
  contestId: text("contest_id").primaryKey().references(() => contests.id, { onDelete: "restrict" }),
  theme: text("theme").notNull(),
  conditions: text("conditions", { mode: "json" }).$type<string[]>().notNull(),
  enteredAt: instant("entered_at").notNull(),
  publishedAt: instant("published_at"),
  accessTokenHash: text("access_token_hash").unique(),
  accessUsedAt: instant("access_used_at"),
});

// Приватный неизменяемый снимок первичного распределения, не публичный DTO.
export const firstRoundFormations = sqliteTable("first_round_formations", {
  contestId: text("contest_id").primaryKey().references(() => contests.id, { onDelete: "restrict" }),
  formedAt: instant("formed_at").notNull(),
  snapshot: text("snapshot", { mode: "json" }).$type<FirstRoundOutcome>().notNull(),
});

export const contestGroups = sqliteTable("contest_groups", {
  id: id(),
  contestId: text("contest_id").notNull().references(() => contests.id, { onDelete: "restrict" }),
  round: integer("round").notNull(),
  number: integer("number").notNull(),
  capacity: integer("capacity").notNull(),
  publishedAt: instant("published_at"),
}, (t) => [
  unique("group_number").on(t.contestId, t.round, t.number),
  unique("group_scope").on(t.id, t.contestId, t.round),
  check("group_round", roundCheck(t.round)),
  check("group_positive", sql`${t.number} > 0 and ${t.capacity} > 0`),
]);

export const participations = sqliteTable("participations", {
  id: id(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  contestId: text("contest_id").notNull().references(() => contests.id, { onDelete: "restrict" }),
  assignedGroupId: text("assigned_group_id"),
  assignedRound: integer("assigned_round").notNull().default(1),
  finalist: integer("finalist", { mode: "boolean" }).notNull().default(false),
  mustVoteRoundOne: integer("must_vote_round_one", { mode: "boolean" }).notNull().default(false),
  mustVoteRoundTwo: integer("must_vote_round_two", { mode: "boolean" }).notNull().default(false),
  roundTwoRightsEndedAt: instant("round_two_rights_ended_at"),
  roundTwoExemptAt: instant("round_two_exempt_at"),
  roundTwoExemptReason: text("round_two_exempt_reason", { enum: ["no-eligible-stories"] }),
  roundOneExemptAt: instant("round_one_exempt_at"),
  roundOneExemptReason: text("round_one_exempt_reason", { enum: ["no-eligible-stories"] }),
  createdAt: instant("created_at").notNull(),
}, (t) => [
  unique("participation_user_contest").on(t.userId, t.contestId),
  unique("participation_scope").on(t.id, t.contestId),
  foreignKey({ columns: [t.assignedGroupId, t.contestId, t.assignedRound], foreignColumns: [contestGroups.id, contestGroups.contestId, contestGroups.round] }).onDelete("restrict"),
  check("assigned_first_round", sql`${t.assignedRound} = 1`),
]);

// Структурированный текст, а не HTML для вставки в браузер.
export type StoryContent = { type: "paragraph"; children: { text: string; bold?: boolean; italic?: boolean }[] }[];

export const stories = sqliteTable("stories", {
  id: id(),
  contestId: text("contest_id").notNull().references(() => contests.id, { onDelete: "restrict" }),
  participationId: text("participation_id").notNull(),
  title: text("title").notNull(),
  content: text("content", { mode: "json" }).$type<StoryContent>().notNull(),
  // Nullable до согласования единого конкурсного подсчёта Unicode-знаков.
  length: integer("length"),
  lengthAlgorithm: text("length_algorithm"),
  status: text("status", { enum: ["draft", "submitted", "admitted", "rejected", "withdrawn"] }).notNull().default("draft"),
  createdAt: instant("created_at").notNull(),
  updatedAt: instant("updated_at").notNull(),
  revision: integer("revision").notNull().default(1),
  publishedAt: instant("published_at"),
  withdrawnAt: instant("withdrawn_at"),
  withdrawalReason: text("withdrawal_reason"),
}, (t) => [
  unique("story_scope").on(t.id, t.contestId),
  index("story_author").on(t.participationId, t.contestId),
  foreignKey({ columns: [t.participationId, t.contestId], foreignColumns: [participations.id, participations.contestId] }).onDelete("restrict"),
  check("story_status", sql`${t.status} in ('draft','submitted','admitted','rejected','withdrawn')`),
  check("story_length", sql`(${t.length} is null and ${t.lengthAlgorithm} is null) or (${t.length} is not null and ${t.length} >= 0 and ${t.lengthAlgorithm} is not null)`),
  check("story_withdrawal", sql`${t.status} != 'withdrawn' or (${t.withdrawnAt} is not null and ${t.withdrawalReason} is not null)`),
]);

// Снятие и результаты финала не изменяют состояние рассказа в первом туре.
export const storyRounds = sqliteTable("story_rounds", {
  storyId: text("story_id").notNull(),
  contestId: text("contest_id").notNull(),
  round: integer("round").notNull(),
  groupId: text("group_id").notNull(),
  status: text("status", { enum: ["active", "withdrawn"] }).notNull().default("active"),
  withdrawnAt: instant("withdrawn_at"),
  withdrawalReason: text("withdrawal_reason"),
  points: integer("points"),
  place: integer("place"),
}, (t) => [
  primaryKey({ columns: [t.storyId, t.round] }),
  unique("story_round_scope").on(t.storyId, t.contestId, t.round, t.groupId),
  foreignKey({ columns: [t.storyId, t.contestId], foreignColumns: [stories.id, stories.contestId] }).onDelete("restrict"),
  foreignKey({ columns: [t.groupId, t.contestId, t.round], foreignColumns: [contestGroups.id, contestGroups.contestId, contestGroups.round] }).onDelete("restrict"),
  check("story_round_number", roundCheck(t.round)),
  check("story_round_status", sql`${t.status} in ('active','withdrawn')`),
  check("story_round_withdrawal", sql`${t.status} != 'withdrawn' or (${t.withdrawnAt} is not null and ${t.withdrawalReason} is not null)`),
  check("story_round_results", sql`(${t.points} is null or ${t.points} >= 0) and (${t.place} is null or ${t.place} > 0)`),
]);

export const ballots = sqliteTable("ballots", {
  id: id(),
  participationId: text("participation_id").notNull(),
  contestId: text("contest_id").notNull(),
  round: integer("round").notNull(),
  groupId: text("group_id").notNull(),
  createdAt: instant("created_at").notNull(),
  updatedAt: instant("updated_at").notNull(),
  submittedAt: instant("submitted_at"),
}, (t) => [
  unique("ballot_participant_round").on(t.participationId, t.round),
  unique("ballot_scope").on(t.id, t.contestId, t.round, t.groupId),
  foreignKey({ columns: [t.participationId, t.contestId], foreignColumns: [participations.id, participations.contestId] }).onDelete("restrict"),
  foreignKey({ columns: [t.groupId, t.contestId, t.round], foreignColumns: [contestGroups.id, contestGroups.contestId, contestGroups.round] }).onDelete("restrict"),
  check("ballot_round", roundCheck(t.round)),
]);

export const ballotEntries = sqliteTable("ballot_entries", {
  ballotId: text("ballot_id").notNull(),
  storyId: text("story_id").notNull(),
  contestId: text("contest_id").notNull(),
  round: integer("round").notNull(),
  groupId: text("group_id").notNull(),
  position: integer("position").notNull(),
}, (t) => [
  primaryKey({ columns: [t.ballotId, t.storyId] }),
  unique("ballot_position").on(t.ballotId, t.position),
  foreignKey({ columns: [t.ballotId, t.contestId, t.round, t.groupId], foreignColumns: [ballots.id, ballots.contestId, ballots.round, ballots.groupId] }).onDelete("restrict"),
  foreignKey({ columns: [t.storyId, t.contestId, t.round, t.groupId], foreignColumns: [storyRounds.storyId, storyRounds.contestId, storyRounds.round, storyRounds.groupId] }).onDelete("restrict"),
  check("ballot_position_range", sql`${t.position} between 1 and 6`),
]);

// Draft state/revision is separate from the effective submitted ballot.
export const ballotDrafts = sqliteTable("ballot_drafts", {
  participationId: text("participation_id").notNull(), contestId: text("contest_id").notNull(),
  round: integer("round").notNull().default(1), groupId: text("group_id").notNull(),
  selections: text("selections", { mode: "json" }).$type<string[] | null>(),
  revision: integer("revision").notNull().default(0), updatedAt: instant("updated_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.participationId, t.round] }),
  foreignKey({ columns: [t.participationId, t.contestId], foreignColumns: [participations.id, participations.contestId] }).onDelete("restrict"),
  foreignKey({ columns: [t.groupId, t.contestId, t.round], foreignColumns: [contestGroups.id, contestGroups.contestId, contestGroups.round] }).onDelete("restrict"),
  check("draft_round", roundCheck(t.round)), check("draft_revision", sql`${t.revision} >= 0`),
]);

export const ballotRequests = sqliteTable("ballot_requests", {
  participationId: text("participation_id").notNull().references(() => participations.id, { onDelete: "restrict" }),
  round: integer("round").notNull().default(1),
  requestId: text("request_id").notNull(), payloadHash: text("payload_hash").notNull(),
  response: text("response", { mode: "json" }).$type<{ revision: number; message: string; submittedAt: string | null }>().notNull(),
  receivedAt: instant("received_at").notNull(),
}, (t) => [primaryKey({ columns: [t.participationId, t.round, t.requestId] }), check("request_round", roundCheck(t.round))]);

// Private immutable audit; public queries must project a strict DTO, never serialize snapshot wholesale.
export const firstRoundClosures = sqliteTable("first_round_closures", {
  contestId: text("contest_id").primaryKey().references(() => contests.id, { onDelete: "restrict" }),
  closedAt: instant("closed_at").notNull(),
  snapshot: text("snapshot", { mode: "json" }).$type<ClosureSnapshot>().notNull(),
});

export const finalRounds = sqliteTable("final_rounds", {
  contestId: text("contest_id").primaryKey().references(() => contests.id, { onDelete: "restrict" }),
  groupId: text("group_id").notNull().unique().references(() => contestGroups.id, { onDelete: "restrict" }),
  preparedAt: instant("prepared_at").notNull(),
  snapshot: text("snapshot", { mode: "json" }).$type<FinalRoundSnapshot>().notNull(),
});

// Final publication barrier: results, withdrawals and author disclosure commit together.
export const contestFinalizations = sqliteTable("contest_finalizations", {
  contestId: text("contest_id").primaryKey().references(() => contests.id, { onDelete: "restrict" }),
  completedAt: instant("completed_at").notNull(),
  snapshot: text("snapshot", { mode: "json" }).$type<FinalizationSnapshot>().notNull(),
});

export const contestThemeInvites = sqliteTable("contest_theme_invites", {
  contestId: text("contest_id").primaryKey().references(() => contests.id, { onDelete: "restrict" }),
  tokenHash: text("token_hash").notNull().unique(), expiresAt: instant("expires_at").notNull(), usedAt: instant("used_at"),
});
export const contestAdminEvents = sqliteTable("contest_admin_events", {
  id: id(), contestId: text("contest_id").notNull().references(() => contests.id, { onDelete: "restrict" }),
  actorId: text("actor_id").references(() => users.id, { onDelete: "restrict" }),
  action: text("action").notNull(), details: text("details", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  createdAt: instant("created_at").notNull(),
}, (t) => [index("admin_events_contest").on(t.contestId, t.createdAt)]);
