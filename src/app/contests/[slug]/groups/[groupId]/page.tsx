import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicGroup } from "@/db/public-stories";
import { CriticatLink } from "@/components/criticat-link";
import { AiGeneration } from "@/components/ai-generation";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: "Рассказы группы" };
export default async function GroupPage({ params }: { params: Promise<{ slug: string; groupId: string }> }) {
  const { slug, groupId } = await params; const group = await getPublicGroup(slug, groupId);
  if (!group) notFound();
  return <section><Link className="back-link" href={`/contests/${encodeURIComponent(slug)}#group-${encodeURIComponent(groupId)}`}>← К конкурсу</Link><p className="eyebrow">{group.contestTitle}</p><h1>{group.title}</h1><CriticatLink url={group.criticatDiscussionUrl} group />
    {!group.stories.length && <p className="empty-stories">В группе пока нет доступных для чтения рассказов.</p>}<ul className="story-list">{group.stories.map((s) => <li key={s.id}><div><h3><Link href={`/contests/${encodeURIComponent(slug)}/stories/${encodeURIComponent(s.id)}`}>{s.title}</Link></h3><p className="muted">{s.volume}{s.authorName && ` · ${s.authorName}`}</p><AiGeneration value={s.aiGenerationBasisPoints} /></div><Link href={`/contests/${encodeURIComponent(slug)}/stories/${encodeURIComponent(s.id)}`}>Читать →</Link></li>)}</ul>
  </section>;
}
