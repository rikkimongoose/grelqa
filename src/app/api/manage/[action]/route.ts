import { revalidatePath } from "next/cache";
import { saveAnnotation } from "@/management/annotations";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authConfig } from "@/auth/config";
import { cookieSession } from "@/auth/session";
import { limit } from "@/auth/service";
import { ManagementError, verifiedManager } from "@/management/access";
import { getDatabase } from "@/db";
import { saveContest, assignCoordinator, issueThemeInvite, enterTheme, contestAction, moderateStory } from "@/management/service";
import { GroupingError } from "@/contests/grouping";
import { ClosureError } from "@/contests/close-first-round";
import { FinalizationError } from "@/contests/finalize";
import { FinalPreparationError } from "@/contests/prepare-final";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", Vary: "Cookie" };
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });
const slug = z.string().min(1).max(200);
async function json(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ManagementError("Ожидается JSON.", 415);
  const reader = request.body?.getReader(); if (!reader) throw new ManagementError("Пустой запрос.");
  const chunks: Uint8Array[] = []; let bytes = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 65536) { await reader.cancel(); throw new ManagementError("Запрос слишком большой.", 413); } chunks.push(value); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; } catch { throw new ManagementError("Неверный JSON."); }
}
export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  try {
    if (request.headers.get("origin") !== authConfig().origin || request.headers.get("sec-fetch-site") === "cross-site") throw new ManagementError("Запрос отклонён. Обновите страницу.", 403);
    const { action } = await params;
    if (action === "enter-theme") {
      await limit("global:contest-theme", 100, 900);
      const value = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), theme: z.string().max(4000), conditions: z.array(z.string().trim().min(1).max(2000)).max(30) }).strict().parse(await json(request));
      return reply(await enterTheme(value.token, value.theme, value.conditions));
    }
    const session = await cookieSession(); const token = session.token || "";
    const { db } = await getDatabase(); const user = await verifiedManager(db, token);
    await limit(`management:${user.id}`, 120, 60);
    const data = await json(request);
    if (action === "annotation") {
      const v = z.object({ slug, annotation: z.unknown() }).strict().parse(data);
      const saved = await saveAnnotation(token, v.slug, v.annotation);
      const base = `/contests/${encodeURIComponent(v.slug)}`;
      revalidatePath(base); revalidatePath(`/manage/${encodeURIComponent(v.slug)}`);
      for (const id of saved.groupIds) revalidatePath(`${base}/groups/${encodeURIComponent(id)}`);
      if (saved.storyId) { revalidatePath(`${base}/stories/${encodeURIComponent(saved.storyId)}`); revalidatePath(`${base}/ballot`); revalidatePath(`${base}/final-ballot`); }
      return reply({ message: saved.message });
    }
    if (action === "save") {
      const v = z.object({ settings: z.unknown(), slug: slug.optional(), revision: z.number().int().positive().optional() }).strict().parse(data);
      return reply({ ...await saveContest(token, v.settings, v.slug, v.revision), message: "Настройки сохранены." });
    }
    if (action === "coordinator") {
      const v = z.object({ slug, email: z.union([z.literal(""), z.email().max(254)]), revision: z.number().int().positive(), confirmed: z.literal(true) }).strict().parse(data);
      return reply(await assignCoordinator(token, v.slug, v.email, v.revision));
    }
    if (action === "theme-link") { const v = z.object({ slug }).strict().parse(data); return reply(await issueThemeInvite(token, v.slug)); }
    if (action === "moderate") {
      const v = z.object({ slug, storyId: z.string().min(1).max(200), decision: z.enum(["admit", "reject", "withdraw"]), reason: z.string().trim().min(1).max(2000), confirmed: z.literal(true) }).strict().parse(data);
      return reply(await moderateStory(token, v.slug, v.storyId, v.decision, v.reason));
    }
    if (["retry-schedule", "publish", "start-reception", "close-reception", "form", "start-first", "close-first", "prepare-final", "finalize"].includes(action)) {
      const v = z.object({ slug, confirmed: z.literal(true) }).strict().parse(data);
      return reply(await contestAction(token, v.slug, action));
    }
    return reply({ message: "Действие не найдено." }, 404);
  } catch (error) {
    if (error instanceof ManagementError) return reply({ message: error.message }, error.status);
    if (error instanceof z.ZodError) return reply({ message: error.issues.map((i) => i.message).join(" ") }, 400);
    if (error instanceof GroupingError || error instanceof ClosureError || error instanceof FinalizationError || error instanceof FinalPreparationError) return reply({ message: error.message }, 409);
    // Never log request bodies, tokens, SQL, hidden themes, emails or ballot contents.
    return reply({ message: "Операция не выполнена. Изменения откатились; обновите страницу и повторите." }, 500);
  }
}
