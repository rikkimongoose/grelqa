import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/db/connection";
import { contests, stories, storyRounds, contestGroups } from "../src/db/schema";

test("собранные страницы читают SQLite и не раскрывают приватные данные", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grelqa-pages-test-"));
  const env = { ...process.env, DATABASE_URL: `file:${path.join(directory, "pages.db")}`,
    SESSION_SECRET: "public-pages-test-secret-with-at-least-32-characters", APP_URL: "https://grelqa.test",
    MAIL_MODE: "smtp", SMTP_HOST: "127.0.0.1", SMTP_PORT: "9", MAIL_FROM: "test@grelqa.test" };
  let server: ReturnType<typeof spawn> | undefined;
  try {
    for (const script of ["scripts/migrate.ts", "scripts/seed.ts"]) {
      execFileSync(process.execPath, ["--import", "tsx", script], { env, stdio: "pipe" });
    }
    const { db, client } = await openDatabase(env.DATABASE_URL);
    try {
      await db.update(contests).set({ title: "Проверка: название из SQLite" }).where(eq(contests.slug, "letters-to-november"));
      const [sample] = await db.select().from(stories).where(eq(stories.id, "demo-city-story-1"));
      const past = new Date("2020-01-01T12:00:00Z");
      await db.update(stories).set({ content: [
        { type: "paragraph", children: [{ text: "Первый абзац", italic: true }] },
        { type: "paragraph", children: [{ text: "Второй абзац", bold: true, italic: true }, { text: '<script>alert("xss")</script><img src=x onerror=alert(1)>' }] },
      ] }).where(eq(stories.id, sample.id));
      for (const status of ["draft", "submitted", "rejected", "withdrawn"] as const) {
        await db.insert(stories).values({ ...sample, id: `hidden-${status}`, title: `СКРЫТЫЙ ЗАГОЛОВОК ${status}`, status,
          content: [{ type: "paragraph", children: [{ text: "СКРЫТЫЙ ТЕКСТ" }] }],
          withdrawnAt: status === "withdrawn" ? past : null, withdrawalReason: status === "withdrawn" ? "Тест" : null });
      }
      for (const [id, publishedAt] of [["hidden-unpublished", null], ["hidden-future", new Date("2099-01-01")]] as const) {
        await db.insert(stories).values({ ...sample, id, title: "СКРЫТЫЙ ЗАГОЛОВОК", publishedAt });
      }
      await db.insert(stories).values({ ...sample, id: "hidden-round-withdrawn", title: "СКРЫТЫЙ ЗАГОЛОВОК" });
      await db.insert(storyRounds).values({ storyId: "hidden-round-withdrawn", contestId: sample.contestId, round: 1, groupId: "demo-city-group-1", status: "withdrawn", withdrawnAt: past, withdrawalReason: "Тест" });
      await db.insert(stories).values({ ...sample, id: "public-ungrouped", title: "Публичный рассказ без группы", length: 123, lengthAlgorithm: "test-stored-value" });
      await db.insert(contestGroups).values({ id: "test-group-2", contestId: sample.contestId, round: 1, number: 2, capacity: 20, publishedAt: past });
      await db.insert(stories).values({ ...sample, id: "public-second-group", title: "Вторая группа" });
      await db.insert(storyRounds).values({ storyId: "public-second-group", contestId: sample.contestId, round: 1, groupId: "test-group-2" });
    } finally { client.close(); }
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "0"], { env, stdio: ["ignore", "pipe", "pipe"] });
    const baseUrl = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error(`Сервер не запустился: ${output}`)), 30_000);
      server!.once("error", (error) => { clearTimeout(timer); reject(error); });
      server!.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Сервер завершился (${code}): ${output}`)); });
      const collect = (chunk: Buffer) => {
        output += chunk.toString();
        const url = output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
        if (url && output.includes("Ready")) { clearTimeout(timer); resolve(url); }
      };
      server!.stdout!.on("data", collect);
      server!.stderr!.on("data", collect);
    });
    for (const route of ["/", "/contests/letters-to-november", "/contests/city-between-lines", "/contests/winter-notebook", "/contests/city-between-lines/stories/demo-city-story-1"]) {
      for (const rsc of [false, true]) {
        const response = await fetch(baseUrl + route, { headers: rsc ? { RSC: "1" } : {} });
        assert.equal(response.status, 200, route);
        const body = await response.text();
        assert.doesNotMatch(body, /СЕКРЕТ|СКРЫТЫЙ|grelqa\.example|password_hash|passwordHash|demo-user-|demo-city-participant-/);
        assert.doesNotMatch(body, /<form[\s>]/);
        if (route === "/" || route === "/contests/letters-to-november") assert.match(body, /Проверка: название из SQLite/);
        if (route === "/contests/winter-notebook") assert.match(body, /Пока между строк/);
        if (route === "/contests/city-between-lines") {
          assert.match(body, /Переулок забытых часов/);
          assert.match(body, /Первый тур · Группа 1/);
          assert.match(body, /Первый тур · Группа 2/);
          assert.match(body, /Публичный рассказ без группы/);
          assert.match(body, /123 знаков с пробелами/);
          assert.match(body, /\/contests\/city-between-lines\/stories\/demo-city-story-1/);
        }
        if (route === "/contests/letters-to-november") assert.match(body, /Пока нет доступных для чтения рассказов/);
        if (route.includes("/stories/") && !rsc) {
          assert.match(body, /<em>Первый абзац<\/em>/);
          assert.match(body, /<strong><em>Второй абзац<\/em><\/strong>/);
          assert.match(body, /&lt;script&gt;/);
          assert.doesNotMatch(body, /<script>alert|<img src=x/);
          assert.match(body, /К рассказам конкурса/);
        }
      }
    }
    const unavailable = ["unknown", "hidden-draft", "hidden-submitted", "hidden-rejected", "hidden-withdrawn", "hidden-unpublished", "hidden-future", "hidden-round-withdrawn"];
    for (const route of ["/unknown", "/contests/unknown", "/contests/winter-notebook/stories/demo-city-story-1", ...unavailable.map((id) => `/contests/city-between-lines/stories/${id}`)]) {
      const response = await fetch(baseUrl + route);
      // Динамический рендеринг может начать поток до notFound; проверяем сам экран.
      const body = await response.text();
      assert.match(body, /Этот лист пока пуст/);
      assert.ok(response.status === 404 || response.status === 200);
      assert.match(body, /noindex/);
      assert.doesNotMatch(body, /СКРЫТЫЙ|Переулок забытых часов|Первый абзац|grelqa\.example|demo-user-/);
    }
    // Доступ по прямой ссылке закрывается и при изменении этапа конкурса.
    const stageConnection = await openDatabase(env.DATABASE_URL);
    try {
      for (const stage of ["preparation", "submissions", "moderation", "failed"] as const) {
        await stageConnection.db.update(contests).set({ stage, failureReason: stage === "failed" ? "Тест" : null }).where(eq(contests.slug, "city-between-lines"));
        for (const rsc of [false, true]) {
          const response = await fetch(baseUrl + "/contests/city-between-lines/stories/demo-city-story-1", { headers: rsc ? { RSC: "1" } : {} });
          const body = await response.text();
          assert.doesNotMatch(body, /Переулок забытых часов|Первый абзац|<script>alert/);
          assert.match(body, rsc ? /404/ : /Этот лист пока пуст/);
        }
      }
    } finally { stageConnection.client.close(); }
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = once(server, "exit");
      server.kill("SIGTERM");
      await exited;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
