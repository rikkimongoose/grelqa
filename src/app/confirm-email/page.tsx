import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Подтверждение email", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default function ConfirmEmailPage() {
  return <section className="auth-page"><h1>Подтверждение email</h1><p>Подтвердите действие, чтобы завершить регистрацию.</p><AuthForm mode="verify" /></section>;
}
