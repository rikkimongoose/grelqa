import { after, NextResponse } from "next/server";
import { z } from "zod";
import { authConfig } from "@/auth/config";
import { cookieSession } from "@/auth/session";
import { AuthError, consumeToken, createSession, credentials, emailSchema, issueMail, limit, passwordSchema, register, requestReset, revokeSession, sessionUser } from "@/auth/service";

export const runtime = "nodejs";
const reply = (message: string, status = 200, redirect?: string) => NextResponse.json({ message, redirect }, { status, headers: { "Cache-Control": "no-store" } });
const emailForm = z.object({ email: emailSchema });
const passwordForm = z.object({ password: passwordSchema, repeatPassword: z.string() }).refine((data) => data.password === data.repeatPassword, { message: "Пароли не совпадают." });

async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.length;
    if (size > 8192) { await reader.cancel(); throw new AuthError("Слишком большая форма.", 413); }
    chunks.push(item.value);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    if (request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(text));
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AuthError("Неверный формат формы.", 415);
    return JSON.parse(text) as unknown;
  } catch (error) { if (error instanceof AuthError) throw error; throw new AuthError("Некорректная форма."); }
}

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    const config = authConfig();
    if (request.headers.get("origin") !== config.origin || request.headers.get("sec-fetch-site") === "cross-site") throw new AuthError("Запрос отклонён. Обновите страницу и попробуйте снова.", 403);
    const { action } = await params;
    const allowed = ["register", "login", "logout", "resend", "verify", "forgot", "reset"];
    if (!allowed.includes(action)) return reply("Страница не найдена.", 404);
    // Общие лимиты не доверяют подставляемому X-Forwarded-For.
    if (action !== "logout") await limit(`global:${action}`, action === "login" ? 100 : 30, 900);
    const data = await body(request);
    if (action === "register") {
      const { email } = emailForm.parse(data);
      const { password } = passwordForm.parse(data);
      await limit(`register:${email}`, 3, 3600);
      const id = await register(email, password);
      const session = await cookieSession();
      await revokeSession(session.token);
      session.token = await createSession(id);
      await session.save();
      try { await issueMail(id, "verify"); } catch (error) {
        if (!(error instanceof AuthError)) throw error;
        return reply("Регистрация сохранена, но письмо не отправлено. Повторите отправку на странице состояния регистрации.", 200, "/registration-status?delivery=failed");
      }
      return reply("Регистрация сохранена. Проверьте почту.", 200, "/registration-status");
    }
    if (action === "login") {
      const { email } = emailForm.parse(data);
      const { password } = z.object({ password: z.string().min(1).max(128) }).parse(data);
      await limit(`login:${email}`, 5, 900);
      const user = await credentials(email, password);
      const session = await cookieSession();
      await revokeSession(session.token);
      session.token = await createSession(user.id, user.passwordHash);
      await session.save();
      return reply("Вход выполнен.", 200, (await sessionUser(session.token))?.emailVerifiedAt ? "/account" : "/registration-status");
    }
    if (action === "logout") {
      const session = await cookieSession();
      await revokeSession(session.token);
      session.destroy();
      if (request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return NextResponse.redirect(new URL("/", config.origin), 303);
      return reply("Вы вышли.", 200, "/");
    }
    if (action === "resend") {
      const session = await cookieSession();
      const user = await sessionUser(session.token);
      if (!user) throw new AuthError("Сначала войдите.", 401);
      if (user.emailVerifiedAt) return reply("Email уже подтверждён.", 200, "/account");
      await issueMail(user.id, "verify");
      return reply("Новое письмо отправлено. Проверьте почту.");
    }
    if (action === "forgot") {
      const { email } = emailForm.parse(data);
      try {
        await limit(`reset:${email}`, 3, 3600);
        // Ответ не ждёт поиска пользователя и SMTP: задержка доставки не выдаёт аккаунт.
        after(async () => {
          try { await requestReset(email); }
          catch { console.error("Grelqa: не удалось обработать письмо восстановления."); }
        });
      } catch (error) { if (!(error instanceof AuthError)) throw error; }
      return reply("Если этот email зарегистрирован, письмо с инструкцией будет отправлено. Проверьте почту.");
    }
    const { token } = z.object({ token: z.string().max(100) }).parse(data);
    if (action === "verify") {
      await consumeToken("verify", token);
      return reply("Email подтверждён. Теперь можно войти в кабинет.", 200, "/account");
    }
    const { password } = passwordForm.parse(data);
    await consumeToken("reset", token, password);
    const session = await cookieSession();
    await revokeSession(session.token);
    session.destroy();
    return reply("Пароль изменён. Все прежние сессии отозваны. Войдите с новым паролем.", 200, "/login");
  } catch (error) {
    if (error instanceof AuthError) return reply(error.message, error.status);
    if (error instanceof z.ZodError) return reply(error.issues[0]?.message || "Проверьте поля формы.", 400);
    // Не логируем исключения ORM/SMTP: они могут содержать персональные данные.
    console.error("Grelqa: ошибка обработки аутентификации.");
    return reply("Не удалось выполнить запрос. Попробуйте позже.", 500);
  }
}
