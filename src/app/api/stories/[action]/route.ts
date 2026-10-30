import { NextResponse } from "next/server";
import { z } from "zod";
import { authConfig } from "@/auth/config";
import { cookieSession } from "@/auth/session";
import { AuthError, limit, sessionUser } from "@/auth/service";
import { saveStory, withdrawStory } from "@/stories/service";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const response = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });

async function json(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AuthError("Ожидается JSON.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError("Пустой запрос.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new AuthError("Технический предел запроса — 8 МиБ.", 413); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new AuthError("Некорректный запрос."); }
}

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    if (request.headers.get("origin") !== authConfig().origin || request.headers.get("sec-fetch-site") === "cross-site") throw new AuthError("Запрос отклонён. Обновите страницу.", 403);
    const session = await cookieSession();
    const user = await sessionUser(session.token);
    if (!user) throw new AuthError("Войдите в учётную запись.", 401);
    if (!user.emailVerifiedAt) throw new AuthError("Сначала подтвердите email.", 403);
    await limit(`stories:${user.id}`, 120, 60);
    const { action } = await params;
    const data = await json(request);
    if (action === "save") {
      const value = z.object({ slug: z.string().min(1).max(200), title: z.string().max(400), content: z.unknown(), id: z.string().min(1).max(100).optional(), revision: z.number().int().positive().optional() }).parse(data);
      if (value.id && !value.revision) throw new AuthError("Нужна версия редактируемой работы.");
      const saved = await saveStory(session.token, value.slug, value);
      return response({ ...saved, message: "Работа сохранена. До проверки и разрешённой публикации она доступна только вам." });
    }
    if (action === "withdraw") {
      const value = z.object({ id: z.string().min(1).max(100), revision: z.number().int().positive(), confirmed: z.literal(true) }).parse(data);
      await withdrawStory(session.token, value.id, value.revision);
      return response({ message: "Работа снята. Её текст и история сохранены. Восстановление недоступно." });
    }
    return response({ message: "Действие не найдено." }, 404);
  } catch (error) {
    if (error instanceof AuthError) return response({ message: error.message }, error.status);
    if (error instanceof z.ZodError) return response({ message: "Проверьте поля формы и подтверждение действия." }, 400);
    console.error("Grelqa: ошибка сохранения работы.");
    return response({ message: "Не удалось выполнить запрос. Попробуйте позже." }, 500);
  }
}
