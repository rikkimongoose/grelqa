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
import { users, contests, ballots, ballotDrafts, firstRoundClosures } from "../src/db/schema";

test("финал в браузере: общий редактор, клавиатура/drag, добавление из чтения и независимость первого тура", { timeout: 180000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grelqa-final-browser-"));
  const listener = createServer(); listener.listen(0, "127.0.0.1"); await once(listener, "listening");
  const port = (listener.address() as { port: number }).port; await new Promise<void>((resolve) => listener.close(() => resolve()));
  const base = `http://127.0.0.1:${port}`, slug = "demo-final-voting";
  const env = { ...process.env, NODE_ENV: "development" as const, DATABASE_URL: `file:${path.join(directory, "test.db")}`, APP_URL: base, SITE_URL: base,
    SESSION_SECRET: "final-browser-secret-at-least-thirty-two-characters", MAIL_MODE: "local", MAIL_DIRECTORY: path.join(directory, "mail"), EXPORT_CACHE_DIRECTORY: path.join(directory, "exports") };
  const connection = await openDatabase(env.DATABASE_URL); const { db } = connection;
  let server: ReturnType<typeof spawn> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    for (const script of ["scripts/migrate.ts", "scripts/demo-final.ts"]) execFileSync(process.execPath, ["--import", "tsx", script], { env, stdio: "pipe" });
    const previous = { ballots: await db.select().from(ballots).where(eq(ballots.round, 1)), drafts: await db.select().from(ballotDrafts).where(eq(ballotDrafts.round, 1)), closures: await db.select().from(firstRoundClosures) };
    const password = "final-browser-only password 123"; await db.update(users).set({ passwordHash: await hash(password) }).where(eq(users.id, `${slug}-author-1`));
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
    await new Promise<void>((resolve, reject) => {
      let output = ""; const timer = setTimeout(() => reject(new Error(output)), 45000);
      const collect = (chunk: Buffer) => { output += chunk; if (output.includes("Ready")) { clearTimeout(timer); resolve(); } };
      server!.stdout!.on("data", collect); server!.stderr!.on("data", collect); server!.once("error", reject); server!.once("exit", () => { clearTimeout(timer); reject(new Error(output)); });
    });
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/snap/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const page = await browser.newPage(); page.setDefaultTimeout(15000);
    await page.goto(base + "/login"); await page.getByLabel("Email", { exact: true }).fill(`${slug}-1@grelqa.example`); await page.getByLabel("Пароль", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Войти", exact: true }).click(); await page.waitForURL(base + "/account");
    await page.getByRole("link", { name: "Мой финальный бюллетень →", exact: true }).click();
    const ballotUrl = `${base}/contests/${slug}/final-ballot`; await page.waitForURL(ballotUrl);
    await page.getByRole("heading", { name: "Мой финальный бюллетень", exact: true }).waitFor();
    const choices = page.locator(".ballot-choices > li"); assert.equal(await choices.count(), 0);
    const add = async (n: number) => {
      const row = page.locator(".story-list > li").filter({ hasText: `История ${String(n).padStart(2, "0")}` });
      await row.getByRole("button", { name: /^Добавить/ }).focus(); await page.keyboard.press("Enter");
    };
    const message = (value: string) => page.waitForFunction((text) => [...document.querySelectorAll('[role="status"]')].some((node) => node.textContent?.includes(text)), value);
    await add(2); await add(3);
    await page.getByRole("button", { name: "Ниже: История 02", exact: true }).click();
    assert.equal(await choices.nth(0).getAttribute("data-story-id"), `${slug}-story-3`);
    await choices.nth(0).dragTo(choices.nth(1));
    assert.equal(await choices.nth(0).getAttribute("data-story-id"), `${slug}-story-2`);
    await page.getByRole("button", { name: "Сохранить черновик", exact: true }).click(); await message("Черновик сохранён"); await page.reload();
    assert.equal(await choices.count(), 2);
    for (const n of [7, 11, 12, 13]) await add(n);
    await page.getByRole("button", { name: "Отправить бюллетень", exact: true }).click(); await message("отправлен и засчитан");
    await page.goto(`${base}/contests/${slug}/stories/${slug}-story-15`);
    await page.getByRole("button", { name: "Добавить в мой бюллетень", exact: true }).click(); await message("Выбрано шесть работ");
    await page.getByRole("link", { name: "Открыть мой бюллетень →", exact: true }).click(); await page.waitForURL(ballotUrl); await choices.first().waitFor();
    await page.getByRole("button", { name: "Убрать: История 02", exact: true }).click();
    await page.getByRole("button", { name: "Сохранить черновик", exact: true }).click(); await message("Черновик сохранён");
    await page.goto(`${base}/contests/${slug}/stories/${slug}-story-15`);
    await page.getByRole("button", { name: "Добавить в мой бюллетень", exact: true }).click(); await message("Черновик сохранён");
    await page.getByRole("link", { name: "Открыть мой бюллетень →", exact: true }).click(); await page.waitForURL(ballotUrl); await choices.first().waitFor();
    assert.equal(await choices.count(), 6); assert.ok(await choices.filter({ hasText: "История 15" }).count());
    assert.equal(await page.locator('#submitted-title').locator('..').locator('ol > li').count(), 6);
    assert.equal(await page.locator('#submitted-title').locator('..').getByText("История 02", { exact: true }).count(), 1, "добавление меняет только финальный черновик");
    await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await db.update(contests).set({ endsAt: new Date(Date.now() - 1) }).where(eq(contests.id, slug));
    await page.getByRole("button", { name: "Отправить бюллетень", exact: true }).click(); await message("срок голосования истёк"); assert.equal(await choices.count(), 6);
    await page.reload(); assert.equal(await page.getByRole("button", { name: "Отправить бюллетень", exact: true }).count(), 0);
    assert.deepEqual(await db.select().from(ballots).where(eq(ballots.round, 1)), previous.ballots);
    assert.deepEqual(await db.select().from(ballotDrafts).where(eq(ballotDrafts.round, 1)), previous.drafts);
    assert.deepEqual(await db.select().from(firstRoundClosures), previous.closures);
  } finally {
    await browser?.close();
    if (server && server.exitCode === null && server.signalCode === null) { const exit = once(server, "exit"); server.kill("SIGTERM"); await exit; }
    connection.client.close(); await rm(directory, { recursive: true, force: true });
  }
});
