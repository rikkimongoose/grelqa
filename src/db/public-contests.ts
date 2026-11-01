import "server-only";
import { and, asc, eq, lte, ne } from "drizzle-orm";
import type { Contest } from "../lib/contests";
import { getDatabase } from "./index";
import { contests, contestThemes } from "./schema";
import { publicFailureMessage } from "../contests/grouping-rules";

// Белый список публичных полей. Пользователи, авторы и бюллетени вообще не читаются.
// Скрытая тема и её условия отсекаются в SQL до формирования результата.
export async function getPublicContests(slug?: string): Promise<Contest[]> {
  const { db } = await getDatabase();
  const now = new Date();
  const rows = await db.select({
    slug: contests.slug, title: contests.title, description: contests.description,
    stage: contests.stage, minLength: contests.minLength, maxLength: contests.maxLength,
    preparationAt: contests.preparationAt, submissionsStartAt: contests.submissionsStartAt,
    submissionsEndAt: contests.submissionsEndAt, roundOneStartAt: contests.roundOneStartAt,
    roundTwoStartAt: contests.roundTwoStartAt, endsAt: contests.endsAt, isDemo: contests.isDemo,
    theme: contestThemes.theme, conditions: contestThemes.conditions,
    failureReason: contests.failureReason,
  }).from(contests).leftJoin(contestThemes, and(
    eq(contestThemes.contestId, contests.id),
    ne(contests.stage, "preparation"),
    lte(contests.submissionsStartAt, now),
    lte(contestThemes.publishedAt, now),
  )).where(and(eq(contests.isDraft, false), slug ? eq(contests.slug, slug) : undefined))
    .orderBy(asc(contests.createdAt), asc(contests.slug));

  const number = new Intl.NumberFormat("ru-RU");
  return rows.map((row, index) => {
    const schedule: Contest["schedule"] = [];
    const add = (stage: Contest["stage"], label: string, date: Date | null) => {
      if (date) schedule.push({ stage, label, date: date.toISOString() });
    };
    add("preparation", "Подготовка", row.preparationAt);
    add("submissions", "Начало приёма работ", row.submissionsStartAt);
    add("moderation", "Окончание приёма · модерация", row.submissionsEndAt);
    add("round-one", "Первый тур", row.roundOneStartAt);
    add("round-two", "Второй тур, если будет несколько групп", row.roundTwoStartAt);
    add("completed", "Завершение", row.endsAt);
    const length = row.minLength && row.maxLength
      ? `От ${number.format(row.minLength)} до ${number.format(row.maxLength)} знаков с пробелами`
      : row.maxLength ? `До ${number.format(row.maxLength)} знаков с пробелами`
      : row.minLength ? `От ${number.format(row.minLength)} знаков с пробелами`
      : "Без конкурсных ограничений длины";
    return {
      slug: row.slug, number: String(index + 1).padStart(2, "0"), title: row.title,
      description: row.description, stage: row.stage, theme: row.theme, isDemo: row.isDemo,
      conditions: row.conditions ?? ["Тема и дополнительные условия будут опубликованы при старте конкурса."],
      length, schedule,
      failureMessage: row.stage === "failed" ? publicFailureMessage(row.failureReason) : null,
    };
  });
}

export async function getPublicContest(slug: string) {
  return (await getPublicContests(slug))[0];
}
