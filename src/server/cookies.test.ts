import { afterEach, describe, expect, it } from "vitest";
import { parseCookies, serializeCookie } from "./cookies";

const op = { name: "cc_session", value: "a b/c", maxAge: 60 };

describe("cookies", () => {
  afterEach(() => {
    delete process.env.COOKIE_SAMESITE;
  });
  it("round-trips encoded values", () => {
    const header = serializeCookie(op, false).split(";")[0];
    expect(parseCookies(header).cc_session).toBe("a b/c");
  });
  it("is HttpOnly and SameSite=Lax by default, Secure over https", () => {
    expect(serializeCookie(op, false)).toContain("HttpOnly");
    expect(serializeCookie(op, false)).not.toContain("Secure");
    const https = serializeCookie(op, true);
    expect(https).toContain("Secure");
    expect(https).toContain("SameSite=Lax");
  });
  it("only relaxes to SameSite=None when explicitly configured and on https", () => {
    process.env.COOKIE_SAMESITE = "none";
    expect(serializeCookie(op, true)).toContain("SameSite=None");
    expect(serializeCookie(op, false)).toContain("SameSite=Lax");
  });
  it("ignores malformed cookie headers", () => {
    expect(parseCookies("garbage; =x; a=%E0%A4%A")).toMatchObject({ a: "%E0%A4%A" });
    expect(parseCookies(null)).toEqual({});
  });
});
