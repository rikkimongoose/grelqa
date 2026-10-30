// Узкий белый список: после входа возвращаем только к выбранному конкурсу.
export function safeReturnPath(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() === value && /^\/contests\/[a-zA-Z0-9_-]+$/.test(value) ? value : undefined;
}
