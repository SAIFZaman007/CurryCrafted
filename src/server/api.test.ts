import { describe, expect, it } from "vitest";
import { handleApi } from "./handler";

const call = (method: string, path: string, body?: unknown, cookies: Record<string, string> = {}) =>
  handleApi({ method, path, query: new URLSearchParams(), body, cookies });

type Product = { id: number; range: "chilled" | "frozen"; pricePence: number; available: boolean; variants: { id: string; pricePence: number }[] };
const products = async () => ((await call("GET", "/api/catalog/products")).data as { products: Product[] }).products;
const line = (p: Product, qty: number) => ({ key: `p${p.id}:${p.variants[0].id}`, type: "product", productId: p.id, variantId: p.variants[0].id, qty });

describe("storefront API", () => {
  it("is healthy and serves the catalogue", async () => {
    expect((await call("GET", "/api/health")).status).toBe(200);
    const all = await products();
    expect(all.length).toBeGreaterThan(10);
    expect(all.every((p) => p.pricePence > 0 && p.variants.length > 0)).toBe(true);
  });

  it("rejects unknown routes", async () => {
    expect((await call("GET", "/api/nope")).status).toBe(404);
  });

  describe("postcodes", () => {
    it("accepts a chilled-delivery postcode", async () => {
      const r = await call("POST", "/api/postcode", { postcode: "dy9 8du" });
      expect(r.status).toBe(200);
      expect((r.data as { result: { postcode: string; chilled: boolean } }).result).toMatchObject({ postcode: "DY9 8DU", chilled: true });
      expect(r.cookies[0].name).toBe("cc_postcode");
    });
    it("marks other UK postcodes frozen-only", async () => {
      const r = await call("POST", "/api/postcode", { postcode: "SW1A 1AA" });
      expect((r.data as { result: { chilled: boolean; frozen: boolean } }).result).toMatchObject({ chilled: false, frozen: true });
    });
    it("rejects nonsense", async () => {
      expect((await call("POST", "/api/postcode", { postcode: "nope" })).status).toBe(422);
    });
  });

  describe("basket quote", () => {
    it("blocks an empty basket", async () => {
      const q = (await call("POST", "/api/cart/quote", { lines: [] })).data as { quote: { canCheckout: boolean; blockers: string[] } };
      expect(q.quote.canCheckout).toBe(false);
      expect(q.quote.blockers.length).toBeGreaterThan(0);
    });
    it("ignores client-supplied prices and enforces the chilled minimum", async () => {
      const chilled = (await products()).find((p) => p.range === "chilled" && p.available)!;
      const q = (await call("POST", "/api/cart/quote", { lines: [{ ...line(chilled, 1), unitPricePence: 1 }], postcode: "DY9 8DU" })).data as {
        quote: { subtotalPence: number; canCheckout: boolean };
      };
      expect(q.quote.subtotalPence).toBe(chilled.variants[0].pricePence);
      expect(q.quote.canCheckout).toBe(false); // below the £20 minimum
    });
    it("allows checkout once the minimum is met", async () => {
      const chilled = (await products()).find((p) => p.range === "chilled" && p.available)!;
      const qty = Math.ceil(2000 / chilled.variants[0].pricePence);
      const q = (await call("POST", "/api/cart/quote", { lines: [line(chilled, qty)], postcode: "DY9 8DU" })).data as { quote: { canCheckout: boolean } };
      expect(q.quote.canCheckout).toBe(true);
    });
    it("won't deliver chilled food outside the chilled area", async () => {
      const chilled = (await products()).find((p) => p.range === "chilled" && p.available)!;
      const q = (await call("POST", "/api/cart/quote", { lines: [line(chilled, 5)], postcode: "SW1A 1AA" })).data as { quote: { canCheckout: boolean } };
      expect(q.quote.canCheckout).toBe(false);
    });
    it("survives malformed input", async () => {
      for (const lines of [null, "x", [null], [{}], [{ type: "product", productId: "abc", qty: -3 }]]) {
        expect((await call("POST", "/api/cart/quote", { lines })).status).toBe(200);
      }
    });
  });

  describe("auth", () => {
    it("signs the demo customer in with a session cookie", async () => {
      const r = await call("POST", "/api/auth/login", { email: "Demo@CurryCrafted.test", password: "Curry1234!" });
      expect(r.status).toBe(200);
      const session = r.cookies.find((c) => c.name === "cc_session");
      expect(session?.value).toBeTruthy();
      const me = await call("GET", "/api/auth/me", undefined, { cc_session: session!.value });
      expect((me.data as { user: { email: string } | null }).user?.email).toBe("demo@currycrafted.test");
    });
    it("gives the same generic error for a wrong password and an unknown email", async () => {
      const wrong = await call("POST", "/api/auth/login", { email: "demo@currycrafted.test", password: "nope" });
      const unknown = await call("POST", "/api/auth/login", { email: "ghost@example.com", password: "nope" });
      expect(wrong.status).toBe(401);
      expect(unknown.data).toEqual(wrong.data);
    });
    it("validates fields", async () => {
      expect((await call("POST", "/api/auth/login", { email: "x", password: "" })).status).toBe(422);
    });
    it("keeps account data private without a session", async () => {
      expect((await call("GET", "/api/account/orders")).status).toBe(401);
      expect((await call("GET", "/api/account/rewards")).status).toBe(401);
    });
  });

  describe("payment", () => {
    it("rejects unknown orders", async () => {
      expect((await call("POST", "/api/checkout/pay", { reference: "CC-NOPE" })).status).toBe(404);
    });
  });
});
