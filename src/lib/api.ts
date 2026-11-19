import { headers } from "next/headers";
import { parseCookies } from "@/server/cookies";
import { handleApi } from "@/server/handler";

/*
 * Server-side client for the storefront API, used by server components.
 * The API runs in-process (see src/server), so there is no network hop and no
 * separate service to start. The visitor's cookies are passed along so the API
 * can identify the session; the response shapes are identical to the browser's
 * `/api/*` calls, which are served by app/api/[...path]/route.ts.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public data: Record<string, unknown>,
  ) {
    super(typeof data?.error === "string" ? data.error : `API request failed (${status})`);
  }
}

type Options = { method?: string; body?: unknown; session?: boolean };

export async function apiRequest<T = Record<string, unknown>>(path: string, opts: Options = {}): Promise<{ ok: boolean; status: number; data: T }> {
  const [pathname, search = ""] = path.split("?");
  const cookies = opts.session === false ? {} : parseCookies((await headers()).get("cookie"));
  const res = await handleApi({
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    path: pathname,
    query: new URLSearchParams(search),
    body: opts.body,
    cookies,
  });
  return { ok: res.status >= 200 && res.status < 300, status: res.status, data: res.data as T };
}

export async function getJson<T>(path: string, opts: Options = {}): Promise<T> {
  const res = await apiRequest<T>(path, opts);
  if (!res.ok) throw new ApiError(res.status, res.data as Record<string, unknown>);
  return res.data;
}
