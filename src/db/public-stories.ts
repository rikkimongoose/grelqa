import "server-only";
import { and, asc, eq, inArray, isNull, lte, notExists, sql } from "drizzle-orm";
import { getDatabase } from "./index";
import type { Database } from "./connection";
import { contests, contestGroups, stories, storyRounds } from "./schema";
import { parseStoryContent, storyVolume } from "../lib/story-content";

// Одинаковая проверка для списка, метаданных и прямого открытия рассказа.
async function readableStories(contestSlug: string, storyId?: string, connection?: Pick<Database, "select">, now = new Date()) {
  const db = connection ?? (await getDatabase()).db;
  return db.select({
    id: stories.id, title: stories.title, content: stories.content, length: stories.length,
    contestTitle: contests.title, contestSlug: contests.slug,
  }).from(stories).innerJoin(contests, eq(stories.contestId, contests.id)).where(and(
    eq(contests.slug, contestSlug),
    storyId === undefined ? undefined : eq(stories.id, storyId),
    inArray(contests.stage, ["round-one", "round-two", "completed"]),
    lte(contests.roundOneStartAt, now),
    eq(stories.status, "admitted"),
    isNull(stories.withdrawnAt),
    lte(stories.publishedAt, now),
    // Публикация снятых работ пока не согласована: временно не выдаём их текст.
    notExists(db.select({ one: sql`1` }).from(storyRounds).where(and(
      eq(storyRounds.storyId, stories.id), eq(storyRounds.status, "withdrawn"),
    ))),
  )).orderBy(asc(stories.createdAt), asc(stories.id));
}

export async function getPublicStory(contestSlug: string, storyId: string) {
  const [row] = await readableStories(contestSlug, storyId);
  if (!row) return undefined;
  const content = parseStoryContent(row.content);
  if (!content) return undefined;
  return { id: row.id, title: row.title, contestTitle: row.contestTitle, contestSlug: row.contestSlug,
    content, volume: storyVolume(content, row.length) };
}

export async function getPublicStoryGroupContents(contestSlug: string) {
  const { db } = await getDatabase();
  return db.transaction(async (tx) => readGroups(tx, contestSlug, new Date()));
}

async function readGroups(db: Pick<Database, "select">, contestSlug: string, now: Date) {
  const [contest] = await db.select({ title: contests.title }).from(contests).where(eq(contests.slug, contestSlug));
  if (!contest) return undefined;
  const rows = await readableStories(contestSlug, undefined, db, now);
  // Только опубликованные группы. Для финалиста берём последнюю доступную группу,
  // для остальных сохраняем первый тур. Текст при этом выводится один раз.
  const assignments = rows.length ? await db.select({
    storyId: storyRounds.storyId, groupId: contestGroups.id,
    number: contestGroups.number, round: contestGroups.round,
  }).from(storyRounds).innerJoin(contestGroups, eq(storyRounds.groupId, contestGroups.id))
    .innerJoin(contests, eq(contestGroups.contestId, contests.id)).where(and(
      inArray(storyRounds.storyId, rows.map((row) => row.id)),
      lte(contestGroups.publishedAt, now),
      lte(contestGroups.round, sql`case when ${contests.stage} = 'round-one' then 1 else 2 end`),
    )).orderBy(asc(contestGroups.round), asc(contestGroups.number)) : [];
  const byStory = new Map(assignments.map((item) => [item.storyId, item]));
  type Summary = { id: string; title: string; volume: string; content: NonNullable<ReturnType<typeof parseStoryContent>> };
  const groups = new Map<string, { key: string; title: string; round: number; number: number; stories: Summary[] }>();
  // Опубликованный якорь группы сохраняется, даже если все её работы сняты.
  const publishedGroups = await db.select({ id: contestGroups.id, round: contestGroups.round, number: contestGroups.number }).from(contestGroups)
    .innerJoin(contests, eq(contestGroups.contestId, contests.id)).where(and(
      eq(contests.slug, contestSlug), inArray(contests.stage, ["round-one", "round-two", "completed"]),
      lte(contests.roundOneStartAt, now), lte(contestGroups.publishedAt, now),
      lte(contestGroups.round, sql`case when ${contests.stage} = 'round-one' then 1 else 2 end`),
    ));
  for (const group of publishedGroups) groups.set(group.id, { key: group.id, title: `${group.round === 1 ? "Первый тур" : "Финал"} · Группа ${group.number}`, round: group.round, number: group.number, stories: [] });
  for (const row of rows) {
    const content = parseStoryContent(row.content);
    if (!content) continue;
    const assignment = byStory.get(row.id);
    const key = assignment?.groupId ?? "ungrouped";
    const group = groups.get(key) ?? {
      key,
      title: assignment ? `${assignment.round === 1 ? "Первый тур" : "Финал"} · Группа ${assignment.number}` : "Рассказы без опубликованной группы",
      round: assignment?.round ?? 3, number: assignment?.number ?? 0, stories: [],
    };
    group.stories.push({ id: row.id, title: row.title, volume: storyVolume(content, row.length), content });
    groups.set(key, group);
  }
  return { title: contest.title, groups: [...groups.values()].sort((a, b) => a.round - b.round || a.number - b.number) };
}

export async function getPublicStoryGroups(contestSlug: string) {
  const snapshot = await getPublicStoryGroupContents(contestSlug);
  return snapshot?.groups.map((group) => ({ ...group, stories: group.stories.map(({ id, title, volume }) => ({ id, title, volume })) })) ?? [];
}
