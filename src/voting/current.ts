import "server-only";
import { cookieSession, currentUser } from "../auth/session";
import { AuthError } from "../auth/service";
import { myBallot } from "./service";

export async function currentBallot(slug: string) {
  const user = await currentUser();
  if (!user?.emailVerifiedAt) return undefined;
  try { return await myBallot((await cookieSession()).token, slug); }
  catch (error) { if (error instanceof AuthError && [403, 404].includes(error.status)) return undefined; throw error; }
}
