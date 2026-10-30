import type { StoryContent } from "../db/schema";

export const LENGTH_ALGORITHM = "unicode-codepoints-paragraph-lf2-v1";
export const MAX_TEXT_LENGTH = 1_000_000;
export const storyStatusLabels = { draft: "Черновик (прежний статус)", submitted: "Подана · ожидает проверки", admitted: "Допущена", rejected: "Отклонена", withdrawn: "Снята" };

export function visibleStoryText(content: StoryContent): string {
  return content.map((block) => block.children.map((part) => part.text).join("")).join("\n\n").replace(/\r\n?/g, "\n");
}

export function countStoryText(content: StoryContent): number {
  return Array.from(visibleStoryText(content)).length;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Строгий формат записи: никаких HTML, атрибутов, ссылок или неизвестных блоков.
export function submissionContent(value: unknown): StoryContent {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4000) throw new Error("Текст должен содержать от 1 до 4000 абзацев.");
  let fragments = 0;
  const content: StoryContent = value.map((block) => {
    if (!object(block) || block.type !== "paragraph" || !Array.isArray(block.children) || Object.keys(block).some((key) => !["type", "children"].includes(key))) throw new Error("Разрешены только абзацы с текстом.");
    const children: StoryContent[number]["children"] = block.children.map((part: unknown) => {
      if (!object(part) || typeof part.text !== "string" || Object.keys(part).some((key) => !["text", "bold", "italic"].includes(key)) || (part.bold !== undefined && typeof part.bold !== "boolean") || (part.italic !== undefined && typeof part.italic !== "boolean")) throw new Error("Разрешены только текст, курсив и полужирное выделение.");
      if (++fragments > 16000 || part.text.length > MAX_TEXT_LENGTH * 2) throw new Error("Слишком большой текст.");
      // Непарные суррогаты не должны меняться при записи в Unicode-хранилище.
      for (const char of part.text) {
        const point = char.codePointAt(0)!;
        if (point >= 0xd800 && point <= 0xdfff) throw new Error("Текст содержит некорректный Unicode-знак.");
      }
      return { text: part.text.replace(/\r\n?/g, "\n"), ...(part.bold ? { bold: true } : {}), ...(part.italic ? { italic: true } : {}) };
    });
    return { type: "paragraph", children };
  });
  if (!visibleStoryText(content).trim()) throw new Error("Введите текст рассказа.");
  if (countStoryText(content) > MAX_TEXT_LENGTH) throw new Error("Технический предел — 1 000 000 знаков. Конкурс может устанавливать меньший максимум.");
  return content;
}

export function withinReception(contest: { stage: string; submissionsStartAt: Date; submissionsEndAt: Date }, now = new Date()) {
  return contest.stage === "submissions" && +contest.submissionsStartAt <= +now && +now < +contest.submissionsEndAt;
}

export function lengthError(length: number, min: number, max: number) {
  if (min !== 0 && length < min) return `Минимум конкурса — ${min} знаков с пробелами.`;
  if (max !== 0 && length > max) return `Максимум конкурса — ${max} знаков с пробелами.`;
  return undefined;
}
