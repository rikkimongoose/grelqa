import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { hash } from "@node-rs/argon2";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/db/connection";
import { contests, users } from "../src/db/schema";

test("браузер: клавиатура, перестановка, drag/drop, мобильный экран и выбор со страницы чтения", { timeout: 180000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grelqa-voting-browser-"));
  const portServer = createServer(); portServer.listen(0, "127.0.0.1"); await once(portServer, "listening");
  const port = (portServer.address() as { port: number }).port; await new Promise<void>((resolve) => portServer.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, NODE_ENV: "development" as const, DATABASE_URL: `file:${path.join(directory, "test.db")}`, APP_URL: base, SITE_URL: base,
    SESSION_SECRET: "voting-browser-secret-at-least-thirty-two-characters", MAIL_MODE: "local", MAIL_DIRECTORY: path.join(directory, "mail"), EXPORT_CACHE_DIRECTORY: path.join(directory, "exports") };
  let server: ReturnType<typeof spawn> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const connection = await openDatabase(env.DATABASE_URL);
  try {
    for (const script of ["scripts/migrate.ts", "scripts/demo-voting.ts"]) execFileSync(process.execPath, ["--import", "tsx", script], { env, stdio: "pipe" });
    const password = "voting-browser password 123";
    await connection.db.update(users).set({ passwordHash: await hash(password) }).where(eq(users.id, "demo-vote-author-1"));
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
    await new Promise<void>((resolve, reject) => {
      let output = ""; const timer = setTimeout(() => reject(new Error(output)), 45000);
      const collect = (chunk: Buffer) => { output += chunk; if (output.includes("Ready")) { clearTimeout(timer); resolve(); } };
      server!.stdout!.on("data", collect); server!.stderr!.on("data", collect); server!.once("error", reject); server!.once("exit", () => { clearTimeout(timer); reject(new Error(output)); });
    });
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/snap/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const page = await browser.newPage(); page.setDefaultTimeout(15000);
    const slug = "demo-first-round-voting";
    const ballotUrl = `${base}/contests/${slug}/ballot`;
    await page.goto(base + "/login");
    await page.getByLabel("Email", { exact: true }).fill("voting-reader-1@grelqa.example");
    await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.waitForURL(base + "/account");
    await page.getByRole("link", { name: "Мой бюллетень →", exact: true }).click();
    await page.waitForURL(ballotUrl);
    const choices = page.locator(".ballot-choices > li");
    const order = () => choices.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-story-id")));
    const add = async (n: number) => {
      const row = page.locator(".story-list > li").filter({ hasText: `Рассказ ${String(n).padStart(2, "0")}` });
      const button = row.getByRole("button", { name: /^Добавить/ }); await button.focus(); await button.press("Enter");
    };
    const message = (part: string) => page.waitForFunction((text) => [...document.querySelectorAll('[role="status"]')].some((node) => node.textContent?.includes(text)), part);
    await add(2); await add(3); await add(4);
    assert.deepEqual(await order(), [2, 3, 4].map((n) => `demo-vote-story-${n}`));
    await page.getByRole("button", { name: "Ниже: Рассказ 02", exact: true }).focus();
    await page.keyboard.press("Enter");
    assert.deepEqual(await order(), [3, 2, 4].map((n) => `demo-vote-story-${n}`));
    await page.getByRole("button", { name: "Выше: Рассказ 04", exact: true }).click();
    assert.deepEqual(await order(), [3, 4, 2].map((n) => `demo-vote-story-${n}`));
    await choices.nth(0).dragTo(choices.nth(2));
    assert.deepEqual(await order(), [4, 2, 3].map((n) => `demo-vote-story-${n}`));
    await page.getByRole("button", { name: "Сохранить черновик", exact: true }).click(); await message("Черновик сохранён");
    await page.reload(); assert.deepEqual(await order(), [4, 2, 3].map((n) => `demo-vote-story-${n}`));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Убрать: Рассказ 04", exact: true }).click();
    assert.equal(await choices.count(), 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    // An internal navigation with unsaved changes must request confirmation and can be cancelled.
    page.once("dialog", (dialog) => { void dialog.dismiss(); });
    await page.getByRole("link", { name: "← К назначенной группе", exact: true }).click();
    assert.equal(page.url(), ballotUrl);
    while (await choices.count()) await choices.nth(0).getByRole("button", { name: /^Убрать:/ }).click();
    await page.getByRole("button", { name: "Сохранить черновик", exact: true }).click(); await message("Черновик сохранён");
    await page.goto(`${base}/contests/${slug}/stories/demo-vote-story-2`);
    await page.getByRole("button", { name: "Добавить в мой бюллетень", exact: true }).click(); await message("Черновик сохранён");
    await page.getByRole("button", { name: "Добавить в мой бюллетень", exact: true }).click(); await message("Черновик сохранён");
    await page.getByRole("link", { name: "Открыть мой бюллетень →", exact: true }).click();
    await page.waitForURL(ballotUrl); await choices.first().waitFor();
    assert.equal(await choices.count(), 1);
    for (let n = 3; n <= 7; n++) await add(n);
    await page.getByRole("button", { name: "Отправить бюллетень", exact: true }).click(); await message("отправлен и засчитан");
    await page.waitForFunction(() => document.querySelector('#submitted-title')?.parentElement?.textContent?.includes("Последняя успешная отправка"));
    await page.getByRole("button", { name: "Убрать: Рассказ 02", exact: true }).click();
    await page.getByRole("button", { name: "Сохранить черновик", exact: true }).click(); await message("Черновик сохранён");
    assert.equal(await page.locator('#submitted-title').locator('..').locator('ol > li').count(), 6);
    assert.equal(await choices.count(), 5);
    // A previously opened form keeps its selection when the trusted server rejects a late request.
    await connection.db.update(contests).set({ roundTwoStartAt: new Date(Date.now() - 1) }).where(eq(contests.slug, slug));
    await page.getByRole("button", { name: "Отправить бюллетень", exact: true }).click(); await message("срок голосования истёк");
    assert.equal(await choices.count(), 5);
    await page.reload();
    assert.equal(await page.getByRole("button", { name: "Отправить бюллетень", exact: true }).count(), 0);
    assert.equal(await choices.count(), 5);
  } finally {
    await browser?.close();
    if (server && server.exitCode === null && server.signalCode === null) { const exit = once(server, "exit"); server.kill("SIGTERM"); await exit; }
    connection.client.close(); await rm(directory, { recursive: true, force: true });
  }
});
