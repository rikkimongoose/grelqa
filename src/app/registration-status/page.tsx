import { redirect } from "next/navigation";
import { currentUser } from "@/auth/session";
import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Подтверждение регистрации", robots: { index: false, follow: false } };
export default async function RegistrationStatus({ searchParams }: { searchParams: Promise<{ delivery?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.emailVerifiedAt) redirect("/account");
  const deliveryFailed = (await searchParams).delivery === "failed";
  return <section className="auth-page"><p className="eyebrow">Остался один шаг</p><h1>Проверьте почту</h1>{deliveryFailed && <p className="auth-message" role="status">Регистрация сохранена, но письмо не удалось отправить. Повторите отправку ниже.</p>}<p>Адрес подтверждения: {user.email}. Откройте ссылку из письма и нажмите «Подтвердить email».</p><p>До подтверждения доступны состояние регистрации, повторная отправка и выход. Кабинет и участие в конкурсах закрыты. Публичные рассказы по-прежнему можно читать без регистрации.</p><AuthForm mode="resend" /></section>;
}
