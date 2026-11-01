"use client";
import { useRef, useState } from "react";
export function BallotAdd({ slug, storyId, initialRevision, round = 1 }: { slug: string; storyId: string; initialRevision: number; round?: 1 | 2 }) {
  const [revision, setRevision] = useState(initialRevision);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string | null>(null);
  async function add() {
    setBusy(true); setMessage("");
    requestId.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/ballots/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ round, slug, storyId, revision, requestId: requestId.current }) });
      const data = await response.json(); setMessage(data.message);
      if (response.ok) { setRevision(data.revision); requestId.current = null; }
    } catch { setMessage("Ответ не получен. Можно повторить добавление тем же запросом."); }
    finally { setBusy(false); }
  }
  return <aside className="ballot-add"><button type="button" disabled={busy} onClick={add}>Добавить в мой бюллетень</button><p role="status">{message}</p><a href={`/contests/${encodeURIComponent(slug)}/${round === 2 ? "final-ballot" : "ballot"}`}>Открыть мой бюллетень →</a></aside>;
}
