import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { safeReturnPath } from "@/lib/return-path";

export const metadata = { title: "Вход" };
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const returnTo = safeReturnPath((await searchParams).returnTo);
  return <section className="auth-page"><p className="eyebrow">Рады видеть вас снова</p><h1>Вход</h1><AuthForm mode="login" returnTo={returnTo} /><div className="auth-links"><Link href="/forgot-password">Забыли пароль?</Link><Link href={returnTo ? `/register?returnTo=${encodeURIComponent(returnTo)}` : "/register"}>Создать учётную запись</Link></div></section>;
}
