import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StageBadge } from "@/components/stage-badge";
import { formatDate } from "@/lib/contests";
import { getPublicContest } from "@/db/public-contests";
import { getPublicStoryGroups } from "@/db/public-stories";
import { currentUser } from "@/auth/session";
import { ownStories, submissionContest } from "@/stories/service";
import { storyVolume } from "@/lib/story-content";
import { storyStatusLabels } from "@/lib/submission";
import { publicGroupingState } from "@/contests/grouping-queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const contest = await getPublicContest(slug);
  return { title: contest?.title ?? "Конкурс не найден" };
}

export default async function ContestPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const contest = await getPublicContest(slug);
  if (!contest) notFound();
  const receiving = contest.stage === "submissions";
  const groups = receiving ? [] : await getPublicStoryGroups(slug);
  const [user, submission] = await Promise.all([currentUser(), submissionContest(slug)]);
  const myStories = receiving && user?.emailVerifiedAt ? await ownStories(user.id, slug) : [];
  const downloadHref = `/contests/${encodeURIComponent(slug)}/download`;
  const hasStories = groups.some((group) => group.stories.length > 0);
  const groupingState = await publicGroupingState(slug);

  return <>
    <Link className="back-link" href="/#contests">← Все конкурсы</Link>
    <header className="contest-hero"><StageBadge stage={contest.stage} /><h1>{contest.title}</h1><p className="hero-copy">{contest.description}</p></header>
    {contest.stage === "failed" && <aside className="empty-stories" role="status"><strong>Конкурс не состоялся.</strong><p>{contest.failureMessage}</p><p>Конкурс и его история сохранены.</p></aside>}
    {submission?.open && <aside className="submission-action">{user?.emailVerifiedAt ? <Link className="button" href={`/contests/${encodeURIComponent(slug)}/submit`}>Подать рассказ →</Link> : user ? <><p>Для подачи рассказа подтвердите email.</p><Link className="button" href="/registration-status">Подтвердить email</Link></> : <><p>Приём открыт. Чтобы подать рассказ, войдите в учётную запись с подтверждённым email.</p><Link className="button" href={`/login?returnTo=${encodeURIComponent(`/contests/${slug}`)}`}>Войти и подать рассказ →</Link></>}</aside>}
    <div className="detail-grid">
      <div>
        <section className="theme-panel" aria-labelledby="theme-title"><p className="eyebrow">Тема конкурса</p><h2 id="theme-title">{contest.theme ?? "Пока между строк"}</h2>{!contest.theme && <p>Тема будет объявлена при старте конкурса. До этого момента она не публикуется.</p>}</section>
        <section className="conditions" aria-labelledby="conditions-title"><h2 id="conditions-title">Условия</h2><p className="length detail-length">{contest.length}</p><ul>{contest.conditions.map((condition) => <li key={condition}>{condition}</li>)}</ul></section>
        <aside className="demo-note">{contest.isDemo && <strong>Это демонстрационный конкурс.</strong>}<p>{contest.isDemo && "Данные вымышлены. "}Текущий этап задан вручную. Голосование ещё не подключено.</p></aside>
      </div>
      <section className="schedule" aria-labelledby="schedule-title"><p className="eyebrow">Шаг за шагом</p><h2 id="schedule-title">Расписание</h2><p className="muted">Все даты — по московскому времени (МСК).</p><ol>{contest.schedule.map((item) => <li key={item.stage} className={item.stage === contest.stage ? "current" : ""} aria-current={item.stage === contest.stage ? "step" : undefined}><span className="schedule-label">{item.label}</span><time dateTime={item.date}>{formatDate(item.date)}</time>{item.stage === contest.stage && <span className="current-label">Текущий этап</span>}</li>)}</ol><p className="schedule-note">{contest.isDemo && "Даты и время приведены для примера. "}Второй тур предусмотрен при нескольких группах; порядок завершения конкурса с одной группой ещё требует уточнения.</p></section>
    </div>
    <section id="stories" className="contest-stories" aria-labelledby="stories-title">
      <div className="section-heading"><div><p className="eyebrow">Время читать</p><h2 id="stories-title">Рассказы</h2></div></div>
      {receiving ? <>
        <p className="muted">Во время приёма каждый участник видит только свои рассказы. Работы других участников пока скрыты. После формирования групп редактирование закрывается.</p>
        {user?.emailVerifiedAt ? <>
          <h3>Мои рассказы в этом конкурсе</h3>
          {myStories.length ? <ul className="story-list">{myStories.map((story) => <li key={story.id}>
            <div><h4><Link href={`/account/my-stories/${story.id}`}>{story.title}</Link></h4><p className="muted">{storyVolume(story.content, story.length)} · {storyStatusLabels[story.status]}</p></div>
            <Link className="story-read" href={`/account/my-stories/${story.id}`}>Просмотр и действия →</Link>
          </li>)}</ul> : <p className="empty-stories">Вы ещё не подали рассказов в этот конкурс.</p>}
        </> : <p className="empty-stories">Войдите с подтверждённым email, чтобы увидеть свои рассказы.</p>}
      </> : <>
      {hasStories ? <p><a className="story-read" href={downloadHref}>Скачать конкурс в ZIP</a></p> : <p className="muted">Для скачивания ZIP пока нет доступных рассказов.</p>}
      {groupingState === "not-formed" && <p className="muted">Группы ещё не сформированы.</p>}
      {groupingState === "formed-private" && <p className="muted">Группы сформированы. Состав групп и рассказы пока не опубликованы.</p>}
      {groups.length === 0 ? <p className="empty-stories">{contest.stage === "failed" ? "Публичные рассказы этого конкурса недоступны." : "Пока нет доступных для чтения рассказов. Здесь появятся опубликованные конкурсные работы."}</p> : <>
        <p className="muted">Чтение доступно без регистрации. Справочный объём, отмеченный знаком ≈, не является конкурсным подсчётом.</p>
        {groups.map((group) => <section className="story-group" id={`group-${group.key}`} key={group.key} aria-label={group.title}>
          <h3>{group.title}</h3>{group.stories.length > 0 && <p><a className="story-read" href={`${downloadHref}?group=${encodeURIComponent(group.key)}`}>Скачать группу в ZIP</a></p>}{!group.stories.length && <p className="muted">В этой группе сейчас нет доступных для чтения работ.</p>}<ul className="story-list">{group.stories.map((story) => <li key={story.id}>
            <div><h4><Link href={`/contests/${encodeURIComponent(slug)}/stories/${encodeURIComponent(story.id)}`}>{story.title}</Link></h4><p className="muted">{story.volume}</p></div>
            <Link className="story-read" aria-label={`Читать «${story.title}»`} href={`/contests/${encodeURIComponent(slug)}/stories/${encodeURIComponent(story.id)}`}>Читать <span aria-hidden="true">→</span></Link>
          </li>)}</ul>
        </section>)}
      </>}
      </>}
    </section>
  </>;
}
