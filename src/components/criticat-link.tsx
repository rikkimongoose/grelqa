export function CriticatLink({ url, group = false }: { url: string | null | undefined; group?: boolean }) {
  return url ? <a className="text-link criticat-link" href={url} target="_blank" rel="noopener noreferrer">{group ? "Обсудить группу на Criticat" : "Обсудить конкурс на Criticat"} ↗</a> : null;
}
