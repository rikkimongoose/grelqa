import type { StoryContent } from "../db/schema";

function escapeText(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]()#+.!|~\-]/g, "\\$&");
}

export function storyMarkdown(title: string, content: StoryContent, authorName?: string | null) {
  const paragraphs = content.map((paragraph) => {
    const lines: { text: string; bold?: boolean; italic?: boolean }[][] = [[]];
    for (const fragment of paragraph.children) {
      const parts = fragment.text.replace(/\r\n?/g, "\n").split("\n");
      parts.forEach((text, index) => {
        if (index) lines.push([]);
        const line = lines[lines.length - 1];
        const previous = line[line.length - 1];
        if (previous && !!previous.bold === !!fragment.bold && !!previous.italic === !!fragment.italic) previous.text += text;
        else line.push({ ...fragment, text });
      });
    }
    return lines.map((line) => line.map(({ text, bold, italic }) => {
      const marker = bold && italic ? "***" : bold ? "**" : italic ? "*" : "";
      const match = text.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
      return escapeText(match[1]) + (match[2] ? marker + escapeText(match[2]) + marker : "") + escapeText(match[3]);
    }).join("").replace(/^[ \t]+/, (spaces) => [...spaces].map((char) => char === "\t" ? "&#9;" : "&#32;").join(""))).join("  \n");
  });
  return `# ${escapeText(title.replace(/[\r\n]+/g, " "))}\n\n${authorName ? `Автор: ${escapeText(authorName.replace(/[\r\n]+/g, " "))}\n\n` : ""}${paragraphs.join("\n\n")}\n`;
}
