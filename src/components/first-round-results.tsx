import { AiGeneration } from "@/components/ai-generation";
import { publicFinalResults } from "@/contests/final-results-queries";
import Link from "next/link";
import { publicFinalStatus } from "@/contests/final-queries";
import { publicFirstRoundResults } from "@/contests/results-queries";
import { formatDate } from "@/lib/contests";

export async function FirstRoundResults({ slug }: { slug: string }) {
  const result = await publicFirstRoundResults(slug);
  if (!result) return null;
  const final = await publicFinalStatus(slug);
  const completed = await publicFinalResults(slug);
  const shared = result.groups.some((group) => group.stories.some((story) => story.shared));
  return <section id="round-one-results" className="round-results" aria-labelledby="results-title"><p className="eyebrow">Тур закрыт</p><h2 id="results-title">Итоги первого тура</h2>
    <p className="muted">Зафиксированы <time dateTime={result.closedAt}>{formatDate(result.closedAt)}</time> (МСК).</p>
    {result.failed ? <p className="empty-stories">Конкурс не состоялся. {result.failureMessage} Победители и финалисты не объявляются.</p> : <p>{result.singleRound ? "Единственный тур завершён. Итоговые места опубликованы." : `Первый тур завершён. Квота каждой группы — ${result.quota}. ${completed?.round === 2 ? "Финальный тур завершён; окончательные итоги приведены отдельно." : final ? "Финальный тур подготовлен." : "Состав финала определён; финальное голосование пока не запущено."}`} {completed && !completed.failed ? "Авторство раскрыто в окончательных итогах и доступных рассказах." : "Авторство остаётся скрытым."} Чужие бюллетени не публикуются.</p>}
    {shared && <p className="muted">Разделённое место означает полное равенство после сравнения баллов, количества мест 1–6 и длины. Следующее место не пропускается. Историческая аналогия совместной награды — разделённые Нобелевские премии по литературе <a href="https://www.nobelprize.org/prizes/facts/facts-on-the-nobel-prize-in-literature/">1904, 1917, 1966 и 1974 годов</a>. Это пример совместной награды, а не свидетельство равенства баллов или применения нашего алгоритма.</p>}
    {result.groups.map((group) => <section key={group.key}><h3>Группа {group.number}</h3><div className="results-scroll"><table><caption className="sr-only">Итоги первого тура, группа {group.number}</caption><thead><tr><th scope="col">Место</th><th scope="col">Рассказ</th><th scope="col">Баллы</th><th scope="col">Статус</th></tr></thead><tbody>
      {group.stories.map((story) => <tr key={story.id}><td>{story.place ?? "—"}{story.shared && <span> · разделённое</span>}</td><th scope="row">{story.readable ? <Link href={`/contests/${encodeURIComponent(slug)}/stories/${encodeURIComponent(story.id)}`}>{story.title}</Link> : story.title}<AiGeneration value={story.aiGenerationBasisPoints} /></th><td>{story.points ?? "—"}</td><td>{story.withdrawalMessage ?? (story.finalist ? "Выход в финал" : result.failed ? "Конкурс не состоялся" : result.singleRound ? "Тур завершён" : "Не прошёл в финал")}</td></tr>)}
    </tbody></table></div></section>)}
  </section>;
}
