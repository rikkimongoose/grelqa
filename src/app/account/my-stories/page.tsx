import Link from "next/link";
import { requireVerifiedUser } from "@/auth/session";
import { ownStories, receptionContests } from "@/stories/service";
import { storyStatusLabels } from "@/lib/submission";
import { storyVolume } from "@/lib/story-content";

export const metadata = { title: "Мои работы" };
export default async function MyStories() {
  const user = await requireVerifiedUser();
  const [stories, contests] = await Promise.all([ownStories(user.id), receptionContests()]);
  return <section className="my-stories"><p className="eyebrow">Личная библиотека</p><h1>Мои работы</h1>
    {!stories.length && <p className="empty-stories">У вас пока нет работ. Выберите конкурс с открытым приёмом и подайте свой первый рассказ.</p>}
    <ul className="story-list">{stories.map((story) => <li key={story.id}><div><p className="muted">{story.contestTitle}</p><h4><Link href={`/account/my-stories/${story.id}`}>{story.title}</Link></h4><p className="muted">{storyVolume(story.content, story.length)} · {storyStatusLabels[story.status]}{story.withdrawnRounds.length ? ` · Снята в турах: ${story.withdrawnRounds.join(", ")}` : ""}</p></div><Link href={`/account/my-stories/${story.id}`}>Просмотр и действия →</Link></li>)}</ul>
    <section className="open-contests"><h2>Подать новую работу</h2>{contests.length ? <ul>{contests.map((contest) => <li key={contest.slug}><Link href={`/contests/${encodeURIComponent(contest.slug)}/submit`}>{contest.title} — добавить рассказ →</Link></li>)}</ul> : <p className="muted">Сейчас нет конкурсов с открытым приёмом.</p>}</section>
  </section>;
}
