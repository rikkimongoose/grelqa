import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { migrate } from "drizzle-orm/libsql/migrator";
import { and, eq } from "drizzle-orm";
import { hash } from "@node-rs/argon2";
import { unzipSync, strFromU8 } from "fflate";
import { openDatabase } from "../src/db/connection";
import { getDatabase } from "../src/db";
import * as s from "../src/db/schema";
import { tokenHash } from "../src/auth/service";
import { seedManagementDemo } from "../scripts/demo-management-data";
import { seedClosureDemo } from "../scripts/demo-closure-data";
import { seedCompletionDemo } from "../scripts/demo-completion-data";
import { managedContests, managementView, saveContest, assignCoordinator, issueThemeInvite, enterTheme, contestAction, moderateStory } from "../src/management/service";
import { ManagementError } from "../src/management/access";
import { getPublicContest } from "../src/db/public-contests";
import { getPublicStory } from "../src/db/public-stories";
import { getContestFeed } from "../src/feeds/data";
import { downloadArchive } from "../src/exports/service";
import { contestSettings, type SettingsInput } from "../src/management/settings";

const denied = (value: Promise<unknown>, status = 403) => assert.rejects(value, (e) => e instanceof ManagementError && e.status === status);
const tokenFrom = (link: string) => new URLSearchParams(new URL(link).hash.slice(1)).get("token")!;
test("управление: роли, настройки, токены, анонимная модерация, переходы, история и HTTP", { timeout: 180000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grelqa-management-")); const old = { ...process.env };
  const env = { ...process.env, NODE_ENV: "development" as const, DATABASE_URL: `file:${path.join(directory, "test.db")}`, EXPORT_CACHE_DIRECTORY: path.join(directory, "exports"), APP_URL: "https://grelqa.test", SITE_URL: "https://grelqa.test", SESSION_SECRET: "management-tests-secret-at-least-thirty-two-characters", MAIL_MODE: "smtp", SMTP_HOST: "127.0.0.1", SMTP_PORT: "9", MAIL_FROM: "test@grelqa.test" };
  Object.assign(process.env, env); const { db, client } = await openDatabase(env.DATABASE_URL);
  let server: ReturnType<typeof spawn> | undefined;
  const draft = "demo-management-draft", moderation = "demo-management-moderation";
  const tokens = new Map<string, string>();
  async function session(userId: string) {
    const token = randomBytes(32).toString("hex");
    await db.insert(s.authSessions).values({ tokenHash: tokenHash("session", token), userId, createdAt: new Date(), expiresAt: new Date(Date.now() + 3600000) }); return token;
  }
  const textZip = (bytes: Uint8Array) => Object.values(unzipSync(bytes)).map((b) => strFromU8(b)).join("\n");
  try {
    await migrate(db, { migrationsFolder: "drizzle" }); await migrate(db, { migrationsFolder: "drizzle" });
    assert.equal(await seedManagementDemo(db), true); assert.equal(await seedManagementDemo(db), false);
    for (const name of ["owner", "coordinator", "author-one", "author-two"]) tokens.set(name, await session(`demo-management-${name}`));
    const owner = tokens.get("owner")!, coord = tokens.get("coordinator")!, other = tokens.get("author-one")!;
    assert.equal((await managedContests(owner)).rows.length, 2); assert.equal((await managedContests(coord)).rows.length, 2);
    await denied(managementView(other, draft)); await denied(managementView("", draft));
    await denied(issueThemeInvite(coord, draft)); await denied(contestAction(coord, draft, "publish"));
    assert.equal(await getPublicContest(draft), undefined); assert.ok(!(await getContestFeed()).entries.some((e) => e.url.endsWith(draft)));
    const settings: SettingsInput = { title: "Тестовый конкурс", description: "Описание подготовки", discussionUrl: "https://example.test/discuss", ownerEmail: "management-owner@grelqa.example", coordinatorEmail: "management-coordinator@grelqa.example", submissionsStartAt: "2090-02-01T15:00", submissionsEndAt: "2090-02-02T15:00", roundOneStartAt: "2090-02-03T15:00", roundTwoStartAt: "2090-02-05T15:00", endsAt: "2090-02-06T15:00", minLength: 0, maxLength: 10000, groupCapacity: 3, finalCapacity: 3 };
    assert.equal(contestSettings.safeParse({ ...settings, roundTwoStartAt: "" }).success, false);
    assert.equal(contestSettings.safeParse({ ...settings, submissionsStartAt: "2090-02-31T15:00" }).success, false);
    await assert.rejects(saveContest(owner, { ...settings, endsAt: "2089-01-01T15:00" }));
    await assert.rejects(saveContest(owner, { ...settings, submissionsStartAt: "2090-02-01T14:00" }));
    await assert.rejects(saveContest(owner, { ...settings, minLength: 20, maxLength: 10 }));
    const created = await saveContest(owner, settings); assert.ok(created.slug);
    assert.equal(await getPublicContest(created.slug), undefined);
    const foreign = await saveContest(owner, { ...settings, coordinatorEmail: "management-author-two@grelqa.example", submissionsStartAt: "2091-02-01T15:00", submissionsEndAt: "2091-02-02T15:00", roundOneStartAt: "2091-02-03T15:00", roundTwoStartAt: "2091-02-05T15:00", endsAt: "2091-02-06T15:00" });
    assert.ok(foreign.slug);
    await denied(managementView(tokens.get("author-two")!, created.slug));

    await denied(saveContest(coord, settings, created.slug, 1));
    await saveContest(owner, { ...settings, title: "Новая редакция" }, created.slug, 1);
    await denied(saveContest(owner, settings, created.slug, 1), 409);
    const firstInvite = await issueThemeInvite(owner, created.slug), secondInvite = await issueThemeInvite(owner, created.slug);
    await denied(enterTheme(tokenFrom(firstInvite.link), "ТЕМА СЕКРЕТ", []), 400);
    const secret = tokenFrom(secondInvite.link);
    const [stored] = await db.select().from(s.contestThemeInvites).where(eq(s.contestThemeInvites.contestId, (await db.select().from(s.contests).where(eq(s.contests.slug, created.slug)))[0].id));
    assert.notEqual(stored.tokenHash, secret); assert.equal(stored.tokenHash.length, 64);
    const consumed = await Promise.allSettled([enterTheme(secret, "ТЕМА СЕКРЕТ", ["СКРЫТОЕ УСЛОВИЕ"]), enterTheme(secret, "Другая тема", [])]);
    assert.equal(consumed.filter((r) => r.status === "fulfilled").length, 1);
    await denied(enterTheme(secret, "Повтор", []), 409); await denied(issueThemeInvite(owner, created.slug), 409);
    const view = await managementView(coord, created.slug);
    assert.doesNotMatch(JSON.stringify(view), /ТЕМА СЕКРЕТ|СКРЫТОЕ УСЛОВИЕ|token_hash|tokenHash|passwordHash|management-owner@|management-author-one@/);
    await contestAction(owner, created.slug, "publish"); assert.ok(await getPublicContest(created.slug));
    assert.equal((await getPublicContest(created.slug))?.theme, null);
    await denied(saveContest(owner, settings, created.slug, 2), 409);
    // A received theme locks the start even while still a draft.
    const [draftRow] = await db.select().from(s.contests).where(eq(s.contests.slug, draft));
    const link = await issueThemeInvite(owner, draft);
    await db.update(s.contestThemeInvites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(s.contestThemeInvites.contestId, draftRow.id));
    await denied(enterTheme(tokenFrom(link.link), "Expired", []), 410);
    const revoked = await issueThemeInvite(owner, draft); const renewed = await issueThemeInvite(owner, draft);
    await denied(enterTheme(tokenFrom(revoked.link), "Revoked", []), 400);
    assert.ok(renewed.link.includes("#token="));
    const [sample] = await db.select().from(s.stories).where(eq(s.stories.id, "demo-management-story-1"));
    await db.insert(s.stories).values({ ...sample, id: "legacy-private-draft", title: "НЕПОДАННЫЙ СКРЫТЫЙ ЧЕРНОВИК", status: "draft" });
    const anonView = await managementView(coord, moderation);
    assert.equal(anonView.works.length, 3);
    assert.doesNotMatch(JSON.stringify(anonView), /НЕПОДАННЫЙ СКРЫТЫЙ ЧЕРНОВИК|legacy-private-draft/);
    assert.doesNotMatch(JSON.stringify(anonView), /demo-management-author|member-author|password|tokenHash|selections|participationId|userId/);
    await denied(moderateStory(other, moderation, "demo-management-story-1", "admit", "Проверено"));
    await denied(moderateStory(coord, moderation, "demo-management-story-1", "admit", ""), 400);
    await moderateStory(coord, moderation, "demo-management-story-1", "admit", "Соответствует условиям");
    await moderateStory(owner, moderation, "demo-management-story-2", "admit", "Проверка завершена");
    await moderateStory(coord, moderation, "demo-management-story-3", "reject", "Не соответствует условию");
    await denied(moderateStory(coord, moderation, "demo-management-story-3", "admit", "Восстановление"), 409);
    const [event] = await db.select().from(s.contestAdminEvents).where(and(eq(s.contestAdminEvents.contestId, moderation), eq(s.contestAdminEvents.actorId, "demo-management-coordinator")));
    assert.equal(event.details.before, "submitted"); assert.equal(event.details.after, "admitted"); assert.equal(event.details.reason, "Соответствует условиям");
    const concurrent = await Promise.all([contestAction(coord, moderation, "form"), contestAction(owner, moderation, "form")]); assert.equal(concurrent.length, 2);
    assert.equal((await db.select().from(s.firstRoundFormations).where(eq(s.firstRoundFormations.contestId, moderation))).length, 1);
    assert.equal((await db.select().from(s.contestAdminEvents).where(and(eq(s.contestAdminEvents.contestId, moderation), eq(s.contestAdminEvents.action, "formFirstRound")))).length, 1);
    assert.ok(await getPublicStory(moderation, "demo-management-story-1"));
    await denied(moderateStory(coord, moderation, "demo-management-story-1", "reject", "Поздно"), 409);
    await denied(contestAction(other, moderation, "form"));
    await denied(contestAction(coord, moderation, "start-first"), 409);
    await denied(contestAction(owner, draft, "start-reception"), 409);
    const [c] = await db.select().from(s.contests).where(eq(s.contests.slug, moderation));
    // Only this temporary fixture is advanced to a presently open round, not a public stage switch.
    await db.update(s.contests).set({ roundOneStartAt: new Date(Date.now() - 1000), submissionsEndAt: new Date(Date.now() - 2000) }).where(eq(s.contests.id, c.id));
    await contestAction(coord, moderation, "start-first");
    await assert.rejects(contestAction(coord, moderation, "close-first"), /Дедлайн/);

    const oldZip = await downloadArchive(moderation); assert.ok(oldZip);
    const oldFeed = (await getContestFeed()).entries.find((e) => e.url.endsWith(moderation))!;
    await delay(5); await moderateStory(coord, moderation, "demo-management-story-1", "withdraw", "Нарушение анонимности");
    assert.equal(await getPublicStory(moderation, "demo-management-story-1"), undefined);
    const zip = await downloadArchive(moderation); assert.ok(zip); assert.notDeepEqual(zip.bytes, oldZip.bytes); assert.doesNotMatch(textZip(zip.bytes), /Репортаж 1/);
    const feed = (await getContestFeed()).entries.find((e) => e.url.endsWith(moderation))!; assert.equal(feed.id, oldFeed.id); assert.ok(+feed.updated > +oldFeed.updated);
    const round = (await db.select().from(s.storyRounds).where(eq(s.storyRounds.storyId, "demo-management-story-1")))[0]; assert.equal(round.status, "withdrawn"); assert.equal(round.withdrawalReason, "Нарушение анонимности");
    await denied(moderateStory(coord, moderation, "demo-management-story-1", "withdraw", "Повтор"), 409);
    // Web calls use the same protected atomic closure/finalization algorithms on non-demo contests too.
    await seedClosureDemo(db, "web-closure");
    await db.update(s.contests).set({ isDemo: false, organizerId: "demo-management-owner", coordinatorId: "demo-management-coordinator" }).where(eq(s.contests.slug, "web-closure"));
    await denied(contestAction(other, "web-closure", "close-first"));
    await contestAction(coord, "web-closure", "close-first"); await contestAction(owner, "web-closure", "close-first");
    assert.equal((await db.select().from(s.contestAdminEvents).where(and(eq(s.contestAdminEvents.contestId, "web-closure"), eq(s.contestAdminEvents.action, "closeFirstRound")))).length, 1);
    await seedCompletionDemo(db, "web-finalization");
    await db.update(s.contests).set({ isDemo: false, organizerId: "demo-management-owner", coordinatorId: "demo-management-coordinator" }).where(eq(s.contests.slug, "web-finalization"));
    await contestAction(coord, "web-finalization", "finalize"); await contestAction(owner, "web-finalization", "finalize");
    // Administrative audit insertion must be in the business transaction.
    await seedClosureDemo(db, "web-rollback"); await db.update(s.contests).set({ organizerId: "demo-management-owner" }).where(eq(s.contests.id, "web-rollback"));
    await client.execute("CREATE TRIGGER admin_fail BEFORE INSERT ON contest_admin_events WHEN NEW.contest_id = 'web-rollback' BEGIN SELECT RAISE(ABORT,'test'); END");
    await assert.rejects(contestAction(owner, "web-rollback", "close-first"));
    assert.equal((await db.select().from(s.firstRoundClosures).where(eq(s.firstRoundClosures.contestId, "web-rollback"))).length, 0);
    await client.execute("DROP TRIGGER admin_fail");
    const allAudit = JSON.stringify(await db.select().from(s.contestAdminEvents)); assert.doesNotMatch(allAudit, new RegExp(secret)); assert.doesNotMatch(allAudit, /ТЕМА СЕКРЕТ|СКРЫТОЕ УСЛОВИЕ/);
    const revision = (await db.select().from(s.contests).where(eq(s.contests.slug, created.slug)))[0].settingsRevision;
    await denied(assignCoordinator(coord, created.slug, "", revision));
    await assignCoordinator(owner, created.slug, "", revision);
    await denied(managementView(coord, created.slug));
    await denied(assignCoordinator(owner, created.slug, "management-coordinator@grelqa.example", revision), 409);
    await assignCoordinator(owner, created.slug, "management-coordinator@grelqa.example", revision + 1);
    // Expired sessions/changed roles cannot reuse a once-authorized manager page.
    await db.update(s.authSessions).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(s.authSessions.tokenHash, tokenHash("session", coord)));
    await denied(contestAction(coord, moderation, "close-reception"));
    const password = "a-valid-test-password-123";
    for (const who of ["owner", "coordinator", "author-one"]) await db.update(s.users).set({ passwordHash: await hash(password, { algorithm: 2 }) }).where(eq(s.users.id, `demo-management-${who}`));
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "0"], { env: { ...env, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; server.stdout!.on("data", (b) => { output += b; }); server.stderr!.on("data", (b) => { output += b; }); let base = "";
    for (let i = 0; i < 200; i++) { const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match && output.includes("Ready")) { base = match[0]; break; } await delay(100); } assert.ok(base, output);
    const login = await fetch(base + "/api/account/login", { method: "POST", headers: { Origin: env.APP_URL, "Content-Type": "application/json" }, body: JSON.stringify({ email: "management-owner@grelqa.example", password }) }); assert.equal(login.status, 200); const cookie = login.headers.get("set-cookie")!.split(";")[0];
    const post = (action: string, body: unknown, auth = true, origin = env.APP_URL) => fetch(base + `/api/manage/${action}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", ...(auth ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    const getCookie = async (who: string) => {
      const r = await fetch(base + "/api/account/login", { method: "POST", headers: { Origin: env.APP_URL, "Content-Type": "application/json" }, body: JSON.stringify({ email: `management-${who}@grelqa.example`, password }) });
      assert.equal(r.status, 200); return r.headers.get("set-cookie")!.split(";")[0];
    };
    const otherCookie = await getCookie("author-one"), coordCookie = await getCookie("coordinator");
    for (const [action, cookieValue, body] of [["form", otherCookie, { slug: moderation, confirmed: true }], ["theme-link", coordCookie, { slug: draft }], ["save", coordCookie, { slug: created.slug, revision: 2, settings }]] as const) {
      const r = await fetch(base + `/api/manage/${action}`, { method: "POST", headers: { Origin: env.APP_URL, "Content-Type": "application/json", Cookie: cookieValue }, body: JSON.stringify(body) }); assert.equal(r.status, 403);
    }
    const foreignPage = await fetch(base + `/manage/${created.slug}`, { headers: { Cookie: otherCookie } });
    assert.doesNotMatch(await foreignPage.text(), /Новая редакция|ТЕМА СЕКРЕТ|СКРЫТОЕ УСЛОВИЕ|management-owner@/);
    assert.equal((await post("form", { slug: moderation, confirmed: true }, false)).status, 403);
    assert.equal((await post("form", { slug: moderation, confirmed: true }, true, "https://foreign.test")).status, 403);
    assert.equal((await post("form", { slug: moderation })).status, 400);
    assert.equal((await post("publish", { slug: created.slug, confirmed: true, organizerId: "demo-management-author-one" })).status, 400);
    const page = await fetch(base + `/manage/${created.slug}`, { headers: { Cookie: cookie } }); assert.equal(page.status, 200); assert.match(page.headers.get("cache-control")!, /private.*no-store/);
    const html = await page.text(); assert.match(html, /Журнал/); assert.doesNotMatch(html, /ТЕМА СЕКРЕТ|СКРЫТОЕ УСЛОВИЕ|passwordHash|tokenHash|selections/);
    const unauth = await fetch(base + `/manage/${draft}`, { redirect: "manual" }); assert.ok([307, 308].includes(unauth.status));
    const themePage = await fetch(base + "/enter-theme"); assert.equal(themePage.status, 200); assert.equal(themePage.headers.get("referrer-policy"), "no-referrer"); assert.match(themePage.headers.get("cache-control")!, /no-store/);
    assert.equal((await fetch(base + `/contests/${draft}`)).status, 404);
    for (const format of ["rss", "atom"]) { const xml = await (await fetch(base + `/${format}.xml`)).text(); assert.doesNotMatch(xml, /ТЕМА СЕКРЕТ|СКРЫТОЕ УСЛОВИЕ|Секретный репортаж/); }
    const expireLink = tokenFrom(renewed.link);
    const send = await post("enter-theme", { token: expireLink, theme: "Тема без аккаунта", conditions: [] }, false); assert.equal(send.status, 200);
    const expiry = await saveContest(owner, { ...settings, submissionsStartAt: "2092-02-01T15:00", submissionsEndAt: "2092-02-02T15:00", roundOneStartAt: "2092-02-03T15:00", roundTwoStartAt: "2092-02-05T15:00", endsAt: "2092-02-06T15:00" });
    const deadlineLink = await issueThemeInvite(owner, expiry.slug);
    await db.update(s.contests).set({ submissionsStartAt: new Date("2001-01-01T12:00:00Z"), startDayMoscow: "2001-01-01" }).where(eq(s.contests.slug, expiry.slug));
    await denied(enterTheme(tokenFrom(deadlineLink.link), "Слишком поздно", []), 410);
    assert.deepEqual((await client.execute("pragma foreign_key_check")).rows, []);
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) { const exit = once(server, "exit"); server.kill("SIGTERM"); await exit; }
    client.close(); (await getDatabase()).client.close(); for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); await rm(directory, { recursive: true, force: true });
  }
});
