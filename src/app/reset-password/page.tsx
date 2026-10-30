import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Новый пароль", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default function ResetPage() {
  return <section className="auth-page"><h1>Новый пароль</h1><p>После смены пароля потребуется войти заново на всех устройствах.</p><AuthForm mode="reset" /></section>;
}
