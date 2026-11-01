import { setTimeout as delay } from "node:timers/promises";
import type { Database } from "./connection";
export type WriteTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

// Shared by ballot acceptance and round finalization. SQLite owns the cross-process lock.
export type TransactionDatabase = Pick<Database, "select" | "insert" | "update" | "delete" | "transaction">;

export async function writeTransaction<T>(db: Pick<Database, "transaction">, work: (tx: WriteTx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.transaction(work); }
    catch (error) {
      let cause: unknown = error; let busy = false;
      for (let depth = 0; depth < 5 && cause && typeof cause === "object"; depth++) {
        const value = cause as { code?: string; cause?: unknown };
        busy ||= value.code === "SQLITE_BUSY" || value.code === "SQLITE_LOCKED"; cause = value.cause;
      }
      if (!busy || attempt >= 5) throw error;
      await delay(25 * (attempt + 1));
    }
  }
}
