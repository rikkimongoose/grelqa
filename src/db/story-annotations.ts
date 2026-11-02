import "server-only";
import { eq } from "drizzle-orm";
import type { Database } from "./connection";
import { stories } from "./schema";
export async function storyAiValues(db: Pick<Database, "select">, contestId: string) {
  const rows = await db.select({ id: stories.id, value: stories.aiGenerationBasisPoints }).from(stories).where(eq(stories.contestId, contestId));
  return new Map(rows.map((r) => [r.id, r.value]));
}
