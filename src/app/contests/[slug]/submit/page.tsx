import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { currentUser } from "@/auth/session";
import { submissionContest } from "@/stories/service";
import { StoryEditor } from "@/components/story-editor";
import { safeReturnPath } from "@/lib/return-path";

export const dynamic = "force-dynamic";
export const metadata = { title: "Подача рассказа", robots: { index: false, follow: false } };
export default async function SubmitPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await currentUser();
  const back = `/contests/${encodeURIComponent(slug)}`;
  if (!user) redirect(`/login?returnTo=${encodeURIComponent(safeReturnPath(back) || "/account")}`);
  if (!user.emailVerifiedAt) redirect("/registration-status");
  const contest = await submissionContest(slug);
  if (!contest) notFound();
  return <section className="editing-page"><Link className="back-link" href={back}>← К конкурсу</Link><h1>Подать рассказ</h1><p>{contest.title}</p>{contest.open ? <><p className="muted">Работа сохранится как поданная и будет ждать проверки. Автоматической публикации нет. Количество работ автора не ограничено.</p><StoryEditor slug={slug} minLength={contest.minLength} maxLength={contest.maxLength} /></> : <p className="empty-stories">Приём работ сейчас закрыт.</p>}</section>;
}
