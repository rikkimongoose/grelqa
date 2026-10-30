// Общая серверная проверка настроек для Next config и server-only обёртки.
import path from "node:path";

export function authConfig() {
  const production = process.env.NODE_ENV === "production";
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET должен содержать не менее 32 случайных символов.");
  let url: URL;
  try { url = new URL(process.env.APP_URL ?? ""); } catch { throw new Error("Настройте APP_URL — адрес приложения."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash || (production && url.protocol !== "https:")) {
    throw new Error("APP_URL должен быть origin приложения; в production требуется HTTPS.");
  }
  const mode = process.env.MAIL_MODE;
  if (mode !== "local" && mode !== "smtp") throw new Error("Настройте MAIL_MODE=local или smtp.");
  if (mode === "local" && process.env.NODE_ENV !== "development") throw new Error("Локальная почта разрешена только в development.");
  const directory = path.resolve(/* turbopackIgnore: true */ process.env.MAIL_DIRECTORY || ".local/mail");
  const publicPath = path.resolve("public");
  if (directory === publicPath || directory.startsWith(publicPath + path.sep)) throw new Error("Письма нельзя сохранять в public.");
  const projectPath = path.resolve();
  const localPath = path.resolve(".local");
  if ((directory === projectPath || directory.startsWith(projectPath + path.sep)) && directory !== localPath && !directory.startsWith(localPath + path.sep)) throw new Error("Внутри проекта письма разрешено хранить только в игнорируемом каталоге .local.");
  const from = process.env.MAIL_FROM;
  const port = Number(process.env.SMTP_PORT);
  if (mode === "smtp" && (!process.env.SMTP_HOST || !from || !Number.isInteger(port) || port < 1 || port > 65535 || Boolean(process.env.SMTP_USER) !== Boolean(process.env.SMTP_PASSWORD))) {
    throw new Error("Для SMTP нужны SMTP_HOST, SMTP_PORT, MAIL_FROM и согласованные SMTP_USER/SMTP_PASSWORD.");
  }
  return { production, secret, origin: url.origin, mode, directory, from: from || "Grelqa <noreply@grelqa.example>", port };
}
