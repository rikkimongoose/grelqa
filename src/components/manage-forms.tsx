"use client";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import type { SettingsInput } from "@/management/settings";
async function post(action: string, data: unknown) {
  const response = await fetch(`/api/manage/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || "Не удалось выполнить действие.");
  return result;
}
export function ContestSettingsForm({ initial, slug, revision }: { initial: SettingsInput; slug?: string; revision?: number }) {
  const router = useRouter();
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const settings = Object.fromEntries(new FormData(event.currentTarget));
    for (const key of ["groupCapacity", "finalCapacity", "minLength", "maxLength"]) Object.assign(settings, { [key]: Number(settings[key]) });
    try { const result = await post("save", { settings, slug, revision }); router.push(`/manage/${encodeURIComponent(result.slug)}`); router.refresh(); }
    catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  }
  return <form className="auth-form manage-form" onSubmit={submit}><label>Название<input name="title" defaultValue={initial.title} required maxLength={200} /></label><label>Описание<textarea name="description" defaultValue={initial.description} required maxLength={10000} rows={5} /></label><label>Ссылка на обсуждение<input type="url" name="discussionUrl" defaultValue={initial.discussionUrl} /></label>
    <label>Ссылка на обсуждение конкурса на Criticat<input name="criticatDiscussionUrl" type="url" defaultValue={initial.criticatDiscussionUrl ?? ""} maxLength={2048} /></label><label>Email владельца<input name="ownerEmail" type="email" defaultValue={initial.ownerEmail} required readOnly={!slug} /></label><label>Email координатора (необязательно)<input name="coordinatorEmail" type="email" defaultValue={initial.coordinatorEmail} /></label>
    <p className="muted">Все даты и время — Москва (МСК, UTC+3). Начало приёма — 15:00. Изменения после публикации запрещены.</p>
    {([['submissionsStartAt', 'Начало приёма'], ['submissionsEndAt', 'Окончание приёма'], ['roundOneStartAt', 'Начало первого тура'], ['roundTwoStartAt', 'Резервное начало финала'], ['endsAt', 'Завершение голосования']] as const).map(([name, label]) => <label key={name}>{label}<input type="datetime-local" name={name} defaultValue={initial[name]} required /></label>)}
    {([['minLength', 'Минимум знаков с пробелами (0 — нет)'], ['maxLength', 'Максимум знаков с пробелами (0 — нет)'], ['groupCapacity', 'Вместимость группы'], ['finalCapacity', 'Вместимость финала']] as const).map(([name, label]) => <label key={name}>{label}<input type="number" name={name} defaultValue={initial[name]} min={name.endsWith("Capacity") ? 1 : 0} required /></label>)}
    <p>Резервная дата финала нужна на случай нескольких групп. При одной группе конкурс завершается итогом первого тура без фиктивного финала. Количество работ одного автора не ограничено по действующим правилам. Шкала баллов и критерии мест фиксированы.</p><button className="button" disabled={busy}>Сохранить настройки</button>{message && <p role="status">{message}</p>}</form>;
}
export function ManageCommand({ slug, action, label, explanation }: { slug: string; action: string; label: string; explanation: string }) {
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  return <form className="auth-form manage-command" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setMessage(""); try { const r = await post(action, { slug, confirmed: true }); setMessage(r.message); } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); } }}><p>{explanation}</p><label className="confirmation"><input type="checkbox" required /> Подтверждаю действие и его последствия</label><button className="button" disabled={busy}>{label}</button>{message && <p role="status">{message} <a href={`/manage/${encodeURIComponent(slug)}`}>Обновить состояние →</a></p>}</form>;
}
export function ThemeLinkForm({ slug }: { slug: string }) {
  const [link, setLink] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  return <form className="auth-form" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setLink(""); try { const r = await post("theme-link", { slug }); setLink(r.link); setMessage(`Ссылка действует до ${new Date(r.expiresAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} МСК. Прежняя неиспользованная ссылка отозвана.`); } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); } }}><p>Передайте ссылку ответственному вручную. Она показывается только сейчас, не сохраняется в браузере и не отправляется почтой.</p><button className="button" disabled={busy}>Выдать новую одноразовую ссылку</button>{link && <label>Скопируйте секретную ссылку<input readOnly value={link} onFocus={(e) => e.currentTarget.select()} /></label>}{message && <p role="status">{message}</p>}</form>;
}
export function ModerationForm({ slug, storyId, submitted, withdrawable }: { slug: string; storyId: string; submitted: boolean; withdrawable: boolean }) {
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  if (!submitted && !withdrawable) return <p className="muted">Изменение статуса на этом этапе недоступно. Восстановления и редактирования текста нет.</p>;
  return <form className="auth-form" onSubmit={async (e) => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget)); setBusy(true); try { const r = await post("moderate", { slug, storyId, decision: data.decision, reason: data.reason, confirmed: true }); setMessage(r.message); } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); } }}>
    <label>Решение<select name="decision" aria-label="Решение">{submitted && <><option value="admit">Допустить</option><option value="reject">Отклонить</option></>}{withdrawable && <option value="withdraw">Снять с текущего тура</option>}</select></label><label>Причина<textarea name="reason" required maxLength={2000} /></label><label className="confirmation"><input type="checkbox" required /> Подтверждаю решение. История сохранится; снятые баллы не перераспределяются, восстановления нет.</label><button className="button" disabled={busy}>Сохранить решение</button>{message && <p role="status">{message} <a href={`/manage/${encodeURIComponent(slug)}`}>Обновить список →</a></p>}</form>;
}
const subscribe = (fn: () => void) => { window.addEventListener("hashchange", fn); return () => window.removeEventListener("hashchange", fn); };
export function EnterThemeForm() {
  const token = useSyncExternalStore(subscribe, () => new URLSearchParams(window.location.hash.slice(1)).get("token") || "", () => "");
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false); const [success, setSuccess] = useState(false);
  return <form className="auth-form" onSubmit={async (e) => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget)); setBusy(true); try { const r = await post("enter-theme", { token, theme: data.theme, conditions: String(data.conditions).split(/\r?\n/).map((s) => s.trim()).filter(Boolean) }); setMessage(r.message); setSuccess(true); window.history.replaceState(null, "", "/enter-theme"); } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); } }}>
    <p>Вход в аккаунт не требуется. Тема и условия вводятся один раз до начала приёма; затем доступ по ссылке прекращается.</p><label>Тема<textarea name="theme" required maxLength={4000} /></label><label>Дополнительные условия, по одному на строку<textarea name="conditions" maxLength={60000} rows={6} /></label><button className="button" disabled={busy || success || !token}>Передать тему</button>{!token && !success && <p>Откройте полную одноразовую ссылку от владельца конкурса.</p>}{message && <p role="status">{message}</p>}</form>;
}

export function CoordinatorForm({ slug, email, revision }: { slug: string; email: string; revision: number }) {
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  return <form className="auth-form" onSubmit={async (e) => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget)); setBusy(true); try { const r = await post("coordinator", { slug, revision, email: String(data.email).trim().toLowerCase(), confirmed: true }); setMessage(r.message); } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); } }}><label>Email координатора (пустое поле снимает назначение)<input type="email" name="email" defaultValue={email} /></label><label className="confirmation"><input type="checkbox" required /> Подтверждаю смену доступа. Прежний координатор потеряет права.</label><button className="button" disabled={busy}>Назначить координатора</button>{message && <p role="status">{message} <a href={`/manage/${encodeURIComponent(slug)}`}>Обновить состояние →</a></p>}</form>;
}
