import { eq } from "drizzle-orm";
import { openDatabase } from "../../src/db/connection";
import { contests } from "../../src/db/schema";
async function main() {
const { db } = await openDatabase();
await db.transaction(async (tx) => {
  await tx.update(contests).set({ title: "UNCOMMITTED TEST WRITE" }).where(eq(contests.slug, process.env.TEST_CONTEST!));
  process.stdout.write("LOCKED\n");
  await new Promise<void>((resolve) => process.stdin.once("data", () => resolve()));
});

}
main().catch(() => { console.error("Test worker failed"); process.exitCode = 1; });
