import Link from "next/link";
import { notFound } from "next/navigation";
import { requireVerifiedUser } from "@/auth/session";
import { ownStory } from "@/stories/service";
import { StoryText } from "@/components/story-text";
import { WithdrawStory } from "@/components/withdraw-story";
import { storyVolume } from "@/lib/story-content";
import { storyStatusLabels } from "@/lib/submission";
import { formatDate } from "@/lib/contests";

export const metadata = { title: "Моя работа" };
export default async function OwnStoryPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireVerifiedUser();
  const row = await ownStory(user.id, (await params).id);
  if (!row) notFound();
  return <div className="reading-page"><Link className="back-link" href="/account/my-stories">← Мои работы</Link>
    <article className="reading-article"><header className="reading-header"><p className="eyebrow">Приватный просмотр · {row.contest.title}</p><h1>{row.story.title}</h1><p className="muted">{storyStatusLabels[row.story.status]} · {storyVolume(row.story.content, row.story.length)}</p>
      {row.withdrawnRounds.length > 0 && <p className="muted">Снята в турах: {row.withdrawnRounds.join(", ")}</p>}
      <p className="muted">Подана: {formatDate(row.story.createdAt.toISOString())}<br />Изменена: {formatDate(row.story.updatedAt.toISOString())}</p>
      {row.editable ? <Link className="button" href={`/account/my-stories/${row.story.id}/edit`}>Редактировать</Link> : <p className="muted">Редактирование недоступно на текущем этапе или в этом статусе.</p>}
    </header><StoryText content={row.story.content} /></article>
    {row.withdrawable && <WithdrawStory id={row.story.id} revision={row.story.revision} />}
  </div>;
}
