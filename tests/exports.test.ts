import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { unzipSync, strFromU8 } from "fflate";
import { storyMarkdown } from "../src/exports/markdown";
import { safeBasename, storyFilenames } from "../src/exports/filenames";
import { archiveEntries, buildZip, type ExportGroup } from "../src/exports/archive";
import { cachedZip, cacheKey, cleanExportCache } from "../src/exports/cache";
import { openDatabase } from "../src/db/connection";
import { contests, stories, storyRounds, contestGroups } from "../src/db/schema";

const content = [{ type: "paragraph" as const, children: [{ text: "Полный текст" }] }];
const group: ExportGroup = { key: "one", round: 1, number: 1, stories: [
  { id: "a", title: "Название", content }, { id: "b", title: "название", content }, { id: "c", title: "Название (1)", content },
] };

test("Markdown, UTF-8, безопасные имена, коллизии и структура ZIP", async () => {
  assert.equal(storyMarkdown("Заголовок #", [
    { type: "paragraph", children: [{ text: "обычный *текст* [ссылка](url) <script> &" }] },
    { type: "paragraph", children: [{ text: " жирный ", bold: true }, { text: "курсив", italic: true }, { text: "оба", italic: true, bold: true }] },
    { type: "paragraph", children: [{ text: "первая\nвторая", italic: true }] },
    { type: "paragraph", children: [{ text: "еди", bold: true }, { text: "ный", bold: true }] },
  ]), "# Заголовок \\#\n\nобычный \\*текст\\* \\[ссылка\\]\\(url\\) &lt;script&gt; &amp;\n\n&#32;**жирный** *курсив****оба***\n\n*первая*  \n*вторая*\n\n**единый**\n");
  assert.equal(storyMarkdown("Текст", [{ type: "paragraph", children: [{ text: "    # не код\n\tне код" }] }]), "# Текст\n\n&#32;&#32;&#32;&#32;\\# не код  \n&#9;не код\n");
  assert.deepEqual(storyFilenames(["Название", "название", "Название (1)", "Название", "Название (2)"]),
    ["Название.md", "название (3).md", "Название (1).md", "Название (4).md", "Название (2).md"]);
  for (const title of ["../путь\\тест\u0000:?. ", "CON", "nul.txt", "LPT1", "...", "", "Я".repeat(500), "A/Б", "A\\Б"]) {
    const safe = safeBasename(title);
    assert.ok(safe && Buffer.byteLength(safe) <= 180);
    assert.doesNotMatch(safe, /[<>:"/\\|?*\u0000-\u001f]|[. ]$/);
    assert.doesNotMatch(safe, /^(con|nul|lpt1)(\.|$)/i);
  }
  const names = storyFilenames(["А".repeat(200), "а".repeat(200), "NFC е\u0308", "NFC ё"]);
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, 4);
  const own = unzipSync(await buildZip(archiveEntries([group], true)));
  assert.deepEqual(Object.keys(own), ["Название.md", "название (2).md", "Название (1).md"]);
  assert.match(strFromU8(own["Название.md"]), /^# Название\n\nПолный текст\n$/);
  const second = { ...group, key: "two", number: 2 };
  const all = unzipSync(await buildZip(archiveEntries([group, second], false)));
  assert.deepEqual(Object.keys(all), [...Object.keys(own).map((n) => "1/" + n), ...Object.keys(own).map((n) => "2/" + n)]);
  for (const name of Object.keys(own)) assert.deepEqual(all["1/" + name], own[name]);
  const special = archiveEntries([group, { ...group, key: "final", round: 2 }, { ...group, key: "ungrouped", number: 0, round: 3 }], false);
  assert.ok(special.some((e) => e.path.startsWith("Первый тур/1/")));
  assert.ok(special.some((e) => e.path.startsWith("Финал/1/")));
  assert.ok(special.some((e) => e.path.startsWith("Без группы/")));
});

test("файловый кэш: одна сборка, отдельные процессы, ошибки и очистка", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "grelqa-export-cache-"));
  try {
    const key = cacheKey({ version: 1, content });
    let builds = 0;
    const build = async () => { builds++; await delay(30); return buildZip(archiveEntries([group], true)); };
    const results = await Promise.all(Array.from({ length: 8 }, () => cachedZip(key, build, dir)));
    assert.equal(builds, 1);
    results.forEach((r) => assert.deepEqual(r, results[0]));
    const file = path.join(dir, key + ".zip");
    const inode = (await stat(file)).ino;
    await cachedZip(key, () => { throw new Error("Не должна вызываться"); }, dir);
    assert.equal((await stat(file)).ino, inode);
    const bad = cacheKey("failed");
    await assert.rejects(cachedZip(bad, async () => { throw new Error("Ошибка сборки"); }, dir));
    assert.ok(!(await readdir(dir)).some((name) => name.startsWith(bad)));
    await cachedZip(bad, build, dir);
    assert.equal(Object.keys(unzipSync(await readFile(path.join(dir, bad + ".zip")))).length, 3);
    const multi = cacheKey("processes");
    const code = `import { buildZip } from './src/exports/archive.ts'; import { cachedZip } from './src/exports/cache.ts'; import { appendFile } from 'node:fs/promises'; await cachedZip(${JSON.stringify(multi)}, async () => { await appendFile(${JSON.stringify(path.join(dir, "builds"))}, 'built\\n'); await new Promise(r => setTimeout(r, 150)); return buildZip([{path: 'Тест.md', text: 'Текст'}]); }, ${JSON.stringify(dir)});`;
    const children = Array.from({ length: 3 }, () => spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { stdio: "pipe" }));
    const exits = await Promise.all(children.map(async (child) => { const [exit] = await once(child, "exit"); return exit; }));
    assert.deepEqual(exits, [0, 0, 0]);
    assert.equal(await readFile(path.join(dir, "builds"), "utf8"), "built\n");
    const old = new Date(Date.now() - 8 * 86400_000);
    await utimes(file, old, old);
    const tmp = path.join(dir, cacheKey("orphan") + ".1234.tmp");
    await writeFile(tmp, "partial"); await utimes(tmp, old, old);
    assert.equal(await cleanExportCache(dir), 2);
    assert.ok((await readdir(dir)).includes(bad + ".zip"));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("HTTP: публичные архивы, инвалидация, скрытые работы и повторная проверка доступа", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grelqa-exports-http-"));
  const cache = path.join(directory, "exports");
  const env = { ...process.env, DATABASE_URL: `file:${path.join(directory, "test.db")}`, EXPORT_CACHE_DIRECTORY: cache,
    SESSION_SECRET: "exports-test-secret-at-least-thirty-two-characters", APP_URL: "https://grelqa.test",
    MAIL_MODE: "smtp", SMTP_HOST: "127.0.0.1", SMTP_PORT: "9", MAIL_FROM: "test@grelqa.test" };
  let server: ReturnType<typeof spawn> | undefined;
  const connection = await openDatabase(env.DATABASE_URL);
  try {
    for (const script of ["scripts/migrate.ts", "scripts/seed.ts"]) execFileSync(process.execPath, ["--import", "tsx", script], { env, stdio: "pipe" });
    const { db } = connection;
    const [original] = await db.select().from(stories).where(eq(stories.id, "demo-city-story-1"));
    const sample = { ...original, id: "export-movable", title: "Перемещаемый рассказ" };
    await db.insert(stories).values(sample);
    await db.insert(storyRounds).values({ storyId: sample.id, contestId: sample.contestId, groupId: "demo-city-group-1", round: 1 });
    for (const status of ["draft", "submitted", "rejected", "withdrawn"] as const) await db.insert(stories).values({ ...sample, id: `hidden-${status}`, title: "СКРЫТЫЙ", status, withdrawnAt: status === "withdrawn" ? new Date("2020-01-01") : null, withdrawalReason: status === "withdrawn" ? "Тест" : null, content: [{ type: "paragraph", children: [{ text: "НЕОПУБЛИКОВАННЫЙ ТЕКСТ" }] }] });
    await db.insert(stories).values({ ...sample, id: "not-published", title: "СКРЫТЫЙ", publishedAt: null });
    await db.insert(stories).values({ ...sample, id: "future", title: "СКРЫТЫЙ", publishedAt: new Date("2099-01-01") });
    await db.insert(stories).values({ ...sample, id: "withdrawn-round", title: "СКРЫТЫЙ" });
    await db.insert(storyRounds).values({ storyId: "withdrawn-round", contestId: sample.contestId, groupId: "demo-city-group-1", round: 1, status: "withdrawn", withdrawnAt: new Date("2020-01-01"), withdrawalReason: "Тест" });
    await db.insert(contestGroups).values({ id: "export-group-2", contestId: sample.contestId, round: 1, number: 2, capacity: 20, publishedAt: new Date("2020-01-01") });
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "0"], { env, stdio: ["ignore", "pipe", "pipe"] });
    const base = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error(output || "Нет запуска")), 30000);
      server!.once("error", (e) => { clearTimeout(timer); reject(e); });
      server!.once("exit", () => { clearTimeout(timer); reject(new Error(output)); });
      const collect = (chunk: Buffer) => { output += chunk.toString(); const url = output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1]; if (url && output.includes("Ready")) { clearTimeout(timer); resolve(url); } };
      server!.stdout!.on("data", collect); server!.stderr!.on("data", collect);
    });
    const url = base + "/contests/city-between-lines/download";
    async function download(suffix = "") {
      const response = await fetch(url + suffix);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "application/zip");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.match(response.headers.get("content-disposition")!, /attachment;.*filename\*=UTF-8''/);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const files = unzipSync(bytes);
      for (const text of Object.values(files)) assert.doesNotMatch(strFromU8(text), /СКРЫТЫЙ|НЕОПУБЛИКОВАННЫЙ|grelqa\.example|demo-user-|passwordHash/);
      return { files, bytes };
    }
    const first = await download();
    const grouped = await download("?group=demo-city-group-1");
    assert.ok(Object.keys(grouped.files).every((n) => !n.includes("/")));
    for (const [name, bytes] of Object.entries(grouped.files)) assert.deepEqual(first.files["1/" + name], bytes);
    const cacheFiles = await readdir(cache);
    const before = await stat(path.join(cache, cacheFiles.find((n) => n.endsWith(".zip"))!));
    assert.deepEqual((await download()).bytes, first.bytes);
    assert.deepEqual(await readdir(cache), cacheFiles);
    assert.equal((await stat(path.join(cache, cacheFiles.find((n) => n.endsWith(".zip"))!))).ino, before.ino);
    const page = await (await fetch(base + "/contests/city-between-lines")).text();
    assert.match(page, /Скачать конкурс в ZIP/); assert.match(page, /Скачать группу в ZIP/);
    for (const suffix of ["?group=unknown", "?group=export-group-2"]) assert.equal((await fetch(url + suffix)).status, 404);
    await db.update(stories).set({ title: "Новая версия", content: [{ type: "paragraph", children: [{ text: "НОВЫЙ текст", bold: true }] }] }).where(eq(stories.id, sample.id));
    const changed = await download();
    assert.notDeepEqual(changed.bytes, first.bytes);
    assert.match(strFromU8(changed.files["1/Новая версия.md"]), /\*\*НОВЫЙ текст\*\*/);
    await db.update(storyRounds).set({ groupId: "export-group-2" }).where(eq(storyRounds.storyId, sample.id));
    const moved = await download();
    assert.ok(moved.files["2/Новая версия.md"]); assert.ok(!moved.files["1/Новая версия.md"]);
    await db.update(contestGroups).set({ number: 3 }).where(eq(contestGroups.id, "export-group-2"));
    assert.ok((await download()).files["3/Новая версия.md"]);
    const ordered = (await download()).bytes;
    await db.update(stories).set({ createdAt: new Date("2026-10-30") }).where(eq(stories.id, "demo-city-story-1"));
    assert.notDeepEqual((await download()).bytes, ordered);
    await db.update(stories).set({ publishedAt: null }).where(eq(stories.id, sample.id));
    assert.equal((await fetch(url + "?group=export-group-2")).status, 404);
    assert.ok(!("3/Новая версия.md" in (await download()).files));
    // A valid cookie is unnecessary: exports intentionally provide only the public variant.
    await db.update(contests).set({ stage: "moderation" }).where(eq(contests.id, sample.contestId));
    const denied = await fetch(url, { headers: { Cookie: "grelqa_session=invalid" } });
    assert.equal(denied.status, 404); assert.equal(denied.headers.get("cache-control"), "private, no-store");
    assert.doesNotMatch(await denied.text(), /Новая версия|Полный текст/);
    assert.equal((await fetch(base + "/contests/unknown/download")).status, 404);
  } finally {
    connection.client.close();
    if (server && server.exitCode === null && server.signalCode === null) { const exit = once(server, "exit"); server.kill("SIGTERM"); await exit; }
    await rm(directory, { recursive: true, force: true });
  }
});
