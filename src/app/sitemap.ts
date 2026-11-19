import type { MetadataRoute } from "next";
import { getBundles, getProducts } from "@/lib/catalog";
import { SITE_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

const STATIC = ["", "/shop", "/chilled", "/frozen", "/bundles", "/our-story", "/delivery", "/faqs", "/food-information", "/contact"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products] = await Promise.all([getProducts(), getBundles()]);
  return [
    ...STATIC.map((p) => ({ url: `${SITE_URL}${p}`, changeFrequency: "weekly" as const, priority: p === "" ? 1 : 0.7 })),
    ...products.filter((p) => p.available).map((p) => ({ url: `${SITE_URL}/products/${p.slug}`, changeFrequency: "weekly" as const, priority: 0.6 })),
  ];
}
