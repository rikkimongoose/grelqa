import type { ContestFeed } from "./data";
import { declaration, xml } from "./xml";

export function serializeAtom(feed: ContestFeed) {
  // Atom requires updated even for an empty feed. Epoch is a documented sentinel, never request time.
  const updated = feed.updated ?? new Date(0);
  return declaration + `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="ru">
<id>${xml(feed.siteUrl + "/atom.xml")}</id><title type="text">${xml(feed.title)}</title><updated>${updated.toISOString()}</updated>
<author><name>Рваная Грелка</name></author>
<link href="${xml(feed.siteUrl + "/")}" rel="alternate" type="text/html"/>
<link href="${xml(feed.siteUrl + "/atom.xml")}" rel="self" type="application/atom+xml"/>
${feed.entries.map((entry) => `<entry><id>${xml(entry.id)}</id><title type="text">${xml(entry.title)}</title>
<link href="${xml(entry.url)}" rel="alternate" type="text/html"/>
<published>${entry.published.toISOString()}</published><updated>${entry.updated.toISOString()}</updated>
<summary type="text">${xml(entry.summary)}</summary></entry>`).join("\n")}
</feed>\n`;
}
