import "server-only";
import { getContestFeed } from "./data";
import { serializeRss } from "./rss";
import { serializeAtom } from "./atom";

export async function feedResponse(format: "rss" | "atom") {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  try {
    const feed = await getContestFeed();
    return new Response(format === "rss" ? serializeRss(feed) : serializeAtom(feed), {
      headers: { ...headers, "Content-Type": `application/${format === "rss" ? "rss" : "atom"}+xml; charset=utf-8` },
    });
  } catch {
    // Do not expose SQL, environment values or authentication configuration.
    return new Response("Лента временно недоступна. Проверьте подключение к базе и настройку SITE_URL.", {
      status: 503, headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
