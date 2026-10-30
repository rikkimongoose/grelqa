import Link from "next/link";
import { StageBadge } from "@/components/stage-badge";
import { getPublicContests } from "@/db/public-contests";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function Home() {
  const contests = await getPublicContests();
  return <>
    <section className="hero">
      <p className="eyebrow">Анонимные литературные конкурсы</p>
      <h1>Сначала — история.<br /><em>Имя — потом.</em></h1>
      <p className="hero-copy">Общая тема, чистый лист и ваш голос. Пространство, где встречаются новые рассказы, а главным остаётся текст.</p>
      <a className="button" href="#contests">Найти свой конкурс <span aria-hidden="true">↓</span></a>
      <span className="hero-mark" aria-hidden="true">Аа</span>
    </section>
    <section id="contests" className="contest-section" aria-labelledby="contests-title">
      <div className="section-heading"><div><p className="eyebrow">Открываем новую страницу</p><h2 id="contests-title">Конкурсы</h2></div><span className="muted">Конкурсов: {contests.length}</span></div>
      {contests.length === 0 && <p className="muted">Пока нет конкурсов.</p>}
      <div className="contest-grid">{contests.map((contest) => <article className="contest-card" key={contest.slug}>
        <div className="card-top"><StageBadge stage={contest.stage} /><span className="card-number">{contest.number}</span></div>
        <h3><Link href={`/contests/${contest.slug}`}>{contest.title}</Link></h3>
        <p className="card-description">{contest.description}</p>
        <div className="card-theme"><span className="eyebrow">Тема</span><p>{contest.theme ?? "Откроется при старте"}</p></div>
        <p className="length">{contest.length}</p>
        <Link className="text-link" href={`/contests/${contest.slug}`}>О конкурсе <span aria-hidden="true">↗</span></Link>
      </article>)}</div>
    </section>
    <aside className="editorial-note"><span aria-hidden="true">§</span><div><h2>У каждой истории есть голос</h2><p>Авторы остаются анонимными до конца голосования по конкурсу, включая финал. Опубликованные конкурсные произведения можно читать без регистрации.</p><p className="muted">Можно подать рассказ во время приёма и читать опубликованные работы. Голосование появится следующим этапом.</p></div></aside>
  </>;
}
