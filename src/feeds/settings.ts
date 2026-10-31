// Independent from authentication settings: a feed never reads a session or sends mail.
export function feedSiteUrl() {
  const value = process.env.SITE_URL?.trim() || (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "");
  if (!value) throw new Error("Для лент настройте SITE_URL.");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("SITE_URL должен содержать только HTTP(S) origin сайта.");
  }
  return url.origin;
}
