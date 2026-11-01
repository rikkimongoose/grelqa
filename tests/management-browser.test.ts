import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import os from "node:os";
import { test } from "node:test";
import { hash } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { chromium } from "playwright-core";
import { openDatabase } from "../src/db/connection";
import { users } from "../src/db/schema";
test("управление в браузере: ссылка, анонимный ввод темы, публикация, модерация и телефон", { timeout: 180000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grelqa-management-browser-"));
  const listener = createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening"); const port = (listener.address() as { port: number }).port; await new Promise<void>((resolve) => listener.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, NODE_ENV: "development" as const, DATABASE_URL: `file:${path.join(directory, "test.db")}`, APP_URL: base, SITE_URL: base, SESSION_SECRET: "management-browser-secret-at-least-thirty-two-characters", MAIL_MODE: "local", MAIL_DIRECTORY: path.join(directory, "mail"), EXPORT_CACHE_DIRECTORY: path.join(directory, "exports") };
  const connection = await openDatabase(env.DATABASE_URL); let server: ReturnType<typeof spawn> | undefined; let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    for (const script of ["scripts/migrate.ts", "scripts/demo-management.ts"]) execFileSync(process.execPath, ["--import", "tsx", script], { env, stdio: "pipe" });
    const password = "management-browser-only password 123"; await connection.db.update(users).set({ passwordHash: await hash(password) }).where(eq(users.id, "demo-management-owner"));
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
    await new Promise<void>((resolve, reject) => { let output = ""; const timer = setTimeout(() => reject(new Error(output)), 45000); const collect = (b: Buffer) => { output += b; if (output.includes("Ready")) { clearTimeout(timer); resolve(); } }; server!.stdout!.on("data", collect); server!.stderr!.on("data", collect); server!.once("error", reject); server!.once("exit", () => { clearTimeout(timer); reject(new Error(output)); }); });
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/snap/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const page = await browser.newPage(); page.setDefaultTimeout(15000);
    await page.goto(base + "/login"); await page.getByLabel("Email", { exact: true }).fill("management-owner@grelqa.example"); await page.getByLabel("Пароль", { exact: true }).fill(password); await page.getByRole("button", { name: "Войти", exact: true }).click(); await page.waitForURL(base + "/account");
    await page.goto(base + "/manage/demo-management-draft");
    await page.getByRole("button", { name: "Выдать новую одноразовую ссылку" }).click();
    const input = page.getByLabel("Скопируйте секретную ссылку"); await input.waitFor(); const link = await input.inputValue(); assert.match(link, /#token=/);
    const anon = await browser.newContext(); const theme = await anon.newPage(); await theme.goto(link);
    await theme.getByLabel("Тема", { exact: true }).fill("БРАУЗЕРНАЯ СКРЫТАЯ ТЕМА"); await theme.getByLabel("Дополнительные условия, по одному на строку").fill("Условие 1\nУсловие 2"); await theme.getByRole("button", { name: "Передать тему" }).click(); await theme.getByText(/Тема принята/).waitFor(); assert.equal(new URL(theme.url()).hash, "");
    await page.reload(); assert.doesNotMatch(await page.locator("main").innerText(), /БРАУЗЕРНАЯ СКРЫТАЯ ТЕМА/);
    const publication = page.locator("form").filter({ has: page.getByRole("button", { name: "Опубликовать подготовку", exact: true }) });
    await publication.getByRole("checkbox").check(); await publication.getByRole("button", { name: "Опубликовать подготовку", exact: true }).click(); await publication.getByText(/Действие выполнено/).waitFor(); await page.reload(); assert.equal(await page.getByRole("button", { name: "Сохранить настройки" }).count(), 0);
    await page.goto(base + "/manage/demo-management-moderation");
    for (let n = 1; n <= 3; n++) {
      const story = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: `Репортаж ${n}` }) }); await story.locator("summary").click();
      await story.getByLabel("Решение", { exact: true }).selectOption(n === 3 ? "reject" : "admit"); await story.getByLabel("Причина", { exact: true }).fill("Проверено в браузере"); await story.getByRole("checkbox").check(); await story.getByRole("button", { name: "Сохранить решение", exact: true }).click(); await story.getByText(/Решение сохранено/).waitFor();
    }
    await page.reload(); const formation = page.locator("form").filter({ has: page.getByRole("button", { name: "Сформировать группы", exact: true }) }); await formation.getByRole("checkbox").check(); await formation.getByRole("button", { name: "Сформировать группы", exact: true }).click(); await formation.getByText(/Группы сформированы и опубликованы/).waitFor(); await page.reload();
    await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.goto(base + "/contests/demo-management-moderation"); await page.getByRole("link", { name: "Читать «Репортаж 1»" }).waitFor(); assert.doesNotMatch(await page.locator("main").innerText(), /Демонстрационный author|management-author/);
    await anon.close();
  } finally {
    await browser?.close(); if (server && server.exitCode === null && server.signalCode === null) { const exit = once(server, "exit"); server.kill("SIGTERM"); await exit; } connection.client.close(); await rm(directory, { recursive: true, force: true });
  }
});
