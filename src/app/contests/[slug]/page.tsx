import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StageBadge } from "@/components/stage-badge";
import { contests, formatDate } from "@/lib/contests";

export const dynamicParams = false;

export function generateStaticParams() {
  return contests.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const contest = contests.find((item) => item.slug === slug);
  return { title: contest?.title ?? "Конкурс не найден" };
}

export default async function ContestPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const contest = contests.find((item) => item.slug === slug);
  if (!contest) notFound();

  return <>
    <Link className="back-link" href="/#contests">← Все конкурсы</Link>
    <header className="contest-hero"><StageBadge stage={contest.stage} /><h1>{contest.title}</h1><p className="hero-copy">{contest.description}</p></header>
    <div className="detail-grid">
      <div>
        <section className="theme-panel" aria-labelledby="theme-title"><p className="eyebrow">Тема конкурса</p><h2 id="theme-title">{contest.theme ?? "Пока между строк"}</h2>{!contest.theme && <p>Тема будет объявлена при старте конкурса. До этого момента она не публикуется.</p>}</section>
        <section className="conditions" aria-labelledby="conditions-title"><h2 id="conditions-title">Условия</h2><p className="length detail-length">{contest.length}</p><ul>{contest.conditions.map((condition) => <li key={condition}>{condition}</li>)}</ul></section>
        <aside className="demo-note"><strong>Это демонстрационный конкурс.</strong><p>Данные вымышлены, текущий этап задан вручную. Приём работ и голосование ещё не подключены.</p></aside>
      </div>
      <section className="schedule" aria-labelledby="schedule-title"><p className="eyebrow">Шаг за шагом</p><h2 id="schedule-title">Расписание</h2><p className="muted">Все даты — по московскому времени (МСК).</p><ol>{contest.schedule.map((item) => <li key={item.stage} className={item.stage === contest.stage ? "current" : ""} aria-current={item.stage === contest.stage ? "step" : undefined}><span className="schedule-label">{item.label}</span><time dateTime={item.date}>{formatDate(item.date)}</time>{item.stage === contest.stage && <span className="current-label">Текущий этап</span>}</li>)}</ol><p className="schedule-note">Даты и время приведены для примера. Второй тур предусмотрен при нескольких группах; порядок завершения конкурса с одной группой ещё требует уточнения.</p></section>
    </div>
  </>;
}
