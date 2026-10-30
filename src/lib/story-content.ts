import type { StoryContent } from "../db/schema";
import { countStoryText } from "./submission";

// JSON из хранилища тоже проверяем; пропускаем только известные текстовые поля.
export function parseStoryContent(value: unknown): StoryContent | null {
  if (!Array.isArray(value)) return null;
  const paragraphs: StoryContent = [];
  for (const block of value) {
    if (!block || block.type !== "paragraph" || !Array.isArray(block.children)) return null;
    const children: StoryContent[number]["children"] = [];
    for (const fragment of block.children) {
      if (!fragment || typeof fragment.text !== "string") return null;
      children.push({ text: fragment.text, bold: fragment.bold === true, italic: fragment.italic === true });
    }
    paragraphs.push({ type: "paragraph", children });
  }
  return paragraphs;
}

export function storyVolume(content: StoryContent, length: number | null) {
  const value = length ?? countStoryText(content);
  return `${length === null ? "≈ " : ""}${new Intl.NumberFormat("ru-RU").format(value)} знаков с пробелами`;
}
