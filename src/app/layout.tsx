import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { sourceCodeUrl } from "@/server/source-code";
import { currentUser } from "@/auth/session";

export const metadata: Metadata = {
  title: { default: "Grelqa — истории начинаются здесь", template: "%s · Grelqa" },
  description: "Анонимные литературные конкурсы. Демонстрационный прототип Grelqa.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await currentUser();
  const sourceUrl = sourceCodeUrl();
  return (
    <html lang="ru">
      <head>
        <link rel="alternate" type="application/rss+xml" title="Рваная Грелка — RSS" href="/rss.xml" />
        <link rel="alternate" type="application/atom+xml" title="Рваная Грелка — Atom" href="/atom.xml" />
      </head>
      <body>
        <a className="skip-link" href="#main">К содержимому</a>
        <header className="site-header wrap">
          <Link href="/" className="brand" aria-label="Grelqa — главная">grelqa<span aria-hidden="true">.</span></Link>
          <nav className="main-nav" aria-label="Основная навигация"><Link href="/#contests">Конкурсы</Link><Link href="/rules">Правила</Link>{user?.emailVerifiedAt && <><Link href="/account/my-stories">Мои работы</Link><Link href="/manage">Управление</Link></>}</nav>
          <div className="header-account">{user ? <><Link href={user.emailVerifiedAt ? "/account" : "/registration-status"}>{user.emailVerifiedAt ? "Мой кабинет" : "Подтвердить email"}</Link><form action="/api/account/logout" method="post"><button type="submit" className="logout-button">Выйти</button></form></> : <><Link href="/login">Войти</Link><Link href="/register">Регистрация</Link></>}</div>
        </header>
        <main id="main" className="wrap">{children}</main>
        <footer className="site-footer wrap"><span className="footer-brand">grelqa.</span><p>Место для слов, которые стоит написать.</p><nav aria-label="Ленты конкурсов"><a href="/rss.xml">RSS</a>{" · "}<a href="/atom.xml">Atom</a></nav>{sourceUrl && <a href={sourceUrl} rel="noopener noreferrer">Исходный код</a>}<span>Все конкурсы вымышлены.</span></footer>
      </body>
    </html>
  );
}
