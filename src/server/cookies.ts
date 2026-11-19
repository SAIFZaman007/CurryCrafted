import type { CookieOp } from "./handler";

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    const raw = part.slice(i + 1).trim();
    try {
      jar[name] = decodeURIComponent(raw);
    } catch {
      jar[name] = raw;
    }
  }
  return jar;
}

/**
 * HttpOnly, path-wide cookie. SameSite=Lax by default (CSRF-safe and fine for normal navigation).
 * Set COOKIE_SAMESITE=none only if the storefront must run inside a third-party iframe (needs https).
 */
export function serializeCookie(c: CookieOp, https: boolean): string {
  const embedded = process.env.COOKIE_SAMESITE?.toLowerCase() === "none" && https;
  const attrs = [`${c.name}=${encodeURIComponent(c.value)}`, "Path=/", `Max-Age=${c.maxAge}`, "HttpOnly", embedded ? "SameSite=None" : "SameSite=Lax"];
  if (https) attrs.push("Secure");
  return attrs.join("; ");
}
