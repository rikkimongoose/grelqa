import { EnterThemeForm } from "@/components/manage-forms";
export const dynamic = "force-dynamic";
export const metadata = { title: "Одноразовый ввод темы", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export default function EnterThemePage() { return <section className="auth-page"><h1>Тема конкурса</h1><EnterThemeForm /></section>; }
