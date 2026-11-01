import { currentTime } from "../server/clock";
import { schedulerAuthority, type TransitionAuthority } from "../scheduling/authority";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, isNotNull } from "drizzle-orm";
import type { Database } from "../db/connection";
import { users, authSessions, contests, contestAdminEvents } from "../db/schema";
export class ManagementError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export type ManagementDb = Pick<Database, "select" | "insert">;
// Also imported by CLI-safe contest services: no next/headers or server-only dependency.
export async function verifiedManager(db: Pick<Database, "select">, token: string) {
  const digest = createHash("sha256").update(`session:${token}`).digest("hex");
  const [user] = await db.select({ id: users.id }).from(users).innerJoin(authSessions, eq(authSessions.userId, users.id))
    .where(and(eq(authSessions.tokenHash, digest), gt(authSessions.expiresAt, currentTime()), isNotNull(users.emailVerifiedAt)));
  if (!user) throw new ManagementError("Требуется вход с подтверждённым email.", 403);
  return user;
}
export async function contestManager(db: Pick<Database, "select">, token: string, contest: Pick<typeof contests.$inferSelect, "organizerId" | "coordinatorId">, ownerOnly = false) {
  const user = await verifiedManager(db, token);
  if (user.id !== contest.organizerId && (ownerOnly || user.id !== contest.coordinatorId)) throw new ManagementError("Нет права управления этим конкурсом.", 403);
  return user;
}
export async function adminEvent(db: Pick<Database, "insert" | "update">, contestId: string, actorId: string | null, action: string, details: Record<string, unknown> = {}) {
  if (["formFirstRound", "closeFirstRound", "prepareFinal", "finalizeContest", "closeReception"].includes(action)) await db.update(contests).set({ publicUpdatedAt: currentTime() }).where(eq(contests.id, contestId));
  await db.insert(contestAdminEvents).values({ id: randomUUID(), contestId, actorId, action, details, createdAt: currentTime() });
}

export async function transitionActor(db: Pick<Database, "select">, authority: TransitionAuthority | undefined, contest: Pick<typeof contests.$inferSelect, "organizerId" | "coordinatorId">) {
  if (authority === undefined) return null;
  if (authority === schedulerAuthority) return { id: null, scheduled: true };
  return { ...await contestManager(db, authority, contest), scheduled: false };
}
