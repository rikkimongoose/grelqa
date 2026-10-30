import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Вход" };
export default function LoginPage() {
  return <section className="auth-page"><p className="eyebrow">Рады видеть вас снова</p><h1>Вход</h1><AuthForm mode="login" /><div className="auth-links"><Link href="/forgot-password">Забыли пароль?</Link><Link href="/register">Создать учётную запись</Link></div></section>;
}
