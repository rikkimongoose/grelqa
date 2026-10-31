const MAX_BYTES = 180;
function truncate(value: string, bytes: number) {
  let result = "";
  for (const char of value) {
    if (Buffer.byteLength(result + char, "utf8") > bytes) break;
    result += char;
  }
  return result;
}
export function safeBasename(title: string) {
  // Both separators and control characters are data, never archive paths.
  let name = title.normalize("NFC").replace(/[<>:"/\\|?*\p{Cc}\p{Cf}]/gu, "_").trim().replace(/[. ]+$/g, "");
  if (!name || /^\.+$/.test(name)) name = "Без названия";
  if (/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(name)) name = "_" + name;
  return truncate(name, MAX_BYTES).replace(/[. ]+$/g, "") || "Без названия";
}
const key = (name: string) => name.normalize("NFC").toLowerCase();
export function storyFilenames(titles: string[]) {
  const bases = titles.map(safeBasename);
  const reserved = new Set(bases.map(key));
  const used = new Set<string>();
  return bases.map((base) => {
    let name = base;
    if (used.has(key(name))) {
      let suffix = 1;
      do {
        const tail = ` (${suffix++})`;
        name = truncate(base, MAX_BYTES - Buffer.byteLength(tail)).replace(/[. ]+$/g, "") + tail;
      } while (used.has(key(name)) || reserved.has(key(name)));
    }
    used.add(key(name));
    return name + ".md";
  });
}
