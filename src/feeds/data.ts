import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, lte, ne, sql } from "drizzle-orm";
import { getDatabase } from "../db";
import { contests, contestThemes, contestFinalizations } from "../db/schema";
import { feedSiteUrl } from "./settings";

export type FeedEntry = {
  id: string; title: string; url: string; summary: string;
  published: Date; updated: Date; submissionsEnd: Date;
};
export type ContestFeed = { siteUrl: string; title: string; updated: Date | null; entries: FeedEntry[] };

export async function getContestFeed(): Promise<ContestFeed> {
  const siteUrl = feedSiteUrl();
  const { db } = await getDatabase();
  const now = new Date();
  // Same visibility conditions as the public contest's theme. Never query user/auth data.
  const announcedAt = sql<number>`max(${contests.submissionsStartAt}, ${contestThemes.publishedAt})`;
  const rows = await db.select({ id: contests.id, slug: contests.slug, title: contests.title,
    theme: contestThemes.theme, announcedAt, completedAt: contestFinalizations.completedAt, outcome: sql<string | null>`json_extract(${contestFinalizations.snapshot}, '$.tally.outcome')`, submissionsEnd: contests.submissionsEndAt,
  }).from(contests).innerJoin(contestThemes, eq(contestThemes.contestId, contests.id)).leftJoin(contestFinalizations, eq(contestFinalizations.contestId, contests.id)).where(and(
    ne(contests.stage, "preparation"), lte(contests.submissionsStartAt, now), lte(contestThemes.publishedAt, now),
  )).orderBy(desc(announcedAt), desc(contests.id)).limit(10);
  const entries = rows.map((row): FeedEntry => {
    const published = new Date(row.announcedAt);
    return {
      // Primary-key identity survives a renamed slug/title and a change of domain.
      id: `urn:grelqa:contest:${createHash("sha256").update(row.id).digest("hex")}`,
      title: row.title, url: new URL(`/contests/${encodeURIComponent(row.slug)}`, siteUrl).href,
      summary: `Тема: ${row.theme}\nОкончание приёма рассказов: ${row.submissionsEnd.toISOString()}${row.completedAt ? `\nКонкурс завершён: ${row.outcome === "failed" ? "не состоялся" : "опубликованы окончательные итоги и публичные имена авторов доступных работ"}.` : ""}`,
      published, updated: row.completedAt && +row.completedAt > +published ? row.completedAt : published, submissionsEnd: row.submissionsEnd,
    };
  });
  return { siteUrl, title: "Рваная Грелка — объявления конкурсов", updated: entries.length ? new Date(Math.max(...entries.map((entry) => +entry.updated))) : null, entries };
}
