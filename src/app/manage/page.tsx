import { stageLabels } from "@/lib/contests";
import Link from "next/link";
import { cookieSession } from "@/auth/session";
import { managedContests } from "@/management/service";
export const metadata = { title: "Управление конкурсами" };
export default async function ManagePage() {
  const session = await cookieSession(); const data = await managedContests(session.token || "");
  return <section><p className="eyebrow">Организаторская</p><h1>Управление конкурсами</h1>{data.canCreate && <p><Link className="button" href="/manage/new">Создать конкурс</Link></p>}{!data.rows.length && <p className="empty-stories">У вас пока нет конкурсов для управления.</p>}<ul className="story-list">{data.rows.map((c) => <li key={c.slug}><Link href={`/manage/${encodeURIComponent(c.slug)}`}>{c.title}</Link><span>{c.draft ? "Неопубликованная подготовка" : stageLabels[c.stage]}</span></li>)}</ul></section>;
}
