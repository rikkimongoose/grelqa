export type GroupPlan = { number: number; capacity: number; storyIds: string[] }[];
export type FormationSnapshot = {
  version: "unambiguous-single-group-v1" | "size-blocks-v2";
  formedAt: string;
  eligibleCount: number;
  authorCount: number;
  originalCapacity: number;
  effectiveCapacity: number;
  groups: { id: string; number: number; capacity: number; storyIds: string[] }[];
  assignments: { participationId: string; groupId: string; selectedStoryId?: string }[];
};

export type FailureCode = "no-stories" | "one-story" | "one-author" | "theme-late";
export type FailureSnapshot = {
  kind: "failed";
  version: "admitted-viability-v1";
  checkedAt: string;
  admittedCount: number;
  admittedAuthorCount: number;
  reasons: FailureCode[];
};
export type FirstRoundOutcome = FormationSnapshot | FailureSnapshot;
export function isFailureSnapshot(snapshot: FirstRoundOutcome): snapshot is FailureSnapshot {
  return "kind" in snapshot && snapshot.kind === "failed";
}

export type RankedStory = { id: string; title: string; createdAt: Date; length: number | null; lengthAlgorithm: string | null };
const titles = new Intl.Collator("ru", { usage: "sort", sensitivity: "variant", numeric: false });
const stableId = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function secondaryOrder(a: RankedStory, b: RankedStory) {
  return +a.createdAt - +b.createdAt || titles.compare(a.title, b.title) || stableId(a.id, b.id);
}
function comparableLengths(rows: RankedStory[]) {
  const algorithms = new Set(rows.map((row) => row.lengthAlgorithm));
  return rows.every((row) => row.length !== null && Number.isSafeInteger(row.length) && row.length >= 0 && Number.isFinite(+row.createdAt)) && algorithms.size === 1 && !algorithms.has(null) && !algorithms.has("");
}

export function selectVotingStory(rows: RankedStory[]) {
  if (!rows.length || !comparableLengths(rows)) return undefined;
  return [...rows].sort((a, b) => b.length! - a.length! || secondaryOrder(a, b))[0];
}

export function balancedBlockPlan(rows: RankedStory[], capacity: number, finalCapacity: number) {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || !Number.isSafeInteger(finalCapacity) || finalCapacity < 1) throw new Error("Некорректная вместимость.");
  if (!rows.length || !comparableLengths(rows)) throw new Error("Нужны заполненные сопоставимые длины одной версии и корректные даты всех допущенных работ.");
  const effectiveCapacity = Math.max(capacity, Math.ceil(rows.length / finalCapacity));
  const count = Math.ceil(rows.length / effectiveCapacity);
  const sorted = [...rows].sort((a, b) => a.length! - b.length! || secondaryOrder(a, b));
  const base = Math.floor(rows.length / count);
  const remainder = rows.length % count;
  let offset = 0;
  const groups: GroupPlan = Array.from({ length: count }, (_, index) => {
    const size = base + (index < remainder ? 1 : 0);
    const storyIds = sorted.slice(offset, offset + size).map((row) => row.id);
    offset += size;
    return { number: index + 1, capacity: effectiveCapacity, storyIds };
  });
  validateGroupPlan(rows.map((row) => row.id), groups, finalCapacity, effectiveCapacity);
  return { effectiveCapacity, groups };
}

export const failureMessages = {
  "no-stories": "Нет конкурсных работ.",
  "one-story": "В конкурсе только одна работа.",
  "one-author": "Все конкурсные работы принадлежат одному автору.",
  "theme-late": "Тема не введена вовремя.",
} as const;

export function publicFailureMessage(reason: string | null) {
  let codes: unknown = reason ? [reason] : [];
  if (reason?.startsWith("[")) { try { codes = JSON.parse(reason); } catch { codes = []; } }
  return Array.isArray(codes) && codes.length > 0 && codes.every((code) => typeof code === "string" && Object.prototype.hasOwnProperty.call(failureMessages, code))
    ? codes.map((code) => failureMessages[code as FailureCode]).join(" ") : "Конкурс не состоялся. Подробности итогов пока не опубликованы.";
}

// Проверяет уже заданный план, но не выбирает случайный/сортированный алгоритм.
export function validateGroupPlan(eligibleIds: string[], plan: GroupPlan, finalCapacity: number, effectiveCapacity: number) {
  if (!Number.isInteger(effectiveCapacity) || effectiveCapacity < 1 || !Number.isInteger(finalCapacity) || finalCapacity < 1) throw new Error("Некорректная вместимость.");
  if (!plan.length || plan.length > finalCapacity) throw new Error("Число групп превышает допустимое число финалистов.");
  const wanted = new Set(eligibleIds);
  if (wanted.size !== eligibleIds.length) throw new Error("Список допущенных работ содержит повторы.");
  const seen = new Set<string>();
  const numbers = new Set<number>();
  for (const group of plan) {
    if (!Number.isInteger(group.number) || group.number < 1 || numbers.has(group.number)) throw new Error("Номера групп должны быть уникальными положительными числами.");
    numbers.add(group.number);
    if (group.capacity !== effectiveCapacity || !group.storyIds.length || group.storyIds.length > group.capacity) throw new Error("Нарушена вместимость группы.");
    for (const id of group.storyIds) {
      if (!wanted.has(id) || seen.has(id)) throw new Error("Работа не допущена или попала в несколько групп.");
      seen.add(id);
    }
  }
  if (seen.size !== wanted.size) throw new Error("Распределены не все допущенные работы.");
  const sizes = plan.map((group) => group.storyIds.length);
  if (Math.max(...sizes) - Math.min(...sizes) > 1) throw new Error("Размеры групп различаются более чем на одну работу.");
}

// Независимый запрет собственного голоса; бюллетеней/приёма голосов здесь нет.
export function isOwnStory(voterUserId: string, authorUserId: string) {
  return voterUserId === authorUserId;
}
