import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { SaxesParser } from "saxes";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/db/connection";
import { contests, contestThemes, users } from "../src/db/schema";
import { feedSiteUrl } from "../src/feeds/settings";

const ATOM = "http://www.w3.org/2005/Atom";
type Element = { name: string; uri: string; text: string; attrs: Record<string, string>; children: Element[] };
function parseXml(source: string) {
  const parser = new SaxesParser({ xmlns: true });
  const stack: Element[] = [];
  let root: Element | undefined;
  parser.on("error", (error) => { throw error; });
  parser.on("opentag", (tag) => {
    const element: Element = { name: tag.local, uri: tag.uri, text: "", children: [], attrs: Object.fromEntries(Object.entries(tag.attributes).map(([key, attr]) => [key, attr.value])) };
    if (stack.length) stack[stack.length - 1].children.push(element); else root = element;
    stack.push(element);
  });
  parser.on("text", (text) => { if (stack.length) stack[stack.length - 1].text += text; });
  parser.on("closetag", () => { stack.pop(); });
  parser.write(source).close();
  assert.ok(root); return root;
}
const children = (node: Element, name: string) => node.children.filter((item) => item.name === name);
function child(node: Element, name: string) { const found = children(node, name); assert.equal(found.length, 1, name); return found[0]; }
const text = (node: Element, name: string) => child(node, name).text;

test("SITE_URL: localhost, реальный домен и отказ неверной конфигурации", () => {
  const original = { site: process.env.SITE_URL, mode: process.env.NODE_ENV };
  try {
    Object.assign(process.env, { NODE_ENV: "development", SITE_URL: "" });
    assert.equal(feedSiteUrl(), "http://localhost:3000");
    process.env.SITE_URL = "http://localhost:4567/"; assert.equal(feedSiteUrl(), "http://localhost:4567");
    process.env.SITE_URL = "https://литература.example/"; assert.match(feedSiteUrl(), /^https:\/\/xn--/);
    Object.assign(process.env, { NODE_ENV: "production", SITE_URL: "" }); assert.throws(feedSiteUrl);
    for (const invalid of ["ftp://example.org", "https://user:password@example.org", "https://example.org/path", "https://example.org?x=1", "https://example.org#x", "not a url"]) {
      process.env.SITE_URL = invalid; assert.throws(feedSiteUrl);
    }
  } finally {
    for (const [key, value] of [["SITE_URL", original.site], ["NODE_ENV", original.mode]]) {
      if (value === undefined) Reflect.deleteProperty(process.env, key!); else process.env[key!] = value;
    }
  }
});

test("RSS/Atom: XML, пустая база, публичность, порядок, даты, URL и постоянные ID", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grelqa-feeds-test-"));
  const env = { ...process.env, DATABASE_URL: `file:${path.join(directory, "test.db")}`, SITE_URL: "https://feeds.grelqa.test",
    SESSION_SECRET: "feeds-test-secret-at-least-thirty-two-characters", APP_URL: "https://grelqa.test",
    MAIL_MODE: "smtp", SMTP_HOST: "127.0.0.1", SMTP_PORT: "9", MAIL_FROM: "test@grelqa.test" };
  let server: ReturnType<typeof spawn> | undefined;
  const connection = await openDatabase(env.DATABASE_URL);
  try {
    execFileSync(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], { env, stdio: "pipe" });
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "0"], { env, stdio: ["ignore", "pipe", "pipe"] });
    const base = await new Promise<string>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error(output || "Нет запуска")), 30000);
      server!.once("error", (e) => { clearTimeout(timer); reject(e); });
      server!.once("exit", () => { clearTimeout(timer); reject(new Error(output)); });
      const collect = (chunk: Buffer) => { output += chunk.toString(); const url = output.match(/Local:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1]; if (url && output.includes("Ready")) { clearTimeout(timer); resolve(url); } };
      server!.stdout!.on("data", collect); server!.stderr!.on("data", collect);
    });
    async function get(format: "rss" | "atom") {
      const response = await fetch(`${base}/${format}.xml`);
      assert.equal(response.status, 200); assert.equal(response.headers.get("content-type"), `application/${format}+xml; charset=utf-8`);
      assert.equal(response.headers.get("set-cookie"), null);
      const source = await response.text();
      assert.doesNotMatch(source, /СКРЫТО|owner-secret|password|accessToken|email/);
      return { source, root: parseXml(source) };
    }
    const emptyRss = await get("rss");
    assert.equal(emptyRss.root.name, "rss"); assert.equal(emptyRss.root.attrs.version, "2.0");
    const channel = child(emptyRss.root, "channel");
    assert.equal(children(channel, "item").length, 0); assert.ok(text(channel, "title")); assert.ok(text(channel, "description"));
    assert.equal(children(channel, "lastBuildDate").length, 0);
    const emptyAtom = await get("atom");
    assert.equal(emptyAtom.root.uri, ATOM); assert.equal(text(emptyAtom.root, "updated"), "1970-01-01T00:00:00.000Z");
    assert.equal(children(emptyAtom.root, "entry").length, 0); assert.equal(text(child(emptyAtom.root, "author"), "name"), "Рваная Грелка");
    assert.equal((await get("atom")).source, emptyAtom.source);
    const { db } = connection;
    await db.insert(users).values({ id: "owner-secret", email: "owner-secret@example.test", passwordHash: "not-used-in-feed-tests", createdAt: new Date("2019-01-01") });
    async function add(id: string, day: number, options: { stage?: "preparation" | "submissions" | "failed"; published?: Date | null; noTheme?: boolean; futureStart?: boolean } = {}) {
      const start = new Date(options.futureStart ? "2099-01-01T12:00:00Z" : `2020-01-${String(day).padStart(2, "0")}T12:00:00Z`);
      const end = new Date(+start + 86400_000);
      await db.insert(contests).values({ id, slug: id, organizerId: "owner-secret", title: id === "public-14" ? 'Кириллица <& "😀\u0001' : id,
        description: "Тест", stage: options.stage ?? "submissions", failureReason: options.stage === "failed" ? "no-stories" : null,
        submissionsStartAt: start, startDayMoscow: start.toISOString().slice(0, 10), submissionsEndAt: end,
        roundOneStartAt: end, endsAt: new Date(+end + 86400_000), groupCapacity: 10, finalCapacity: 10, createdAt: new Date("2019-01-01") });
      if (!options.noTheme) await db.insert(contestThemes).values({ contestId: id, theme: id.startsWith("hidden") ? "СКРЫТО" : 'Тема <script> & 😀', conditions: [],
        enteredAt: new Date(+start - 1000), publishedAt: options.published === undefined ? new Date(+start + 3600_000) : options.published });
    }
    for (let n = 1; n <= 14; n++) await add(`public-${String(n).padStart(2, "0")}`, n, { stage: n === 12 ? "failed" : "submissions", published: n >= 13 ? new Date("2020-02-01T12:00:00Z") : undefined });
    await add("hidden-preparation", 15, { stage: "preparation" });
    await add("hidden-future", 16, { published: new Date("2099-01-01") });
    await add("hidden-null", 17, { published: null });
    await add("hidden-missing", 18, { noTheme: true });
    await add("hidden-start", 19, { futureStart: true, published: new Date("2020-01-01") });
    const rss = await get("rss"), atom = await get("atom");
    const items = children(child(rss.root, "channel"), "item"), entries = children(atom.root, "entry");
    assert.equal(items.length, 10); assert.equal(entries.length, 10);
    const ids: string[] = [];
    let previous = Infinity;
    for (let i = 0; i < items.length; i++) {
      const item = items[i], entry = entries[i];
      assert.equal(entry.uri, ATOM);
      const expectedSlug = `public-${String(14 - i).padStart(2, "0")}`;
      assert.equal(text(item, "link"), env.SITE_URL + "/contests/" + expectedSlug);
      assert.equal(child(entry, "link").attrs.href, text(item, "link"));
      assert.equal(text(entry, "title"), text(item, "title"));
      const published = text(item, "pubDate"), instant = new Date(published);
      assert.ok(Number.isFinite(+instant)); assert.equal(instant.toUTCString(), published); assert.ok(+instant <= previous); previous = +instant;
      assert.equal(+new Date(text(entry, "published")), +instant);
      assert.equal(text(entry, "updated"), text(entry, "published"));
      assert.equal(child(item, "guid").attrs.isPermaLink, "false");
      assert.equal(text(entry, "id"), text(item, "guid")); ids.push(text(entry, "id"));
      assert.match(text(entry, "summary"), /Окончание приёма рассказов: \d{4}-\d\d-\d\dT/);
      assert.match(text(item, "description"), /&lt;script&gt;/);
      assert.equal(child(entry, "summary").attrs.type, "text");
      assert.equal(children(entry, "script").length, 0);
    }
    assert.equal(new Set(ids).size, 10);
    assert.equal(text(items[0], "title"), 'Кириллица <& "😀');
    assert.equal(text(child(rss.root, "channel"), "lastBuildDate"), text(items[0], "pubDate"));
    assert.equal(text(atom.root, "updated"), text(entries[0], "updated"));
    assert.equal((await get("rss")).source, rss.source); assert.equal((await get("atom")).source, atom.source);
    await db.update(contests).set({ slug: "new-slug", title: "Новое название" }).where(eq(contests.id, "public-14"));
    const changed = children((await get("atom")).root, "entry")[0];
    assert.equal(text(changed, "id"), ids[0]); assert.equal(child(changed, "link").attrs.href, env.SITE_URL + "/contests/new-slug");
    // A stored publication timestamp before start must not reorder the effective announcement incorrectly.
    await db.update(contestThemes).set({ publishedAt: new Date("2019-01-01") }).where(eq(contestThemes.contestId, "public-14"));
    const effective = children((await get("atom")).root, "entry").find((e) => text(e, "id") === ids[0])!;
    assert.equal(text(effective, "published"), "2020-01-14T12:00:00.000Z");
    const html = await (await fetch(base)).text();
    assert.match(html, /<link[^>]*rel="alternate"[^>]*type="application\/rss\+xml"[^>]*href="\/rss.xml"/);
    assert.match(html, /<link[^>]*rel="alternate"[^>]*type="application\/atom\+xml"[^>]*href="\/atom.xml"/);
    assert.match(html, /href="\/rss.xml">RSS<\/a>/); assert.match(html, /href="\/atom.xml">Atom<\/a>/);
  } finally {
    connection.client.close();
    if (server && server.exitCode === null && server.signalCode === null) { const exit = once(server, "exit"); server.kill("SIGTERM"); await exit; }
    await rm(directory, { recursive: true, force: true });
  }
});
