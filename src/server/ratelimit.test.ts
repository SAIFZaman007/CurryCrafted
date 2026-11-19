import { describe, expect, it } from "vitest";
import { clientKey, hit } from "./ratelimit";

describe("rate limiter", () => {
  it("allows up to the limit, then blocks with a retry hint", () => {
    const t = 1_000_000;
    const key = `k-${Math.random()}`;
    for (let i = 0; i < 3; i++) expect(hit(key, 3, 60_000, t).ok).toBe(true);
    const blocked = hit(key, 3, 60_000, t + 1000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBe(59);
  });
  it("opens a fresh window after it expires", () => {
    const key = `k-${Math.random()}`;
    hit(key, 1, 1000, 0);
    expect(hit(key, 1, 1000, 500).ok).toBe(false);
    expect(hit(key, 1, 1000, 1500).ok).toBe(true);
  });
  it("keys clients independently", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientKey(new Headers())).toBe("local");
  });
});
