import { requireVerifiedUser } from "@/auth/session";
import Link from "next/link";
import { ownFirstRoundResults } from "@/contests/results-queries";
import { myVotingGroups } from "@/contests/grouping-queries";
export const metadata = { title: "Мой кабинет", robots: { index: false, follow: false } };
export default async function AccountPage() {
  const user = await requireVerifiedUser();
  const ownResults = await ownFirstRoundResults(user.id);
  const votingGroups = await myVotingGroups(user.id);
  return <section className="auth-page"><p className="eyebrow">Ваше пространство</p><h1>Мой кабинет</h1><p>Email подтверждён: {user.email}</p><Link className="button" href="/account/my-stories">Мои работы →</Link>
    <section className="open-contests"><h2>Моя группа для голосования</h2>{!votingGroups.length && <p className="muted">Вы ещё не участвуете в конкурсах. После формирования групп здесь появится назначение.</p>}
      {votingGroups.map((group) => <article className="voting-group-card" key={group.slug}><h3><Link href={group.href}>{group.title}{group.assigned ? ` · Группа ${group.number}` : ""}</Link></h3>
        {group.message && <p>{group.message}</p>}{group.waitingPublication && <p className="muted">Назначение сохранено. Состав группы пока не опубликован.</p>}
        {group.assigned && <p className="muted">Нельзя голосовать за любую свою работу. Снятие рассказа не меняет назначение автоматически.</p>}
        {group.exempt && <p className="muted">Вы освобождены от голосования: нет доступных чужих работ.</p>}
        {group.ballotHref && <p><Link href={group.ballotHref}>Мой бюллетень →</Link></p>}
      </article>)}
    </section>
    {ownResults.length > 0 && <section><h2>Результаты моих работ</h2>{ownResults.map((result) => <article key={result.slug}><h3><Link href={`/contests/${encodeURIComponent(result.slug)}#round-one-results`}>{result.title}</Link></h3>
      <p>Голосование: {result.status === "exempt" ? "освобождён от обязанности" : result.status === "submitted" ? "бюллетень отправлен" : result.status === "not-voted" ? "обязанность не выполнена" : "права голоса не было"}.</p>
      {result.failed && <p>Конкурс не состоялся; победители и финалисты не объявляются.</p>}
      <ul>{result.stories.map((story) => <li key={story.id}><Link href={`/account/my-stories/${encodeURIComponent(story.id)}`}>{story.title}</Link> — {story.withdrawalMessage ?? (story.place === null ? "без места" : `место ${story.place}${story.shared ? " (разделённое)" : ""}, ${story.points} баллов${story.finalist ? ", выход в финал" : ""}`)}</li>)}</ul>
    </article>)}</section>}
  </section>;
}
