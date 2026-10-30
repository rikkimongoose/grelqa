import "server-only";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { authConfig } from "./config";

export async function sendAuthMail(to: string, purpose: "verify" | "reset", token: string) {
  const config = authConfig();
  // Fragment не отправляется серверу при GET и не попадает в access-логи.
  const url = `${config.origin}/${purpose === "verify" ? "confirm-email" : "reset-password"}#token=${token}`;
  const subject = purpose === "verify" ? "Подтвердите email в Grelqa" : "Сброс пароля Grelqa";
  const text = `${subject}\n\n${url}\n\nСсылка действует ${purpose === "verify" ? "24 часа" : "30 минут"}. Откройте её и подтвердите действие на странице. Если вы не запрашивали письмо, проигнорируйте его.`;
  if (config.mode === "local") {
    await mkdir(config.directory, { recursive: true, mode: 0o700 });
    const directory = await realpath(config.directory);
    const publicPath = path.resolve("public");
    if (directory === publicPath || directory.startsWith(publicPath + path.sep)) throw new Error("Небезопасный каталог писем.");
    const projectPath = path.resolve();
    const localPath = path.resolve(".local");
    if ((directory === projectPath || directory.startsWith(projectPath + path.sep)) && directory !== localPath && !directory.startsWith(localPath + path.sep)) throw new Error("Каталог писем внутри проекта должен быть в .local.");
    const filename = path.join(directory, `${Date.now()}-${randomUUID()}.json`);
    await writeFile(filename, JSON.stringify({ to, from: config.from, subject, text }, null, 2), { flag: "wx", mode: 0o600 });
    console.info(`Письмо Grelqa сохранено: ${filename}`);
  } else {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: config.port,
      secure: process.env.SMTP_SECURE === "true",
      requireTLS: config.production && process.env.SMTP_SECURE !== "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
      connectionTimeout: 10_000, socketTimeout: 15_000,
      logger: false, debug: false,
    });
    await transport.sendMail({ from: config.from, to, subject, text });
  }
}
