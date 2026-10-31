import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, utimes, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export function cacheDirectory() {
  const directory = path.resolve(/* turbopackIgnore: true */ process.env.EXPORT_CACHE_DIRECTORY || ".local/exports");
  const publicDirectory = path.resolve("public");
  if (directory === publicDirectory || directory.startsWith(publicDirectory + path.sep)) throw new Error("Кэш экспорта нельзя размещать в public.");
  return directory;
}
export const cacheKey = (snapshot: unknown) => createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
const active = new Map<string, Promise<Buffer>>();
const STALE_LOCK = 10 * 60_000;
const MAX_AGE = 7 * 86400_000;

async function existing(file: string) {
  try {
    const bytes = await readFile(file);
    await utimes(file, new Date(), new Date()).catch(() => {});
    return bytes;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

export async function cleanExportCache(directory = cacheDirectory(), now = Date.now()) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let removed = 0;
  for (const name of await readdir(/* turbopackIgnore: true */ directory)) {
    if (!/^[a-f0-9]{64}(\.zip|\.lock|\.[a-f0-9-]+\.tmp)$/.test(name)) continue;
    const file = path.join(/* turbopackIgnore: true */ directory, name);
    try {
      const info = await stat(/* turbopackIgnore: true */ file);
      if (now - info.mtimeMs <= (name.endsWith(".zip") ? MAX_AGE : STALE_LOCK)) continue;
      await rm(file, { recursive: true, force: true }); removed++;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return removed;
}

export function cachedZip(key: string, build: () => Promise<Uint8Array>, directory = cacheDirectory()) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Некорректный ключ экспорта.");
  const file = path.join(directory, key + ".zip");
  const pending = active.get(file);
  if (pending) return pending;
  const task = assemble();
  active.set(file, task);
  void task.finally(() => active.delete(file)).catch(() => {});
  return task;

  async function assemble() {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const hit = await existing(file);
    if (hit) return hit;
    const lock = path.join(directory, key + ".lock");
    const deadline = Date.now() + STALE_LOCK;
    while (true) {
      try { await mkdir(lock, { mode: 0o700 }); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      const ready = await existing(file);
      if (ready) return ready;
      try { if (Date.now() - (await stat(lock)).mtimeMs > STALE_LOCK) await rm(lock, { recursive: true, force: true }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (Date.now() >= deadline) throw new Error("Истекло время ожидания экспорта.");
      await delay(50);
    }
    // Heartbeat prevents cleanup or another worker from treating a live build as abandoned.
    const heartbeat = setInterval(() => { void utimes(lock, new Date(), new Date()).catch(() => {}); }, 30_000);
    heartbeat.unref();
    const temporary = path.join(directory, `${key}.${randomUUID()}.tmp`);
    try {
      const ready = await existing(file);
      if (ready) return ready;
      const bytes = Buffer.from(await build());
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      await rename(temporary, file);
      return bytes;
    } finally {
      clearInterval(heartbeat);
      await rm(temporary, { force: true });
      await rm(lock, { recursive: true, force: true });
    }
  }
}
