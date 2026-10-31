import "server-only";
import { getPublicStoryGroupContents } from "../db/public-stories";
import { archiveEntries, buildZip, EXPORT_VERSION } from "./archive";
import { cachedZip, cacheDirectory, cacheKey, cleanExportCache } from "./cache";
import { safeBasename } from "./filenames";

let nextCleanup = 0;
async function exportSnapshot(slug: string, group?: string) {
  const snapshot = await getPublicStoryGroupContents(slug);
  if (!snapshot) return undefined;
  const groups = group === undefined ? snapshot.groups : snapshot.groups.filter((item) => item.key === group);
  if (!groups.some((item) => item.stories.length)) return undefined;
  const entries = archiveEntries(groups, group !== undefined);
  const key = cacheKey({ version: EXPORT_VERSION, access: "public", slug, group: group ?? null, title: snapshot.title,
    groups: groups.map((item) => ({ key: item.key, round: item.round, number: item.number, stories: item.stories.map(({ id }) => id) })), entries });
  const selected = groups[0];
  const name = group === undefined ? snapshot.title : selected.key === "ungrouped" ? `${snapshot.title} — без группы` : `${snapshot.title} — группа ${selected.number}`;
  return { key, entries, filename: safeBasename(name) + ".zip" };
}

export async function downloadArchive(slug: string, group?: string) {
  const directory = cacheDirectory();
  if (Date.now() >= nextCleanup) {
    nextCleanup = Date.now() + 3600_000;
    await cleanExportCache(directory);
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await exportSnapshot(slug, group);
    if (!snapshot) return undefined;
    const bytes = await cachedZip(snapshot.key, () => buildZip(snapshot.entries), directory);
    // Recheck publication even on a cache hit and after a slow build. Never serve a stale privilege variant.
    const latest = await exportSnapshot(slug, group);
    if (!latest) return undefined;
    if (latest.key === snapshot.key) return { bytes, filename: snapshot.filename };
  }
  throw new Error("Данные экспорта меняются. Повторите скачивание.");
}

export function attachmentHeader(filename: string) {
  return `attachment; filename="grelqa.zip"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (char) => "%" + char.charCodeAt(0).toString(16).toUpperCase())}`;
}
