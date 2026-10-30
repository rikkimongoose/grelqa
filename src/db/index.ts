import "server-only";
import { openDatabase } from "./connection";

let connection: ReturnType<typeof openDatabase> | undefined;

export function getDatabase() {
  connection ??= openDatabase();
  return connection;
}
