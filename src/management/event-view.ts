const actions: Record<string, string> = { coordinator: "Координатор изменён", create: "Конкурс создан", settings: "Настройки изменены", "issue-theme-link": "Выдана новая ссылка на тему", "theme-entered-by-link": "Тема введена по одноразовой ссылке", publish: "Подготовка опубликована", "start-reception": "Запущен приём", closeReception: "Приём закрыт", formFirstRound: "Проверка и формирование групп", "start-first": "Начат первый тур", closeFirstRound: "Первый тур закрыт", prepareFinal: "Финал подготовлен", finalizeContest: "Сохранён окончательный итог", moderate: "Решение модератора" };
const fields: Record<string, string> = { title: "Название", description: "Описание", discussionUrl: "Обсуждение", submissionsStartAt: "Начало приёма", submissionsEndAt: "Окончание приёма", roundOneStartAt: "Первый тур", roundTwoStartAt: "Финал", endsAt: "Конец голосования", groupCapacity: "Вместимость группы", finalCapacity: "Вместимость финала", minLength: "Минимальный объём", maxLength: "Максимальный объём" };
const statuses: Record<string, string> = { submitted: "подана", admitted: "допущена", rejected: "отклонена", active: "участвует в туре", withdrawn: "снята" };
const value = (v: unknown) => v == null || v === "" ? "не задано" : typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }) + " МСК" : String(v);
export function eventView(action: string, details: Record<string, unknown>, works: { id: string; title: string }[]) {
  const changes: string[] = [];
  if (action === "moderate") {
    changes.push(`${works.find((s) => s.id === details.storyId)?.title ?? "Работа"}${details.round ? `, тур ${details.round}` : ""}: ${statuses[String(details.before)] ?? "—"} → ${statuses[String(details.after)] ?? "—"}`);
    if (typeof details.reason === "string") changes.push(`Причина: ${details.reason}`);
  }
  if (details.after && typeof details.after === "object") {
    const before = details.before && typeof details.before === "object" ? details.before as Record<string, unknown> : {};
    const after = details.after as Record<string, unknown>;
    for (const [key, label] of Object.entries(fields)) if (before[key] !== after[key]) changes.push(`${label}: ${value(before[key])} → ${value(after[key])}`);
  }
  if (details.rolesChanged) changes.push("Состав владельца или координатора обновлён.");
  if (details.expiresAt) changes.push(`Срок ссылки: ${value(details.expiresAt)}`);
  if (details.outcome) changes.push(details.outcome === "failed" ? "Конкурс признан несостоявшимся." : "Группы сформированы и опубликованы.");
  return { label: actions[action] ?? "Административное действие", changes };
}
