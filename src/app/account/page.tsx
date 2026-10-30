import { requireVerifiedUser } from "@/auth/session";
import Link from "next/link";
export const metadata = { title: "Мой кабинет", robots: { index: false, follow: false } };
export default async function AccountPage() {
  const user = await requireVerifiedUser();
  return <section className="auth-page"><p className="eyebrow">Ваше пространство</p><h1>Мой кабинет</h1><p>Email подтверждён: {user.email}</p><Link className="button" href="/account/my-stories">Мои работы →</Link></section>;
}
