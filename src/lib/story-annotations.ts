import { z } from "zod";

export function validatedCriticatUrl(value: string): string | null {
  if (!value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !["criticat.org", "www.criticat.org"].includes(url.hostname) || url.username || url.password || url.port) return null;
    return url.href;
  } catch { return null; }
}
export const criticatUrl = z.string().trim().max(2048).transform((value, ctx) => {
  if (!value) return null;
  const url = validatedCriticatUrl(value);
  if (!url) { ctx.addIssue({ code: "custom", message: "Укажите HTTPS-ссылку на criticat.org или www.criticat.org без логина, пароля и нестандартного порта." }); return z.NEVER; }
  return url;
});
// Integer hundredths of a percent: no binary floating-point arithmetic or rounding.
export const aiGeneration = z.union([z.string(), z.number().finite(), z.null()]).transform((value, ctx) => {
  if (value === null || String(value).trim() === "") return null;
  const text = String(value).trim();
  if (!/^\d{1,3}(?:[.,]\d{1,2})?$/.test(text)) { ctx.addIssue({ code: "custom", message: "AI-генерация: число от 0 до 100, не более двух знаков после запятой." }); return z.NEVER; }
  const [whole, fraction = ""] = text.replace(",", ".").split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (result > 10000) { ctx.addIssue({ code: "custom", message: "AI-генерация должна быть от 0 до 100%." }); return z.NEVER; }
  return result;
});
export const aiExplanation = "Результат внешней проверки, внесённый организатором; не является доказательством использования AI";
export function aiPercentage(value: number) { return String(value / 100); }
