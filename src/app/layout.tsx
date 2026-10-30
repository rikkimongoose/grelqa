import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Grelqa — истории начинаются здесь", template: "%s · Grelqa" },
  description: "Анонимные литературные конкурсы. Демонстрационный прототип Grelqa.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        <a className="skip-link" href="#main">К содержимому</a>
        <header className="site-header wrap">
          <Link href="/" className="brand" aria-label="Grelqa — главная">grelqa<span aria-hidden="true">.</span></Link>
          <nav aria-label="Основная навигация"><Link href="/#contests">Конкурсы</Link></nav>
          <span className="prototype">Демонстрационный прототип</span>
        </header>
        <main id="main" className="wrap">{children}</main>
        <footer className="site-footer wrap"><span className="footer-brand">grelqa.</span><p>Место для слов, которые стоит написать.</p><span>Все конкурсы вымышлены.</span></footer>
      </body>
    </html>
  );
}
