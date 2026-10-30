// Вымышленные публичные данные. Этапы заданы вручную, переходов по времени нет.
export type Stage = "preparation" | "submissions" | "moderation" | "round-one" | "round-two" | "completed";

export const stageLabels: Record<Stage, string> = {
  preparation: "Подготовка",
  submissions: "Приём работ",
  moderation: "Модерация",
  "round-one": "Первый тур",
  "round-two": "Второй тур",
  completed: "Завершён",
};

type ScheduleItem = { stage: Stage; label: string; date: string };
type Contest = {
  slug: string;
  number: string;
  title: string;
  description: string;
  theme: string | null;
  stage: Stage;
  length: string;
  conditions: string[];
  schedule: ScheduleItem[];
};

export const contests: Contest[] = [
  {
    slug: "letters-to-november",
    number: "01",
    title: "Письма ноябрю",
    description: "Истории о том, что остаётся с нами, когда город становится тише.",
    theme: "Письмо, которое пришло слишком рано",
    stage: "submissions",
    length: "От 3 000 до 15 000 знаков с пробелами",
    conditions: ["Напишите рассказ, в котором письмо меняет привычный ход событий.", "Жанр и язык произведения — на ваш выбор.", "Название и текст подаются отдельно. Соблюдайте анонимность произведения."],
    schedule: [
      { stage: "preparation", label: "Подготовка", date: "2026-10-25T15:00:00+03:00" },
      { stage: "submissions", label: "Начало приёма работ", date: "2026-10-30T15:00:00+03:00" },
      { stage: "moderation", label: "Окончание приёма · модерация", date: "2026-11-13T15:00:00+03:00" },
      { stage: "round-one", label: "Первый тур", date: "2026-11-15T15:00:00+03:00" },
      { stage: "round-two", label: "Второй тур, если будет несколько групп", date: "2026-11-22T15:00:00+03:00" },
      { stage: "completed", label: "Завершение", date: "2026-11-29T15:00:00+03:00" },
    ],
  },
  {
    slug: "city-between-lines",
    number: "02",
    title: "Город между строк",
    description: "Знакомые улицы, незнакомые голоса и одна история на перекрёстке.",
    theme: "Улица, которой нет на карте",
    stage: "round-one",
    length: "От 5 000 до 20 000 знаков с пробелами",
    conditions: ["Место действия — вымышленный город.", "В рассказе должна появиться улица, отсутствующая на картах.", "Сохраняйте анонимность до окончания голосования по всему конкурсу."],
    schedule: [
      { stage: "submissions", label: "Начало приёма работ", date: "2026-10-09T15:00:00+03:00" },
      { stage: "moderation", label: "Окончание приёма · модерация", date: "2026-10-23T15:00:00+03:00" },
      { stage: "round-one", label: "Первый тур", date: "2026-10-25T15:00:00+03:00" },
      { stage: "round-two", label: "Второй тур, если будет несколько групп", date: "2026-11-01T15:00:00+03:00" },
      { stage: "completed", label: "Завершение", date: "2026-11-08T15:00:00+03:00" },
    ],
  },
  {
    slug: "winter-notebook",
    number: "03",
    title: "Зимняя тетрадь",
    description: "Новая страница для историй, которым ещё предстоит случиться.",
    theme: null,
    stage: "preparation",
    length: "От 3 000 до 12 000 знаков с пробелами",
    conditions: ["Тема и дополнительные условия будут опубликованы при старте конкурса."],
    schedule: [
      { stage: "preparation", label: "Подготовка", date: "2026-10-30T15:00:00+03:00" },
      { stage: "submissions", label: "Начало приёма работ", date: "2026-12-01T15:00:00+03:00" },
      { stage: "moderation", label: "Окончание приёма · модерация", date: "2026-12-15T15:00:00+03:00" },
      { stage: "round-one", label: "Первый тур", date: "2026-12-17T15:00:00+03:00" },
      { stage: "round-two", label: "Второй тур, если будет несколько групп", date: "2026-12-24T15:00:00+03:00" },
      { stage: "completed", label: "Завершение", date: "2026-12-31T15:00:00+03:00" },
    ],
  },
];

export function formatDate(date: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow",
  }).format(new Date(date));
}
