import type { BundleDTO, PostcodeResult, ProductDTO } from "@/lib/types";
import { MAIN_CATEGORIES } from "@/lib/types";
import { db } from "./store";

/* Catalogue reads, postcode eligibility and search. */

export function getProducts(): ProductDTO[] {
  return db()
    .products.filter((p) => p.active)
    .map((p): ProductDTO => {
      const { active, inStock, createdAt, ...rest } = p;
      return {
        ...rest,
        gallery: p.gallery.length ? p.gallery : [p.image],
        pricePence: p.variants[0]?.pricePence ?? 0,
        // Listed products can still be un-purchasable (out of stock).
        available: Boolean(active && inStock && p.variants.length),
        createdAt: createdAt.toISOString(),
      };
    })
    .sort((a, b) => b.popularity - a.popularity);
}

export function getBundles(products: ProductDTO[] = getProducts()): BundleDTO[] {
  return db()
    .bundles.filter((b) => b.active)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((b): BundleDTO => {
      const eligible = products.filter((p) => p.range === b.range && p.available);
      const maxMain = Math.max(0, ...eligible.filter((p) => MAIN_CATEGORIES.includes(p.category)).map((p) => p.pricePence));
      const maxSide = Math.max(0, ...eligible.filter((p) => !MAIN_CATEGORIES.includes(p.category)).map((p) => p.pricePence));
      const maxValue = maxMain * b.mainsCount + maxSide * b.sidesCount;
      return {
        id: b.id,
        slug: b.slug,
        name: b.name,
        description: b.description,
        image: b.image,
        range: b.range,
        serves: b.serves,
        mainsCount: b.mainsCount,
        sidesCount: b.sidesCount,
        pricePence: b.pricePence,
        // Largest possible saving versus buying the same items individually at today's prices.
        saveUpToPence: Math.max(0, maxValue - b.pricePence),
      };
    });
}

export function searchProducts(products: ProductDTO[], query: string): ProductDTO[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const scored: { score: number; p: ProductDTO }[] = [];
  for (const p of products) {
    const name = p.name.toLowerCase();
    const hay = [name, p.category, p.range, p.shortDescription, p.description, p.dietary.join(" "), p.ingredients].join(" ").toLowerCase();
    if (!terms.every((t) => hay.includes(t))) continue;
    const score = terms.reduce((sum, t) => sum + (name.startsWith(t) ? 6 : name.includes(t) ? 4 : p.category.includes(t) || p.range.includes(t) ? 2 : 1), 0);
    scored.push({ score, p });
  }
  scored.sort((a, b) => b.score - a.score || b.p.popularity - a.p.popularity);
  return scored.map((x) => x.p);
}

/* ---------------------------------------------------------------- postcodes */

const UK_POSTCODE = /^([A-Z]{1,2}[0-9][A-Z0-9]?)([0-9][A-Z]{2})$/;

export function parsePostcode(raw: unknown) {
  const compact = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const m = UK_POSTCODE.exec(compact);
  if (!m) return null;
  const [, outward, inward] = m;
  const area = /^[A-Z]+/.exec(outward)![0];
  return { outward, inward, area, formatted: `${outward} ${inward}` };
}

/**
 * Chilled: only postcodes whose outward code (or whole area) is listed.
 * Frozen: UK-wide, unless the area/outward code is excluded or carries a surcharge.
 */
export function checkPostcode(raw: unknown): { valid: false; error: string } | { valid: true; result: PostcodeResult } {
  if (!raw || !String(raw).trim()) return { valid: false, error: "Enter a postcode to check delivery." };
  const parsed = parsePostcode(raw);
  if (!parsed) return { valid: false, error: "That doesn't look like a full UK postcode. Try something like DY9 8DU." };

  const store = db();
  const chilled = store.chilledPostcodes.some((r) => r.active && [parsed.outward, parsed.area].includes(r.prefix.toUpperCase()));
  // The most specific rule wins: an outward code beats its postcode area.
  const restriction =
    store.frozenRestrictions.find((r) => r.prefix.toUpperCase() === parsed.outward) ?? store.frozenRestrictions.find((r) => r.prefix.toUpperCase() === parsed.area);
  const kind = restriction?.kind;
  return {
    valid: true,
    result: {
      postcode: parsed.formatted,
      outward: parsed.outward,
      chilled,
      frozen: kind !== "excluded",
      frozenSurchargePence: kind === "surcharge" ? restriction!.surchargePence : 0,
      frozenNote: restriction?.note || null,
    },
  };
}
