import Link from "next/link";
import { notFound } from "next/navigation";
import { requireVerifiedUser } from "@/auth/session";
import { ownStory } from "@/stories/service";
import { StoryEditor } from "@/components/story-editor";

export const metadata = { title: "Редактирование работы" };
export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireVerifiedUser();
  const row = await ownStory(user.id, (await params).id);
  if (!row) notFound();
  return <section className="editing-page"><Link className="back-link" href={`/account/my-stories/${row.story.id}`}>← К работе</Link><h1>Редактирование</h1><p>{row.contest.title}</p>{row.editable ? <StoryEditor slug={row.contest.slug} minLength={row.contest.minLength} maxLength={row.contest.maxLength} initial={{ id: row.story.id, revision: row.story.revision, title: row.story.title, content: row.story.content }} /> : <p className="empty-stories">Редактирование сейчас недоступно. Текст можно прочитать на странице своей работы.</p>}</section>;
}
