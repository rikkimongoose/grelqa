import { and, eq } from "drizzle-orm";
import type { WriteTx } from "../db/write-transaction";
import { storyRounds } from "../db/schema";
import { refreshRoundOneExemptions, refreshRoundTwoExemptions } from "../voting/eligibility";
// Caller checks actor, current stage, deadline and active status in this transaction.
export async function withdrawRound(tx: WriteTx, contestId: string, storyId: string, round: number, now: Date, reason: string) {
  await tx.update(storyRounds).set({ status: "withdrawn", withdrawnAt: now, withdrawalReason: reason }).where(and(eq(storyRounds.storyId, storyId), eq(storyRounds.contestId, contestId), eq(storyRounds.round, round)));
  await refreshRoundOneExemptions(tx, contestId, now);
  await refreshRoundTwoExemptions(tx, contestId, now);
}
