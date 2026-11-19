import { parseCookies, serializeCookie } from "@/server/cookies";
import { handleApi } from "@/server/handler";
import { clientKey, hit } from "@/server/ratelimit";

export const dynamic = "force-dynamic";

/*
 * Browser-facing API. Every /api/* request is answered by the in-process
 * storefront API in src/server: no separate backend, database or Python needed.
 */

type Ctx = { params: Promise<{ path: string[] }> };

const json = (data: unknown, status: number, cookies: string[] = []) => {
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(JSON.stringify(data), { status, headers });
};

const SENSITIVE = /(login|register|password|forgot|reset|promo|payment|referral)/i;

async function serve(req: Request, ctx: Ctx): Promise<Response> {
  const { path } = await ctx.params;
  const url = new URL(req.url);
  const mutating = req.method !== "GET" && req.method !== "HEAD";

  // Same-origin only for anything that changes state (defence in depth on top of the JSON-only rule below).
  if (mutating) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (origin && host) {
      let originHost = "";
      try {
        originHost = new URL(origin).host;
      } catch {}
      if (originHost !== host.split(",")[0].trim()) return json({ error: "Cross-site requests are not allowed." }, 403);
    }
  }

  // Throttle per client: tight on credential and payment routes, generous elsewhere.
  const ip = clientKey(req.headers);
  const tight = mutating && SENSITIVE.test(path.join("/"));
  const rate = tight ? hit(`t:${ip}`, 15, 60_000) : hit(`g:${ip}`, mutating ? 90 : 300, 60_000);
  if (!rate.ok) {
    const res = json({ error: "Too many requests. Please wait a moment and try again." }, 429);
    res.headers.set("retry-after", String(rate.retryAfter));
    return res;
  }

  let body: unknown;
  if (req.method === "POST") {
    // State-changing requests must be JSON: browsers can't send a cross-site JSON POST without a CORS preflight (which is never approved), so this doubles as CSRF protection.
    if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return json({ error: "Invalid request." }, 400);
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid request." }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) return json({ error: "Invalid request." }, 400);
  }

  const https = (req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")).split(",")[0].trim() === "https";
  const result = await handleApi({
    method: req.method,
    path: `/api/${path.join("/")}`,
    query: url.searchParams,
    body,
    cookies: parseCookies(req.headers.get("cookie")),
  });
  return json(result.data, result.status, result.cookies.map((c) => serializeCookie(c, https)));
}

export { serve as GET, serve as POST, serve as PUT, serve as PATCH, serve as DELETE };
