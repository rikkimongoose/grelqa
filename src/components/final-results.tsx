import Link from "next/link";
import { publicFinalResults } from "@/contests/final-results-queries";
import { formatDate } from "@/lib/contests";
export async function FinalResults({ slug }: { slug: string }) {
  const result = await publicFinalResults(slug);
  if (!result) return null;
  return <section id="final-results" className="round-results" aria-labelledby="final-results-title"><p className="eyebrow">Конкурс завершён</p><h2 id="final-results-title">Окончательные итоги</h2>
    <p>Зафиксированы <time dateTime={result.completedAt}>{formatDate(result.completedAt)}</time> (МСК).</p>
    {result.failed ? <p className="empty-stories">Конкурс не состоялся. {result.failureMessage} Победители не объявляются, авторство не раскрывается.</p> : <p>{result.round === 1 ? "Итог единственного тура, без повторного подсчёта." : "Итог финального тура; баллы первого тура не прибавляются."} Победители — работы на первом месте. При полном равенстве место разделяется; следующее место не пропускается. Чужие бюллетени пока не публикуются.</p>}
    <div className="results-scroll"><table><caption className="sr-only">Окончательные результаты конкурса</caption><thead><tr><th scope="col">Место</th><th scope="col">Рассказ</th><th scope="col">Автор</th><th scope="col">Баллы</th><th scope="col">Статус</th></tr></thead><tbody>{result.stories.map((s) => <tr key={s.id}><td>{s.place ?? "—"}{s.shared && " · разделённое"}</td><th scope="row">{s.readable ? <Link href={`/contests/${encodeURIComponent(slug)}/stories/${encodeURIComponent(s.id)}`}>{s.title}</Link> : s.title}</th><td>{s.authorName ?? "Не раскрывается"}</td><td>{s.points ?? "—"}</td><td>{s.withdrawalMessage ?? (s.winner ? "Победитель" : result.failed ? "Конкурс не состоялся" : "Тур завершён")}</td></tr>)}</tbody></table></div>
  </section>;
}
