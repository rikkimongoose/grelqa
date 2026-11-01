import { currentTime } from "../server/clock";
import "server-only";
import { and, eq } from "drizzle-orm";
import { getDatabase } from "../db";
import { finalRounds, contests, participations, ballots, ballotDrafts } from "../db/schema";
export async function publicFinalStatus(slug: string) {
  const { db } = await getDatabase();
  const [row] = await db.select({ groupId: finalRounds.groupId, stage: contests.stage, start: contests.roundTwoStartAt, end: contests.endsAt }).from(finalRounds)
    .innerJoin(contests, eq(finalRounds.contestId, contests.id)).where(eq(contests.slug, slug));
  return row && ["round-two", "completed"].includes(row.stage) ? { groupId: row.groupId, open: row.stage === "round-two" && row.start !== null && +row.start <= +currentTime() && +currentTime() < +row.end, start: row.start?.toISOString(), end: row.end.toISOString() } : undefined;
}
export async function myFinalGroups(userId: string) {
  const { db } = await getDatabase();
  const rows = await db.select({ slug: contests.slug, title: contests.title, memberId: participations.id, final: finalRounds.snapshot, exemptAt: participations.roundTwoExemptAt, rightsEndedAt: participations.roundTwoRightsEndedAt,
    sentAt: ballots.submittedAt, draft: ballotDrafts.selections }).from(participations)
    .innerJoin(contests, eq(participations.contestId, contests.id)).innerJoin(finalRounds, eq(finalRounds.contestId, contests.id))
    .leftJoin(ballots, and(eq(ballots.participationId, participations.id), eq(ballots.round, 2)))
    .leftJoin(ballotDrafts, and(eq(ballotDrafts.participationId, participations.id), eq(ballotDrafts.round, 2))).where(eq(participations.userId, userId));
  return rows.filter((row) => row.final.members.some((member) => member.participationId === row.memberId && member.userId === userId)).map((row) => ({
    slug: row.slug, title: row.title, href: `/contests/${encodeURIComponent(row.slug)}/final-ballot`,
    status: row.rightsEndedAt ? "Право и обязанность голосовать прекращены: все финальные работы сняты. Сохранённые версии доступны для просмотра." : row.exemptAt ? "Освобождён от голосования" : row.sentAt ? `Бюллетень отправлен${row.draft !== null ? "; есть отдельный черновик" : ""}` : row.draft !== null ? "Сохранён черновик; голосование не выполнено" : "Бюллетень ещё не отправлен",
  }));
}
