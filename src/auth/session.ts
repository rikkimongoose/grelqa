import "server-only";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { redirect } from "next/navigation";
import { authConfig } from "./config";
import { sessionUser } from "./service";

export async function cookieSession() {
  const store = await cookies();
  const config = authConfig();
  return getIronSession<{ token?: string }>(store, {
    password: config.secret, cookieName: config.production ? "__Host-grelqa" : "grelqa",
    ttl: 30 * 86400,
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: config.production, path: "/", maxAge: 30 * 86400 },
  });
}

export async function currentUser() {
  const session = await cookieSession();
  return sessionUser(session.token);
}

export async function requireVerifiedUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.emailVerifiedAt) redirect("/registration-status");
  return user;
}
