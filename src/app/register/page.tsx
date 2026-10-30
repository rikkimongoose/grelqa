import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { safeReturnPath } from "@/lib/return-path";

export const metadata = { title: "Регистрация" };
export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const returnTo = safeReturnPath((await searchParams).returnTo);
  return <section className="auth-page"><p className="eyebrow">Новая глава</p><h1>Регистрация</h1><p>Создайте учётную запись. Для доступа к кабинету потребуется подтвердить email.</p><AuthForm mode="register" returnTo={returnTo} /><p className="auth-links">Уже зарегистрированы? <Link href={returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login"}>Войти</Link></p></section>;
}
