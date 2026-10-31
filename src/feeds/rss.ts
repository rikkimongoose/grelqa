import type { ContestFeed } from "./data";
import { declaration, xml } from "./xml";

export function serializeRss(feed: ContestFeed) {
  return declaration + `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${xml(feed.title)}</title><link>${xml(feed.siteUrl + "/")}</link>
<description>Последние публичные объявления литературных конкурсов.</description><language>ru</language>
<atom:link href="${xml(feed.siteUrl + "/rss.xml")}" rel="self" type="application/rss+xml"/>
${feed.updated ? `<lastBuildDate>${feed.updated.toUTCString()}</lastBuildDate>` : ""}
${feed.entries.map((entry) => `<item><title>${xml(entry.title)}</title><link>${xml(entry.url)}</link>
<guid isPermaLink="false">${xml(entry.id)}</guid><pubDate>${entry.published.toUTCString()}</pubDate>
<description>${xml(xml(entry.summary))}</description></item>`).join("\n")}
</channel></rss>\n`;
}
