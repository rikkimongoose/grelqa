import { requireVerifiedUser } from "@/auth/session";
import Link from "next/link";
import { myVotingGroups } from "@/contests/grouping-queries";
export const metadata = { title: "Мой кабинет", robots: { index: false, follow: false } };
export default async function AccountPage() {
  const user = await requireVerifiedUser();
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
  </section>;
}
