import "server-only";

// Operator-supplied URL of the Corresponding Source of this deployed version.
// No inference from Git remotes, package metadata, APP_URL or an upstream repository.
export function sourceCodeUrl(): string | undefined {
  const value = process.env.SOURCE_CODE_URL?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined; }
}
