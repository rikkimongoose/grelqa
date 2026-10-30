import type { StoryContent } from "../db/schema";

type Node = { type?: string; text?: string; marks?: { type: string }[]; content?: Node[] };

export function toEditorContent(content: StoryContent): Node {
  return { type: "doc", content: content.map((block) => ({ type: "paragraph", content: block.children.flatMap((part) => {
    const marks = [...(part.bold ? [{ type: "bold" }] : []), ...(part.italic ? [{ type: "italic" }] : [])];
    return part.text.replace(/\r\n?/g, "\n").split("\n").flatMap((text, index) => [
      ...(index ? [{ type: "hardBreak" }] : []), ...(text ? [{ type: "text", text, ...(marks.length ? { marks } : {}) }] : []),
    ]);
  }) })) };
}

export function fromEditorContent(doc: Node): StoryContent {
  if (doc.type !== "doc") throw new Error("Неизвестный документ.");
  return (doc.content || []).map((block) => {
    if (block.type !== "paragraph") throw new Error("Разрешены только абзацы.");
    return { type: "paragraph", children: (block.content || []).map((part) => {
      if (part.type === "hardBreak") return { text: "\n" };
      if (part.type !== "text" || typeof part.text !== "string" || part.marks?.some((mark) => mark.type !== "bold" && mark.type !== "italic")) throw new Error("Неподдерживаемое форматирование.");
      return { text: part.text, ...(part.marks?.some((mark) => mark.type === "bold") ? { bold: true } : {}), ...(part.marks?.some((mark) => mark.type === "italic") ? { italic: true } : {}) };
    }) };
  });
}
