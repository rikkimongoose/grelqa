"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { aiPercentage } from "@/lib/story-annotations";
export function AnnotationForm({ slug, kind, id, initial }: { slug: string; kind: "contest-discussion" | "group-discussion" | "story-ai"; id?: string; initial: string | number | null }) {
  const router = useRouter(); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const ai = kind === "story-ai";
  return <form className="auth-form annotation-form" onSubmit={async (e) => {
    e.preventDefault(); const value = String(new FormData(e.currentTarget).get("value") ?? ""); setBusy(true); setMessage("");
    try { const response = await fetch("/api/manage/annotation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug, annotation: { kind, ...(id ? { id } : {}), value } }) }); const result = await response.json(); setMessage(result.message); if (response.ok) router.refresh(); }
    catch { setMessage("Не удалось сохранить. Введённое значение осталось в форме."); } finally { setBusy(false); }
  }}><label>{ai ? "AI-генерация, %" : kind === "contest-discussion" ? "Ссылка на обсуждение конкурса на Criticat" : "Ссылка на обсуждение группы на Criticat"}<input name="value" type={ai ? "text" : "url"} inputMode={ai ? "decimal" : "url"} maxLength={ai ? 20 : 2048} defaultValue={initial === null ? "" : typeof initial === "number" ? aiPercentage(initial) : initial} /></label>
    <p className="muted">{ai ? "Значение вносится организатором по результату внешней проверки. От 0 до 100, до двух знаков после запятой; не является доказательством использования AI и не влияет на результаты." : "Только HTTPS на criticat.org или www.criticat.org. Обсуждение создаётся отдельно на Criticat."} Чтобы очистить значение, сохраните пустое поле.</p><button className="button" disabled={busy}>Сохранить {ai ? "показатель" : "ссылку"}</button>{message && <p role="status">{message}</p>}</form>;
}
