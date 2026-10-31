// XML 1.0 text/attribute escaping, including invalid legacy control characters/surrogates.
export function xml(value: string) {
  return value.replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
export const declaration = '<?xml version="1.0" encoding="UTF-8"?>\n';
