"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function WithdrawStory({ id, revision }: { id: string; revision: number }) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();
  async function withdraw(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const response = await fetch("/api/stories/withdraw", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, revision, confirmed }) });
      const result = await response.json(); setMessage(result.message);
      if (response.ok) { setConfirmed(false); router.refresh(); }
    } catch { setMessage("Ошибка сети. Обновите страницу, чтобы проверить состояние работы."); }
    finally { setBusy(false); }
  }
  return <form className="withdraw-form" onSubmit={withdraw}><h2>Снять работу</h2><p>Текст и история сохранятся. Во время тура баллы за снятую работу теряются, остальные позиции бюллетеней не сдвигаются. Восстановление сейчас недоступно.</p><label><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} required /> Я понимаю последствия и подтверждаю снятие работы</label><button type="submit" disabled={!confirmed || busy}>{busy ? "Подождите…" : "Снять работу"}</button>{message && <p role="status">{message}</p>}</form>;
}
