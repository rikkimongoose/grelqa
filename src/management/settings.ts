import { z } from "zod";
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).transform((value, ctx) => {
  const parsed = new Date(value + ":00+03:00");
  if (!Number.isFinite(+parsed) || new Date(+parsed + 3 * 3600000).toISOString().slice(0, 16) !== value) {
    ctx.addIssue({ code: "custom", message: "Неверная календарная дата или время." }); return z.NEVER;
  }
  return parsed;
});
export const contestSettings = z.object({
  title: z.string().trim().min(1).max(200), description: z.string().trim().min(1).max(10000),
  discussionUrl: z.union([z.literal(""), z.url().refine((s) => ["http:", "https:"].includes(new URL(s).protocol))]),
  ownerEmail: z.string().trim().toLowerCase().email(), coordinatorEmail: z.union([z.literal(""), z.string().trim().toLowerCase().email()]),
  submissionsStartAt: date, submissionsEndAt: date, roundOneStartAt: date, roundTwoStartAt: z.union([z.literal(""), date]), endsAt: date,
  groupCapacity: z.number().int().min(1).max(100000), finalCapacity: z.number().int().min(1).max(100000),
  minLength: z.number().int().min(0).max(10000000), maxLength: z.number().int().min(0).max(10000000),
}).strict().superRefine((v, ctx) => {
  const d = v.submissionsStartAt.toISOString();
  if (!d.endsWith("T12:00:00.000Z")) ctx.addIssue({ code: "custom", message: "Начало приёма — 15:00 МСК.", path: ["submissionsStartAt"] });
  if (!(+v.submissionsStartAt < +v.submissionsEndAt && +v.submissionsEndAt <= +v.roundOneStartAt && +v.roundOneStartAt < +v.endsAt && (!v.roundTwoStartAt || (+v.roundOneStartAt < +v.roundTwoStartAt && +v.roundTwoStartAt < +v.endsAt)))) ctx.addIssue({ code: "custom", message: "Нарушен порядок этапов." });
  if (!v.roundTwoStartAt) ctx.addIssue({ code: "custom", message: "Задайте резервное начало финала: число групп станет известно только после приёма." });
  if (v.maxLength && v.minLength > v.maxLength) ctx.addIssue({ code: "custom", message: "Минимум больше максимума." });
});
export type SettingsInput = z.input<typeof contestSettings>;
