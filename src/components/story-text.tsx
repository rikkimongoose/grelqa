import type { StoryContent } from "@/db/schema";

export function StoryText({ content }: { content: StoryContent }) {
  return <div className="story-text">{content.map((block, index) =>
    <p key={index}>{block.children.map((fragment, fragmentIndex) => {
      // React экранирует текст. Не интерпретируем HTML и не передаём чужие атрибуты.
      let text: React.ReactNode = fragment.text;
      if (fragment.italic) text = <em>{text}</em>;
      if (fragment.bold) text = <strong>{text}</strong>;
      return <span key={fragmentIndex}>{text}</span>;
    })}</p>,
  )}</div>;
}
