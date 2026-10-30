import Link from "next/link";
import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Регистрация" };
export default function RegisterPage() {
  return <section className="auth-page"><p className="eyebrow">Новая глава</p><h1>Регистрация</h1><p>Создайте учётную запись. Для доступа к кабинету потребуется подтвердить email.</p><AuthForm mode="register" /><p className="auth-links">Уже зарегистрированы? <Link href="/login">Войти</Link></p></section>;
}
