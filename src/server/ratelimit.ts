/*
 * Fixed-window, in-memory rate limiter. Enough to blunt credential stuffing and scripted abuse on a single instance.
 * Running several instances? Swap `hit` for a shared store (Redis, Upstash, your CDN's rate limiting): the call site stays the same.
 */
type Bucket = { count: number; resetAt: number };
const g = globalThis as typeof globalThis & { __ccRate?: Map<string, Bucket> };
const buckets = (g.__ccRate ??= new Map<string, Bucket>());

export type RateResult = { ok: boolean; remaining: number; retryAfter: number };

export function hit(key: string, limit: number, windowMs: number, now = Date.now()): RateResult {
  if (buckets.size > 5000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  return { ok: b.count <= limit, remaining: Math.max(0, limit - b.count), retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
}

/** Best-effort client address behind a proxy/CDN. Only trust x-forwarded-for when you actually run behind one. */
export function clientKey(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || headers.get("x-real-ip") || "local";
}
