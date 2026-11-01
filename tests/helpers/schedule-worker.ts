import { openDatabase } from "../../src/db/connection";
import { processSchedule } from "../../src/scheduling/process";
async function main() {
const { db, client } = await openDatabase();
try { const at = new Date(process.env.TEST_CLOCK!); const result = await processSchedule(db, { slug: process.env.TEST_CONTEST, clock: () => at }); process.stdout.write(JSON.stringify(result)); process.exitCode = result.failed ? 1 : 0; } finally { client.close(); }

}
main().catch(() => { console.error("Test worker failed"); process.exitCode = 1; });
