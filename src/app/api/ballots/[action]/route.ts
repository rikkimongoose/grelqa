import { NextResponse } from "next/server";
import { z } from "zod";
import { authConfig } from "@/auth/config";
import { cookieSession } from "@/auth/session";
import { AuthError, limit, sessionUser } from "@/auth/service";
import { changeBallot } from "@/voting/service";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });
async function readJson(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AuthError("Ожидается JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError("Пустой запрос.");
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    length += value.length;
    if (length > 65536) { await reader.cancel(); throw new AuthError("Слишком большой запрос.", 413); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; } catch { throw new AuthError("Некорректный JSON."); }
}
export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  // Trusted handler arrival, before auth/body/queueing. Never read a browser timestamp.
  const receivedAt = new Date();
  try {
    if (request.headers.get("origin") !== authConfig().origin || request.headers.get("sec-fetch-site") === "cross-site") throw new AuthError("Запрос отклонён. Обновите страницу.", 403);
    const session = await cookieSession();
    const user = await sessionUser(session.token);
    if (!user) throw new AuthError("Войдите в учётную запись.", 401);
    if (!user.emailVerifiedAt) throw new AuthError("Подтвердите email.", 403);
    await limit(`ballots:${user.id}`, 120, 60);
    const { action } = await params;
    if (!["draft", "submit", "add"].includes(action)) return reply({ message: "Действие не найдено." }, 404);
    const base = { round: z.union([z.literal(1), z.literal(2)]).default(1), slug: z.string().min(1).max(200), revision: z.number().int().nonnegative(), requestId: z.uuid() };
    const raw = await readJson(request);
    const input = action === "add" ? z.object({ ...base, storyId: z.string().min(1).max(100) }).strict().parse(raw)
      : z.object({ ...base, selections: z.array(z.string().min(1).max(100)).max(6) }).strict().parse(raw);
    return reply(await changeBallot(session.token, action as "draft" | "submit" | "add", input, receivedAt, input.round));
  } catch (error) {
    if (error instanceof AuthError) return reply({ message: error.message }, error.status);
    if (error instanceof z.ZodError) return reply({ message: "Проверьте выбранные работы и версию бюллетеня." }, 400);
    console.error("Grelqa: ошибка сохранения бюллетеня.");
    return reply({ message: "Не удалось сохранить бюллетень. Ваш выбор остаётся на странице; повторите запрос." }, 500);
  }
}
