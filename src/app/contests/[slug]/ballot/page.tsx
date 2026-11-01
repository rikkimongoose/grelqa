import Link from "next/link";
import { requireVerifiedUser, cookieSession } from "@/auth/session";
import { AuthError } from "@/auth/service";
import { myBallot } from "@/voting/service";
import { BallotEditor } from "@/components/ballot-editor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { title: "Мой бюллетень", robots: { index: false, follow: false } };
export default async function BallotPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireVerifiedUser();
  const { slug } = await params;
  let state;
  try { state = await myBallot((await cookieSession()).token, slug); }
  catch (error) {
    if (error instanceof AuthError) return <section className="auth-page"><h1>Мой бюллетень</h1><p>{error.message}</p><Link href={`/contests/${encodeURIComponent(slug)}`}>К конкурсу</Link></section>;
    throw error;
  }
  return <section className="ballot-page"><Link className="back-link" href={`/contests/${encodeURIComponent(slug)}#group-${state.groupId}`}>← К назначенной группе</Link><p className="eyebrow">Первый тур</p><h1>Мой бюллетень</h1><h2>{state.title}</h2><BallotEditor initial={state} /></section>;
}
