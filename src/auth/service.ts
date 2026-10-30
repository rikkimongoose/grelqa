import "server-only";
import { randomBytes, randomUUID, createHash, scryptSync, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDatabase } from "../db";
import { users, authTokens, authSessions, authRateLimits } from "../db/schema";
import { sendAuthMail } from "./mail";

export class AuthError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const normalizeEmail = (value: string) => value.trim().toLowerCase();
export const emailSchema = z.string().max(320).transform(normalizeEmail).pipe(z.email().max(254).regex(/^[\x21-\x7e]+$/, "Используйте email латиницей."));
export const passwordSchema = z.string().min(12, "Пароль: от 12 до 128 символов.").max(128, "Пароль: от 12 до 128 символов.");
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const randomToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (purpose: string, value: string) => createHash("sha256").update(`${purpose}:${value}`).digest("hex");
// 2 — Argon2id в API @node-rs/argon2; ambient const enum несовместим с isolatedModules.
const passwordHash = (password: string) => hash(password, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 });
const emailCondition = (email: string) => sql`lower(trim(${users.email})) = ${email}`;

export async function limit(key: string, max: number, seconds: number) {
  const { db } = await getDatabase();
  const now = new Date();
  const [row] = await db.insert(authRateLimits).values({ key: tokenHash("rate", key), attempts: 1, resetsAt: new Date(+now + seconds * 1000) })
    .onConflictDoUpdate({ target: authRateLimits.key, set: {
      attempts: sql`case when ${authRateLimits.resetsAt} <= ${+now} then 1 else ${authRateLimits.attempts} + 1 end`,
      resetsAt: sql`case when ${authRateLimits.resetsAt} <= ${+now} then ${+now + seconds * 1000} else ${authRateLimits.resetsAt} end`,
    } }).returning();
  if (row.attempts > max) throw new AuthError("Слишком много попыток. Попробуйте позже.", 429);
}

export async function register(email: string, password: string) {
  const { db } = await getDatabase();
  const existing = await db.select({ id: users.id }).from(users).where(emailCondition(email));
  if (existing.length) throw new AuthError("Этот email уже зарегистрирован. Войдите или восстановите пароль.", 409);
  const encoded = await passwordHash(password);
  const id = randomUUID();
  try {
    await db.insert(users).values({ id, email, passwordHash: encoded, createdAt: new Date() });
  } catch (error) {
    if (String((error as Error).cause).includes("UNIQUE")) throw new AuthError("Этот email уже зарегистрирован.", 409);
    throw error;
  }
  return id;
}

export async function credentials(email: string, password: string) {
  const { db } = await getDatabase();
  const [user] = await db.select().from(users).where(emailCondition(email));
  let valid = false;
  if (user?.passwordHash.startsWith("$argon2id$")) {
    try { valid = await verify(user.passwordHash, password); } catch { valid = false; }
  } else if (user?.passwordHash.startsWith("scrypt:")) {
    // Совместимость с сохранёнными seed-хешами; новые пароли — только Argon2id.
    const [, salt, encoded] = user.passwordHash.split(":");
    if (salt && /^[a-f0-9]{128}$/.test(encoded || "")) valid = timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(encoded, "hex"));
  } else {
    // Сопоставимая стоимость отсутствующего пользователя без выдачи его существования.
    await passwordHash(password);
  }
  if (!user || !valid) throw new AuthError("Неверный email или пароль.", 401);
  return { id: user.id, passwordHash: user.passwordHash };
}

export async function createSession(userId: string, expectedPasswordHash?: string) {
  const { db } = await getDatabase();
  const token = randomToken();
  await db.transaction(async (tx) => {
    const [user] = await tx.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId));
    if (!user || (expectedPasswordHash && user.passwordHash !== expectedPasswordHash)) throw new AuthError("Войдите заново.", 401);
    await tx.insert(authSessions).values({ tokenHash: tokenHash("session", token), userId, createdAt: new Date(), expiresAt: new Date(Date.now() + 30 * 86400_000) });
  });
  return token;
}

export async function sessionUser(token?: string) {
  if (!token || !tokenSchema.safeParse(token).success) return undefined;
  const { db } = await getDatabase();
  const [user] = await db.select({ id: users.id, email: users.email, emailVerifiedAt: users.emailVerifiedAt }).from(authSessions)
    .innerJoin(users, eq(authSessions.userId, users.id)).where(and(eq(authSessions.tokenHash, tokenHash("session", token)), gt(authSessions.expiresAt, new Date())));
  return user;
}

export async function revokeSession(token?: string) {
  if (!token) return;
  const { db } = await getDatabase();
  await db.delete(authSessions).where(eq(authSessions.tokenHash, tokenHash("session", token)));
}

export async function issueMail(userId: string, purpose: "verify" | "reset") {
  const { db } = await getDatabase();
  const [user] = await db.select({ email: users.email, verified: users.emailVerifiedAt }).from(users).where(eq(users.id, userId));
  if (!user || (purpose === "verify" && user.verified)) return;
  await limit(`mail:${userId}:${purpose}`, 3, 3600);
  const token = randomToken();
  const digest = tokenHash(purpose, token);
  await db.insert(authTokens).values({ tokenHash: digest, userId, purpose, createdAt: new Date(), expiresAt: new Date(Date.now() + (purpose === "verify" ? 86400_000 : 1800_000)) });
  try { await sendAuthMail(user.email, purpose, token); } catch {
    await db.delete(authTokens).where(eq(authTokens.tokenHash, digest));
    throw new AuthError("Не удалось отправить письмо. Попробуйте позже.", 503);
  }
}

export async function requestReset(email: string) {
  const { db } = await getDatabase();
  const [user] = await db.select({ id: users.id }).from(users).where(emailCondition(email));
  if (user) await issueMail(user.id, "reset");
}

export async function consumeToken(purpose: "verify" | "reset", rawToken: string, newPassword?: string) {
  if (!tokenSchema.safeParse(rawToken).success) throw new AuthError("Неверная ссылка.");
  const digest = tokenHash(purpose, rawToken);
  // Дорогой Argon2 вне блокировки; расходование токена и изменения — одной транзакцией.
  const encoded = purpose === "reset" ? await passwordHash(passwordSchema.parse(newPassword)) : undefined;
  const { db } = await getDatabase();
  await db.transaction(async (tx) => {
    const [token] = await tx.select().from(authTokens).where(and(eq(authTokens.tokenHash, digest), eq(authTokens.purpose, purpose)));
    if (!token) throw new AuthError("Неверная ссылка.");
    if (token.usedAt) throw new AuthError("Эта ссылка уже использована. Запросите новое письмо.");
    if (+token.expiresAt <= Date.now()) throw new AuthError("Срок действия ссылки истёк. Запросите новое письмо.");
    const used = await tx.update(authTokens).set({ usedAt: new Date() }).where(and(eq(authTokens.tokenHash, digest), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date()))).returning();
    if (!used.length) throw new AuthError("Ссылка больше недействительна.");
    if (purpose === "verify") {
      await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, token.userId));
    } else {
      await tx.update(users).set({ passwordHash: encoded! }).where(eq(users.id, token.userId));
      await tx.delete(authSessions).where(eq(authSessions.userId, token.userId));
      await tx.update(authTokens).set({ usedAt: new Date() }).where(and(eq(authTokens.userId, token.userId), eq(authTokens.purpose, "reset"), isNull(authTokens.usedAt)));
    }
  });
}
