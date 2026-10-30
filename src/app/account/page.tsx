import { requireVerifiedUser } from "@/auth/session";
export const metadata = { title: "Мой кабинет", robots: { index: false, follow: false } };
export default async function AccountPage() {
  const user = await requireVerifiedUser();
  return <section className="auth-page"><p className="eyebrow">Ваше пространство</p><h1>Мой кабинет</h1><p>Email подтверждён: {user.email}</p><p>Вы вошли в свою учётную запись. Подача рассказов и участие в конкурсах будут добавлены следующим этапом.</p></section>;
}
