"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";

type Mode = "register" | "login" | "resend" | "forgot" | "verify" | "reset";
const labels: Record<Mode, string> = { register: "Зарегистрироваться", login: "Войти", resend: "Отправить письмо ещё раз", forgot: "Отправить инструкцию", verify: "Подтвердить email", reset: "Сохранить новый пароль" };
const subscribeHash = (callback: () => void) => { window.addEventListener("hashchange", callback); return () => window.removeEventListener("hashchange", callback); };
const readToken = () => new URLSearchParams(window.location.hash.slice(1)).get("token") || "";

export function AuthForm({ mode }: { mode: Mode }) {
  const token = useSyncExternalStore(subscribeHash, readToken, () => "");
  const [message, setMessage] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const needsToken = mode === "verify" || mode === "reset";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage(""); setNext("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch(`/api/account/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, token }) });
      const result = await response.json();
      setMessage(result.message || "Проверьте поля формы.");
      if (response.ok) {
        setSuccess(true);
        if (needsToken) window.history.replaceState(null, "", window.location.pathname);
        if ((mode === "register" || mode === "login") && result.redirect) window.location.assign(result.redirect);
        else if (result.redirect) setNext(result.redirect);
      }
    } catch { setMessage("Не удалось связаться с сервером. Попробуйте снова."); }
    finally { setBusy(false); }
  }

  return <form className="auth-form" onSubmit={submit}>
    {(mode === "register" || mode === "login" || mode === "forgot") && <label>Email<input type="email" name="email" required maxLength={254} autoComplete="email" autoCapitalize="none" /></label>}
    {(mode === "register" || mode === "login" || mode === "reset") && <label>{mode === "reset" ? "Новый пароль" : "Пароль"}<input type="password" name="password" required minLength={mode === "login" ? 1 : 12} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>}
    {(mode === "register" || mode === "reset") && <><label>Повторите пароль<input type="password" name="repeatPassword" required minLength={12} maxLength={128} autoComplete="new-password" /></label><p className="muted">От 12 до 128 символов. Можно использовать пробелы и разные языки.</p></>}
    {needsToken && !token && !success && <p role="status">Откройте полную ссылку из письма. Ссылка отсутствует или неверна.</p>}
    <button className="button" type="submit" disabled={busy || (needsToken && (!token || success))}>{busy ? "Подождите…" : labels[mode]}</button>
    {message && <p className="auth-message" role="status">{message}</p>}
    {next && <Link className="text-link" href={next}>{next === "/login" ? "Перейти ко входу" : "Перейти в кабинет"} →</Link>}
    {needsToken && <Link className="text-link" href={mode === "verify" ? "/registration-status" : "/forgot-password"}>Запросить новую ссылку →</Link>}
    <noscript>Для отправки этой формы включите JavaScript.</noscript>
  </form>;
}
