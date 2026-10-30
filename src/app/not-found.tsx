import Link from "next/link";

export default function NotFound() {
  return <section className="hero"><p className="eyebrow">404 · Страница не найдена</p><h1>Этот лист пока пуст.</h1><p className="hero-copy">Возможно, адрес изменился. Остальные истории ждут на главной.</p><Link className="button" href="/">К конкурсам →</Link></section>;
}
