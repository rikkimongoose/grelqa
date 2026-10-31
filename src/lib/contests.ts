// Общие типы и подписи интерфейса. Секретных и демонстрационных данных здесь нет.
export type Stage = "preparation" | "submissions" | "moderation" | "round-one" | "round-two" | "completed" | "failed";

export const stageLabels: Record<Stage, string> = {
  preparation: "Подготовка",
  submissions: "Приём работ",
  moderation: "Модерация",
  "round-one": "Первый тур",
  "round-two": "Второй тур",
  completed: "Завершён",
  failed: "Не состоялся",
};

type ScheduleItem = { stage: Stage; label: string; date: string };
export type Contest = {
  slug: string;
  number: string;
  title: string;
  description: string;
  theme: string | null;
  stage: Stage;
  length: string;
  conditions: string[];
  schedule: ScheduleItem[];
  isDemo?: boolean;
  failureMessage?: string | null;
};

export function formatDate(date: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow",
  }).format(new Date(date));
}
