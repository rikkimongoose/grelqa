export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { authConfig } = await import("./auth/config");
    authConfig();
  }
}
