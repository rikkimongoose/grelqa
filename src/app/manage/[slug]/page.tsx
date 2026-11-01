import { notFound } from "next/navigation";
import Link from "next/link";
import { cookieSession } from "@/auth/session";
import { managementView } from "@/management/service";
import { ManagementError } from "@/management/access";
import { ContestSettingsForm, CoordinatorForm, ManageCommand, ThemeLinkForm, ModerationForm } from "@/components/manage-forms";
import { StoryText } from "@/components/story-text";
import { parseStoryContent } from "@/lib/story-content";
import { publicFailureMessage } from "@/contests/grouping-rules";
import { storyStatusLabels } from "@/lib/submission";
import { formatDate, stageLabels } from "@/lib/contests";
export const metadata = { title: "Управление конкурсом" };
const localDate = (d: Date | null) => d ? new Date(+d + 3 * 3600000).toISOString().slice(0, 16) : "";
export default async function ManageContestPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const session = await cookieSession();
  let data;
  try { data = await managementView(session.token || "", slug); } catch (e) { if (e instanceof ManagementError) notFound(); throw e; }
  const c = data.contest; const initial = { title: c.title, description: c.description, discussionUrl: c.discussionUrl || "", ownerEmail: data.ownerEmail, coordinatorEmail: data.coordinatorEmail,
    submissionsStartAt: localDate(c.submissionsStartAt), submissionsEndAt: localDate(c.submissionsEndAt), roundOneStartAt: localDate(c.roundOneStartAt), roundTwoStartAt: localDate(c.roundTwoStartAt), endsAt: localDate(c.endsAt), minLength: c.minLength, maxLength: c.maxLength, groupCapacity: c.groupCapacity, finalCapacity: c.finalCapacity };
  return <section className="management"><Link className="back-link" href="/manage">← Управление конкурсами</Link><h1>{c.title}</h1><p>{data.owner ? "Вы — владелец" : "Вы — координатор"}. {c.isDraft ? "Неопубликованная подготовка" : `Этап: ${stageLabels[c.stage]}`}</p>{!c.isDraft && <p><Link href={`/contests/${encodeURIComponent(slug)}`}>Публичная страница →</Link></p>}
    <section><h2>Состояние</h2>{c.stage === "failed" && <p className="empty-stories">Конкурс не состоялся. {publicFailureMessage(c.failureReason)} История сохранена.</p>}<p>Работ: {data.works.length}. Участников: {data.participantCount}. {data.formedAt ? `Группы сформированы: ${formatDate(data.formedAt)}` : "Группы ещё не сформированы."}</p><p>Тема: {data.themeEntered ? "введена" : "ещё не введена"}. До старта её содержание в управлении не показывается.</p>{data.rounds.map((r) => <p key={r.round}>Тур {r.round}: отправлено {r.submitted}, без отправки среди обязанных {r.pending}, освобождены {r.exempt}.</p>)}<ul>{([['Начало приёма', c.submissionsStartAt], ['Окончание приёма', c.submissionsEndAt], ['Первый тур', c.roundOneStartAt], ['Финал', c.roundTwoStartAt], ['Конец голосования', c.endsAt]] as const).map(([title, date]) => date && <li key={title}>{title}: {formatDate(date.toISOString())} МСК (UTC+3)</li>)}</ul></section>
    <section><h2>Настройки</h2>{data.owner && c.isDraft ? <ContestSettingsForm initial={initial} slug={slug} revision={c.settingsRevision} /> : <p>Настройки меняет только владелец до публикации. Расписание, вместимость, объём и правила подсчёта после публикации заблокированы. Количество работ автора не ограничено.</p>}</section>
    {data.owner && !c.isDraft && !["completed", "failed"].includes(c.stage) && <section><h2>Координатор конкурса</h2><CoordinatorForm slug={slug} email={data.coordinatorEmail} revision={c.settingsRevision} /></section>}
    {data.owner && !data.themeEntered && c.stage === "preparation" && <section><h2>Ссылка для ответственного за тему</h2><ThemeLinkForm slug={slug} /></section>}
    <section><h2>Разрешённые операции</h2><p>Это отдельные проверки и переходы вперёд, а не переключатель этапов. Дедлайны не обходятся; опубликованные результаты не перезаписываются.</p>
      {data.owner && c.isDraft && <ManageCommand slug={slug} action="publish" label="Опубликовать подготовку" explanation="Название, описание и расписание станут публичными. Настройки будут заблокированы, тема останется скрытой до старта." />}
      {!c.isDraft && c.stage === "preparation" && <ManageCommand slug={slug} action="start-reception" label="Начать приём" explanation="Доступно с начала приёма по расписанию. Без своевременно введённой темы конкурс признаётся несостоявшимся." />}
      {c.stage === "submissions" && <ManageCommand slug={slug} action="close-reception" label="Закрыть приём" explanation="Только после дедлайна приёма. Переводит конкурс к модерации; ничего не допускает автоматически." />}
      {c.stage === "moderation" && <><ManageCommand slug={slug} action="form" label="Сформировать группы" explanation="Все submitted должны быть проверены. Публикуются допущенные работы и назначения; неудавшийся конкурс сохраняется с причиной. Повторный запуск возвращает прежнее распределение." /><ManageCommand slug={slug} action="start-first" label="Начать первый тур" explanation="Только с начала тура, после успешного формирования групп. Редактирование рассказов не открывается." /></>}
      {c.stage === "round-one" && <><ManageCommand slug={slug} action="close-first" label="Закрыть первый тур" explanation="После дедлайна: непроголосовавшие обязанные авторы теряют все работы текущего тура. Фиксируются неизменяемые результаты и состав финала." /><ManageCommand slug={slug} action="prepare-final" label="Подготовить финал" explanation="Только из успешного закрытого многогруппового первого тура, до конца конкурса. Голосование открывается по расписанию." /></>}
      {["round-two", "completed", "failed"].includes(c.stage) && <ManageCommand slug={slug} action="finalize" label="Завершить и опубликовать итог" explanation="После дедлайна: финальные санкции, неизменяемые места и победители; успешный итог раскрывает публичные имена неснятых работ. Единственный тур не пересчитывается. Повторный запуск возвращает прежний итог." />}
    </section>
    <section><h2>Анонимная модерация</h2><p>Авторство и чужие бюллетени здесь не показываются. Текст модератор не редактирует.</p>{!data.works.length && <p>Работ пока нет.</p>}{data.works.map((story) => { const content = parseStoryContent(story.content); return <details className="moderation-story" key={story.id}><summary>{story.title} · {story.length ?? "объём неизвестен"} · {storyStatusLabels[story.status]}</summary>{content && <StoryText content={content} />}<ModerationForm slug={slug} storyId={story.id} submitted={!c.isDraft && c.stage === "moderation" && !data.formedAt && story.status === "submitted"} withdrawable={["round-one", "round-two"].includes(c.stage) && story.status === "admitted"} /></details>; })}</section>
    <section><h2>Журнал</h2>{!data.events.length && <p>Новых административных событий пока нет.</p>}<ol>{data.events.map((e, i) => <li key={`${e.at}-${i}`}><time dateTime={e.at}>{formatDate(e.at)}</time> · {e.actor} · {e.label}{e.changes.length > 0 && <ul>{e.changes.map((change, index) => <li key={index}>{change}</li>)}</ul>}</li>)}</ol></section>
  </section>;
}
