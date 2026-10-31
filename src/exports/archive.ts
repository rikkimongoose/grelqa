import { zip, type Zippable } from "fflate";
import type { StoryContent } from "../db/schema";
import { storyFilenames } from "./filenames";
import { storyMarkdown } from "./markdown";

export const EXPORT_VERSION = "public-markdown-v1";
export type ExportGroup = { key: string; round: number; number: number; stories: { id: string; title: string; content: StoryContent }[] };
export function archiveEntries(groups: ExportGroup[], singleGroup: boolean) {
  const numbers = groups.filter((g) => g.key !== "ungrouped").map((g) => g.number);
  const repeated = new Set(numbers.filter((n, i) => numbers.indexOf(n) !== i));
  return groups.flatMap((group) => {
    const names = storyFilenames(group.stories.map((story) => story.title));
    const folder = group.key === "ungrouped" ? "Без группы" : repeated.has(group.number) ? `${group.round === 1 ? "Первый тур" : "Финал"}/${group.number}` : String(group.number);
    return group.stories.map((story, index) => ({
      path: `${singleGroup ? "" : folder + "/"}${names[index]}`,
      text: storyMarkdown(story.title, story.content),
    }));
  });
}
export async function buildZip(entries: ReturnType<typeof archiveEntries>) {
  const files: Zippable = Object.create(null);
  for (const entry of entries) files[entry.path] = [Buffer.from(entry.text, "utf8"), { mtime: new Date("2000-01-01T00:00:00Z") }];
  return new Promise<Uint8Array>((resolve, reject) => zip(files, { level: 6 }, (error, data) => error ? reject(error) : resolve(data)));
}
