import { AuthForm } from "@/components/auth-form";
export const metadata = { title: "Восстановление доступа" };
export default function ForgotPage() {
  return <section className="auth-page"><h1>Восстановить доступ</h1><p>Укажите email. Если учётная запись существует, мы отправим ссылку для установки нового пароля.</p><AuthForm mode="forgot" /></section>;
}
