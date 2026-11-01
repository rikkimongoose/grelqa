import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPublicStory } from "@/db/public-stories";
import { currentBallot } from "@/voting/current";
import { BallotAdd } from "@/components/ballot-add";
import { StoryText } from "@/components/story-text";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Props = { params: Promise<{ slug: string; storyId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug, storyId } = await params;
  const story = await getPublicStory(slug, storyId);
  if (!story) notFound();
  return { title: story.title, description: `Рассказ конкурса «${story.contestTitle}». Чтение без регистрации.` };
}

export default async function StoryPage({ params }: Props) {
  const { slug, storyId } = await params;
  const story = await getPublicStory(slug, storyId);
  if (!story) notFound();
  const ballot = await currentBallot(slug, 2) ?? await currentBallot(slug);
  const canAdd = ballot?.open && !ballot.exempt && ballot.available.some((item) => item.id === storyId);
  const back = `/contests/${encodeURIComponent(story.contestSlug)}#stories`;
  return <div className="reading-page">
    <Link className="back-link" href={back}>← К рассказам конкурса</Link>
    <article className="reading-article">
      <header className="reading-header"><p className="eyebrow">{story.contestTitle}</p><h1>{story.title}</h1><p className="muted">{story.volume}</p><p className="muted">Анонимный конкурсный рассказ</p></header>
      <StoryText content={story.content} />
    </article>
    {canAdd && <BallotAdd slug={slug} storyId={storyId} initialRevision={ballot!.revision} round={ballot!.round} />}
    <Link className="back-link reading-back" href={back}>← К рассказам конкурса</Link>
  </div>;
}
