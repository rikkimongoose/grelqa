import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { authTokens, authSessions, users } from "../src/db/schema";
import { openDatabase } from "../src/db/connection";

test("регистрация, письма, одноразовые токены, cookie, CSRF, кабинет, сброс и отзыв сессий", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grelqa-auth-test-"));
  const originalEnv = { ...process.env };
  const env = { ...process.env, DATABASE_URL: `file:${path.join(directory, "auth.db")}`,
    SESSION_SECRET: randomBytes(48).toString("base64url"), APP_URL: "https://grelqa.test",
    MAIL_MODE: "smtp", SMTP_HOST: "127.0.0.1", SMTP_PORT: "9", SMTP_SECURE: "false", MAIL_FROM: "test@grelqa.test",
    SMTP_USER: "", SMTP_PASSWORD: "" };
  let server: ReturnType<typeof spawn> | undefined;
  let connection: Awaited<ReturnType<typeof openDatabase>> | undefined;
  let serviceConnection: Awaited<ReturnType<typeof openDatabase>> | undefined;
  try {
    execFileSync(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], { env, stdio: "pipe" });
    connection = await openDatabase(env.DATABASE_URL);
    const { db } = connection;
    Object.assign(process.env, env, { NODE_ENV: "development", MAIL_MODE: "local", MAIL_DIRECTORY: path.join(directory, "mail") });
    const service = await import("../src/auth/service");
    const { authConfig } = await import("../src/auth/config");
    const { sendAuthMail } = await import("../src/auth/mail");
    const { getDatabase } = await import("../src/db");
    serviceConnection = await getDatabase();
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "0"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const base = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Сервер не запустился: ${output}`)), 30_000);
      const collect = (chunk: Buffer) => {
        output += chunk.toString();
        const url = output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
        if (url && output.includes("Ready")) { clearTimeout(timer); resolve(url); }
      };
      server!.stdout!.on("data", collect); server!.stderr!.on("data", collect);
      server!.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Сервер завершился: ${code} ${output}`)); });
      server!.once("error", (error) => { clearTimeout(timer); reject(error); });
    });
    const post = (action: string, data: unknown, cookie = "", origin = env.APP_URL) => fetch(`${base}/api/account/${action}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(data), redirect: "manual" });
    const get = (route: string, cookie = "") => fetch(base + route, { headers: { Cookie: cookie, "User-Agent": "Twitterbot" }, redirect: "manual" });
    const cookie = (response: Response) => {
      const value = response.headers.get("set-cookie") || "";
      assert.match(value, /HttpOnly/i); assert.match(value, /SameSite=Lax/i); assert.match(value, /Secure/i); assert.match(value, /Path=\//i);
      return value.split(";")[0];
    };
    assert.equal((await get("/account")).headers.get("location"), "/login");
    assert.equal((await post("register", {}, "", "https://evil.test")).status, 403);
    assert.equal((await post("register", {}, "", "")).status, 403);
    const password = "a long starting password 42";
    assert.equal((await post("register", { email: "reader@example.test", password, repeatPassword: "different" })).status, 400);
    const registered = await post("register", { email: "  Reader@Example.TEST ", password, repeatPassword: password });
    assert.equal(registered.status, 200);
    const sessionOne = cookie(registered);
    assert.equal((await registered.json()).redirect, "/registration-status?delivery=failed");
    const [user] = await db.select().from(users);
    assert.equal(user.email, "reader@example.test"); assert.match(user.passwordHash, /^\$argon2id\$/); assert.ok(!user.passwordHash.includes(password));
    assert.equal((await post("register", { email: "READER@example.test", password, repeatPassword: password })).status, 409);
    assert.equal((await get("/account", sessionOne)).headers.get("location"), "/registration-status");
    assert.match(await (await get("/registration-status", sessionOne)).text(), /Проверьте почту/);
    const firstLogin = await post("login", { email: " READER@EXAMPLE.TEST ", password });
    assert.equal(firstLogin.status, 200);
    const sessionTwo = cookie(firstLogin);
    assert.equal((await firstLogin.json()).redirect, "/registration-status");
    const localToken = async (purpose: "verify" | "reset") => {
      await service.issueMail(user.id, purpose);
      const files = (await readdir(path.join(directory, "mail"))).sort();
      const mail = JSON.parse(await readFile(path.join(directory, "mail", files.at(-1)!), "utf8"));
      assert.equal(mail.to, user.email); assert.ok(!mail.text.includes(password));
      const url = new URL(mail.text.match(/https:\/\/\S+/)[0]);
      assert.equal(url.origin, env.APP_URL); assert.equal(url.search, "");
      return new URLSearchParams(url.hash.slice(1)).get("token")!;
    };
    const expiredVerify = await localToken("verify");
    await db.update(authTokens).set({ expiresAt: new Date(0) }).where(eq(authTokens.tokenHash, service.tokenHash("verify", expiredVerify)));
    const expiredResponse = await post("verify", { token: expiredVerify });
    assert.equal(expiredResponse.status, 400); assert.match((await expiredResponse.json()).message, /истёк/);
    const verifyToken = await localToken("verify");
    const tokens = await db.select().from(authTokens);
    assert.ok(!JSON.stringify(tokens).includes(verifyToken)); assert.ok(tokens.every((token) => token.tokenHash.length === 64));
    assert.equal((await post("verify", { token: "incorrect" })).status, 400);
    assert.equal((await post("reset", { token: verifyToken, password, repeatPassword: password })).status, 400);
    // Конкурирующие запросы: токен может быть израсходован только одним.
    const concurrent = await Promise.all([post("verify", { token: verifyToken }), post("verify", { token: verifyToken })]);
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 400]);
    assert.match((await (await post("verify", { token: verifyToken })).json()).message, /уже использована/);
    assert.equal((await get("/account", sessionOne)).status, 200);
    assert.equal((await get("/account", sessionOne)).status, 200, "сессия сохраняется после обновления");
    const logout = await fetch(`${base}/api/account/logout`, { method: "POST", headers: { Origin: env.APP_URL, "Content-Type": "application/x-www-form-urlencoded", Cookie: sessionTwo }, body: "", redirect: "manual" });
    assert.equal(logout.status, 303);
    assert.equal(logout.headers.get("location"), `${env.APP_URL}/`);
    assert.equal((await get("/account", sessionTwo)).headers.get("location"), "/login", "украденная старая cookie после выхода не действует");
    assert.equal((await get("/account", sessionOne)).status, 200, "выход не отзывает другое устройство");
    const loginThree = await post("login", { email: user.email, password });
    const sessionThree = cookie(loginThree);
    // Реальное истечение сессии проверяется на сервере, а не только в браузере.
    const sessions = await db.select().from(authSessions);
    await db.update(authSessions).set({ expiresAt: new Date(0) });
    assert.equal((await get("/account", sessionThree)).headers.get("location"), "/login");
    for (const row of sessions) await db.update(authSessions).set({ expiresAt: row.expiresAt }).where(eq(authSessions.tokenHash, row.tokenHash));
    const newSession = cookie(await post("login", { email: user.email, password }));
    const knownReset = await post("forgot", { email: user.email });
    const unknownReset = await post("forgot", { email: "nobody@example.test" });
    assert.equal(knownReset.status, unknownReset.status); assert.deepEqual(await knownReset.json(), await unknownReset.json());
    const expiredReset = await localToken("reset");
    await db.update(authTokens).set({ expiresAt: new Date(0) }).where(eq(authTokens.tokenHash, service.tokenHash("reset", expiredReset)));
    const newPassword = "a different long password 73";
    const resetData = { password: newPassword, repeatPassword: newPassword };
    const expiredResetResponse = await post("reset", { token: expiredReset, ...resetData });
    assert.match((await expiredResetResponse.json()).message, /истёк/);
    const resetToken = await localToken("reset");
    const sibling = randomBytes(32).toString("base64url");
    await db.insert(authTokens).values({ tokenHash: service.tokenHash("reset", sibling), userId: user.id, purpose: "reset", createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
    assert.equal((await post("reset", { token: resetToken, password: newPassword, repeatPassword: "wrong" })).status, 400);
    assert.equal((await post("reset", { token: resetToken, ...resetData })).status, 200);
    assert.equal((await post("reset", { token: resetToken, ...resetData })).status, 400);
    assert.equal((await post("reset", { token: sibling, ...resetData })).status, 400);
    assert.equal((await db.select().from(authSessions)).length, 0);
    for (const old of [sessionOne, sessionThree, newSession]) assert.equal((await get("/account", old)).headers.get("location"), "/login");
    assert.equal((await post("login", { email: user.email, password })).status, 401);
    const changedLogin = await post("login", { email: user.email, password: newPassword });
    assert.equal(changedLogin.status, 200);
    assert.equal((await get("/account", cookie(changedLogin))).status, 200);
    assert.equal((await post("login", { email: user.email, password: newPassword })).status, 429);
    await assert.rejects(() => service.issueMail(user.id, "reset"), /Слишком много/);
    assert.equal((await post("resend", {})).status, 401);
    const content = await (await get("/login")).text();
    assert.doesNotMatch(content, /passwordHash|\$argon2|token_hash/);
    assert.ok(!output.includes(verifyToken) && !output.includes(resetToken) && !output.includes(password));
    // Production никогда не разрешает файловую почту и требует SMTP-настройки.
    Object.assign(process.env, { NODE_ENV: "production", MAIL_MODE: "local" });
    assert.throws(() => authConfig(), /только в development/);
    assert.throws(() => execFileSync(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "0"], { env: { ...env, MAIL_MODE: "local" }, stdio: "pipe", timeout: 10_000 }), (error: unknown) => {
      const result = error as { status: number; stderr: Buffer };
      assert.equal(result.status, 1);
      assert.match(result.stderr.toString(), /только в development/);
      return true;
    });
    process.env.MAIL_MODE = "smtp"; delete process.env.SMTP_HOST;
    assert.throws(() => authConfig(), /SMTP/);
    Object.assign(process.env, { NODE_ENV: "development", MAIL_MODE: "local", MAIL_DIRECTORY: path.join(directory, "mail") });
    await sendAuthMail("other@example.test", "verify", "test-only-local-token");
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) { const exited = once(server, "exit"); server.kill("SIGTERM"); await exited; }
    connection?.client.close(); serviceConnection?.client.close();
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    await rm(directory, { recursive: true, force: true });
  }
});
