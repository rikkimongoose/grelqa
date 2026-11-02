"use client";
import { AiGeneration } from "./ai-generation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatDate } from "@/lib/contests";
import type { BallotView } from "@/voting/service";

type Choice = BallotView["selected"][number];
export function BallotEditor({ initial }: { initial: BallotView }) {
  const [selected, setSelected] = useState(initial.selected);
  const [revision, setRevision] = useState(initial.revision);
  const [submitted, setSubmitted] = useState(initial.submitted);
  const [submittedAt, setSubmittedAt] = useState(initial.submittedAt);
  const [hasDraft, setHasDraft] = useState(initial.hasDraft);
  const [saved, setSaved] = useState(JSON.stringify(initial.selected.map((item) => item.id)));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const dragged = useRef<number | null>(null);
  const retry = useRef<{ payload: string; id: string } | null>(null);
  const dirty = JSON.stringify(selected.map((item) => item.id)) !== saved;
  const writable = initial.open && !initial.exempt;
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    const click = (event: MouseEvent) => {
      if (dirty && (event.target as Element).closest("a[href]") && !window.confirm("Есть несохранённый выбор. Покинуть страницу?")) event.preventDefault();
    };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", click, true); };
  }, [dirty]);
  function move(from: number, to: number) {
    if (!writable || busy || to < 0 || to >= selected.length) return;
    setSelected((current) => { const next = [...current]; const [entry] = next.splice(from, 1); next.splice(to, 0, entry); return next; });
    setMessage(`Работа перемещена на место ${to + 1}.`);
  }
  async function persist(action: "draft" | "submit") {
    setBusy(true); setMessage("");
    const payload = { round: initial.round, slug: initial.slug, revision, selections: selected.map((entry) => entry.id) };
    const signature = JSON.stringify({ action, ...payload });
    if (retry.current?.payload !== signature) retry.current = { payload: signature, id: crypto.randomUUID() };
    try {
      const response = await fetch(`/api/ballots/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, requestId: retry.current.id }) });
      const data = await response.json();
      setMessage(data.message);
      if (response.ok) {
        setRevision(data.revision); setSaved(JSON.stringify(payload.selections)); setHasDraft(action === "draft"); retry.current = null;
        if (action === "submit") { setSubmitted(selected.map((entry, index) => ({ ...entry, position: index + 1 }))); setSubmittedAt(data.submittedAt); }
      }
    } catch { setMessage("Не удалось получить ответ. Выбор сохранён на странице; повторите тот же запрос."); }
    finally { setBusy(false); }
  }
  const reading = (choice: Choice) => `/contests/${encodeURIComponent(initial.slug)}/stories/${encodeURIComponent(choice.id)}`;
  return <>
    <p>Приём бюллетеней до <time dateTime={initial.deadline}>{formatDate(initial.deadline)}</time> (МСК, UTC+3). В момент дедлайна отправка уже закрыта.</p>
    {initial.blockedMessage && <p role="alert">{initial.blockedMessage}</p>}
    {!initial.open && <p className="empty-stories">{initial.blockedMessage ? "Доступен только просмотр сохранённых версий." : "Голосование ещё не открыто или завершено. Доступен просмотр; изменения запрещены."}</p>}
    {initial.exempt && <p className="empty-stories">Вы освобождены от голосования: в вашем туре нет доступных чужих работ. Отправлять пустой бюллетень не нужно.</p>}
    <section aria-labelledby="submitted-title"><h2 id="submitted-title">Отправленная версия</h2>
      {submittedAt ? <p>Последняя успешная отправка: <time dateTime={submittedAt}>{formatDate(submittedAt)}</time> (МСК).</p> : submitted.length ? <p>Отправка принята. Обновляем время подтверждения…</p> : <p>Бюллетень ещё не отправлен. Черновик не выполняет обязанность голосования.</p>}
      {submitted.length > 0 && <><p>{initial.rightsEnded ? "Сохранена ранее отправленная версия; новые изменения недоступны." : "Бюллетень засчитан. Снятие выбранной работы не отменяет отправку и не сдвигает остальные места."}</p><ol>{submitted.map((item) => <li key={item.id} value={item.position}>{item.title}<AiGeneration value={item.aiGenerationBasisPoints} />{item.unavailable && " — снята или недоступна, баллы не учитываются"}</li>)}</ol></>}
    </section>
    <section aria-labelledby="draft-title"><h2 id="draft-title">{hasDraft ? "Сохранённый черновик" : "Ваш выбор"}{dirty ? " · есть несохранённые изменения" : ""}</h2>
      <p aria-live="polite">Выбрано {selected.length} из {initial.required} необходимых работ.</p>
      <p className="muted">Сохранение черновика не меняет действующую отправленную версию. Для замены нажмите «Отправить бюллетень».</p>
      {selected.some((item) => item.unavailable) && <p role="alert">В выборе есть снятые или недоступные работы. Уберите их перед новой отправкой.</p>}
      <ol className="ballot-choices">{selected.map((item, index) => <li key={item.id} data-story-id={item.id} draggable={writable && !busy}
        onDragStart={(event) => { dragged.current = index; event.dataTransfer.setData("text/plain", item.id); event.dataTransfer.effectAllowed = "move"; }}
        onDragOver={(event) => { if (writable) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); if (dragged.current !== null) move(dragged.current, index); dragged.current = null; }} onDragEnd={() => { dragged.current = null; }}>
        <div>{index + 1}. {item.unavailable ? <span>{item.title} — снята или недоступна</span> : <Link href={reading(item)}>{item.title}</Link>}<AiGeneration value={item.aiGenerationBasisPoints} /></div>
        <div className="ballot-controls"><button type="button" aria-label={`Выше: ${item.title}`} disabled={!writable || busy || index === 0} onClick={() => move(index, index - 1)}>Выше</button><button type="button" aria-label={`Ниже: ${item.title}`} disabled={!writable || busy || index === selected.length - 1} onClick={() => move(index, index + 1)}>Ниже</button><button type="button" aria-label={`Убрать: ${item.title}`} disabled={!writable || busy} onClick={() => setSelected((rows) => rows.filter((row) => row.id !== item.id))}>Убрать</button></div>
      </li>)}</ol>
      {!selected.length && <p className="muted">Пока ничего не выбрано.</p>}
      {writable && <div className="ballot-controls"><button type="button" disabled={busy} onClick={() => persist("draft")}>Сохранить черновик</button><button type="button" disabled={busy} onClick={() => persist("submit")}>Отправить бюллетень</button></div>}
      <p role="status" aria-live="polite">{message}</p>
    </section>
    <section><h2>{initial.round === 2 ? "Доступные финальные рассказы" : "Доступные рассказы назначенной группы"}</h2><p className="muted">Свои работы выбирать нельзя. Порядок можно менять кнопками с клавиатуры или перетаскиванием.</p>
      <ul className="story-list">{initial.available.map((item) => <li key={item.id}><div><Link href={reading({ ...item, position: 0, unavailable: false })}>{item.title}</Link><AiGeneration value={item.aiGenerationBasisPoints} /></div><button type="button" disabled={!writable || busy || selected.length >= 6 || selected.some((entry) => entry.id === item.id)} onClick={() => setSelected((rows) => [...rows, { ...item, position: rows.length + 1, unavailable: false }])}>Добавить<span className="sr-only">: {item.title}</span></button></li>)}</ul>
    </section>
  </>;
}
