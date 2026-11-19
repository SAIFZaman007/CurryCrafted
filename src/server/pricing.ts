import type { GroupSummary, PostcodeResult, Quote, QuoteLine, Range } from "@/lib/types";
import { MAIN_CATEGORIES } from "@/lib/types";
import { checkPostcode, getBundles, getProducts } from "./catalog";
import { count, formatPrice, isObject, text, whole } from "./util";
import { db } from "./store";

/*
 * Basket quote: the single source of truth for pricing and eligibility.
 * The browser only ever sends product ids and quantities; names, prices,
 * availability, delivery rules, discounts and totals are all resolved here.
 */

export function getRewardBalance(userId: number): number {
  return Math.max(0, db().rewardTx.filter((t) => t.userId === userId).reduce((sum, t) => sum + t.points, 0));
}

type QuoteInput = { lines: unknown; postcode?: string | null; promoCode?: string | null; redeemPoints?: number | null; userId?: number | null };

export function buildQuote({ lines, postcode, promoCode, redeemPoints = 0, userId = null }: QuoteInput): Quote {
  const config = db().config;
  const products = getProducts();
  const bundles = getBundles(products);
  let pc: PostcodeResult | null = null;
  if (postcode) {
    const checked = checkPostcode(postcode);
    pc = checked.valid ? checked.result : null;
  }
  const productById = new Map(products.map((p) => [p.id, p]));
  const bundleById = new Map(bundles.map((b) => [b.id, b]));

  const out: QuoteLine[] = [];
  const seen = new Set<string>();
  for (const raw of (Array.isArray(lines) ? lines : []).slice(0, 60)) {
    if (!isObject(raw)) continue;
    const key = raw.key;
    if (typeof key !== "string" || seen.has(key)) continue;
    const wanted = whole(raw.qty);
    if (wanted === null || wanted < 1) continue;
    seen.add(key);
    const kind = raw.type;

    const gone: QuoteLine = {
      key,
      type: kind === "bundle" ? "bundle" : "product",
      refId: 0,
      slug: null,
      name: "Item no longer available",
      image: "",
      range: "frozen",
      variantId: null,
      variantLabel: null,
      qty: wanted,
      maxQty: wanted,
      unitPricePence: 0,
      lineTotalPence: 0,
      purchasable: false,
      eligible: false,
      issue: "This item has been removed from our menu.",
      contents: null,
    };

    if (kind === "product") {
      const p = productById.get(whole(raw.productId) ?? -1);
      if (!p) {
        out.push(gone);
        continue;
      }
      const variant = p.variants.find((v) => v.id === raw.variantId) ?? p.variants[0] ?? null;
      const qty = Math.min(wanted, p.maxPerOrder);
      const price = variant?.pricePence ?? 0;
      let issue: string | null = null;
      if (!p.available) issue = "Currently unavailable. Remove this item to continue.";
      else if (wanted > p.maxPerOrder) issue = `Limited to ${p.maxPerOrder} per order.`;
      out.push({
        key,
        type: "product",
        refId: p.id,
        slug: p.slug,
        name: p.name,
        image: p.image,
        range: p.range,
        variantId: variant?.id ?? null,
        variantLabel: variant?.label ?? null,
        qty,
        maxQty: p.maxPerOrder,
        unitPricePence: price,
        lineTotalPence: price * qty,
        purchasable: p.available,
        eligible: true,
        issue,
        contents: null,
      });
    } else if (kind === "bundle") {
      const b = bundleById.get(whole(raw.bundleId) ?? -1);
      if (!b) {
        out.push(gone);
        continue;
      }
      let mains = 0;
      let sides = 0;
      let problem: string | null = null;
      const contents: { productId: number; name: string; qty: number }[] = [];
      for (const sel of Array.isArray(raw.selections) ? raw.selections : []) {
        if (!isObject(sel)) continue;
        const selQty = whole(sel.qty);
        if (selQty === null || selQty <= 0) continue;
        const product = productById.get(whole(sel.productId) ?? -1);
        if (!product || !product.available) {
          problem = "A dish in this bundle is no longer available. Rebuild the bundle to continue.";
          continue;
        }
        // Bundles are never mixed-range: chilled and frozen are fulfilled separately.
        if (product.range !== b.range) {
          problem = `This is a ${b.range} bundle and can only contain ${b.range} dishes.`;
          continue;
        }
        if (MAIN_CATEGORIES.includes(product.category)) mains += selQty;
        else sides += selQty;
        contents.push({ productId: product.id, name: product.name, qty: selQty });
      }
      if (!problem && (mains !== b.mainsCount || sides !== b.sidesCount)) {
        problem = `This bundle needs exactly ${count(b.mainsCount, "main")} and ${count(b.sidesCount, "side")}.`;
      }
      const qty = Math.min(wanted, 6);
      out.push({
        key,
        type: "bundle",
        refId: b.id,
        slug: b.slug,
        name: b.name,
        image: b.image,
        range: b.range,
        variantId: null,
        variantLabel: `${count(b.mainsCount, "main")} + ${count(b.sidesCount, "side")}`,
        qty,
        maxQty: 6,
        unitPricePence: b.pricePence,
        lineTotalPence: b.pricePence * qty,
        purchasable: !problem,
        eligible: true,
        issue: problem,
        contents,
      });
    }
  }

  // Delivery eligibility is validated independently for each range.
  for (const line of out) {
    if (!line.purchasable) continue;
    if (line.range === "chilled") {
      if (!pc) {
        line.eligible = false;
        line.issue ||= "Check your postcode to confirm chilled delivery.";
      } else if (!pc.chilled) {
        line.eligible = false;
        line.issue ||= `Chilled delivery isn't available for ${pc.postcode}.`;
      }
    } else if (pc && !pc.frozen) {
      line.eligible = false;
      line.issue ||= pc.frozenNote || `Frozen delivery isn't available for ${pc.postcode}.`;
    }
  }

  const group = (range: Range): GroupSummary | null => {
    const mine = out.filter((l) => l.range === range && l.purchasable);
    if (!mine.length) return null;
    const rules = config.delivery[range];
    const subtotal = mine.reduce((sum, l) => sum + l.lineTotalPence, 0);
    const status: GroupSummary["status"] =
      range === "chilled" ? (!pc ? "unchecked" : pc.chilled ? "ok" : "ineligible") : pc && !pc.frozen ? "ineligible" : "ok";
    const surcharge = range === "frozen" && pc && pc.frozen ? pc.frozenSurchargePence : 0;
    const free = rules.freeOverPence !== null && subtotal >= rules.freeOverPence;
    const delivery = status === "ineligible" ? 0 : (free ? 0 : rules.chargePence) + surcharge;
    let message: string;
    if (range === "chilled") {
      if (status === "ok") message = `Chilled delivery is available for ${pc!.postcode}. You'll choose a delivery day and time slot at checkout.`;
      else if (status === "unchecked") message = "Chilled meals are delivered to selected postcodes only. Check your postcode to continue.";
      else message = `Sorry, we don't deliver chilled meals to ${pc!.postcode}. Remove these items or try our frozen range, delivered UK-wide.`;
    } else if (status === "ineligible") {
      message = pc!.frozenNote || `Frozen delivery isn't available for ${pc!.postcode}.`;
    } else if (pc) {
      const extra = surcharge ? ` ${pc.frozenNote ?? ""} (+${formatPrice(surcharge)})` : "";
      message = `Frozen delivery is available for ${pc.postcode} by tracked courier.${extra}`;
    } else {
      message = "Frozen meals are delivered UK-wide by tracked courier. Some remote postcodes carry a surcharge, confirmed at checkout.";
    }
    return {
      range,
      itemCount: mine.reduce((sum, l) => sum + l.qty, 0),
      subtotalPence: subtotal,
      deliveryPence: delivery,
      surchargePence: surcharge,
      minOrderPence: rules.minOrderPence,
      remainingToMinPence: Math.max(0, rules.minOrderPence - subtotal),
      freeOverPence: rules.freeOverPence,
      remainingToFreePence: rules.freeOverPence === null ? null : Math.max(0, rules.freeOverPence - subtotal),
      status,
      message: message.trim(),
    };
  };

  const chilled = group("chilled");
  const frozen = group("frozen");
  const subtotal = out.filter((l) => l.purchasable).reduce((sum, l) => sum + l.lineTotalPence, 0);

  // Promotional code
  let promo: Quote["promo"] = null;
  const code = text(promoCode ?? "", 40).toUpperCase();
  if (code) {
    const row = db().promoCodes.find((p) => p.code === code);
    if (!row || !row.active) promo = { code, valid: false, message: "That code isn't recognised.", discountPence: 0 };
    else if (subtotal < row.minSpendPence) promo = { code, valid: false, message: `Spend ${formatPrice(row.minSpendPence)} or more to use ${code}.`, discountPence: 0 };
    else {
      // Percentages round half-up to the nearest penny.
      const discountPence = row.kind === "percent" ? Math.floor((subtotal * row.value + 50) / 100) : Math.min(row.value, subtotal);
      promo = { code, valid: true, message: row.description || "Code applied.", discountPence };
    }
  }
  const discount = promo?.valid ? promo.discountPence : 0;

  // Reward redemption, validated against the live balance. At least £1 of goods stays payable by card.
  const r = config.rewards;
  const balance = userId ? getRewardBalance(userId) : 0;
  let maxRedeemable = Math.min(balance, Math.floor(Math.max(0, subtotal - discount - 100) / r.pointValuePence));
  if (maxRedeemable < r.minRedeemPoints) maxRedeemable = 0;
  let applied = Math.min(Math.max(0, redeemPoints || 0), maxRedeemable);
  if (applied < r.minRedeemPoints) applied = 0;
  const rewardDiscount = applied * r.pointValuePence;

  const delivery = (chilled?.deliveryPence ?? 0) + (frozen?.deliveryPence ?? 0);
  const total = subtotal - discount - rewardDiscount + delivery;
  const pointsToEarn = Math.floor((subtotal - discount - rewardDiscount) / 100) * r.pointsPerPound * (r.doublePoints.active ? 2 : 1);

  const blockers: string[] = [];
  if (!out.length) blockers.push("Your basket is empty.");
  if (out.some((l) => !l.purchasable)) blockers.push("Remove unavailable items to continue.");
  for (const g of [chilled, frozen]) {
    if (!g) continue;
    if (g.status === "unchecked") blockers.push("Check your postcode to confirm chilled delivery.");
    else if (g.status === "ineligible") blockers.push(`Remove ${g.range} items: ${g.range} delivery isn't available for ${pc ? pc.postcode : "your postcode"}.`);
    else if (g.remainingToMinPence > 0) {
      blockers.push(`Add ${formatPrice(g.remainingToMinPence)} more from the ${g.range} range to reach the ${formatPrice(g.minOrderPence)} ${g.range} minimum.`);
    }
  }

  return {
    lines: out,
    chilled,
    frozen,
    postcode: pc,
    promo,
    rewards: {
      signedIn: Boolean(userId),
      balance,
      maxRedeemable,
      applied,
      discountPence: rewardDiscount,
      pointValuePence: r.pointValuePence,
      minRedeemPoints: r.minRedeemPoints,
    },
    subtotalPence: subtotal,
    discountPence: discount,
    rewardDiscountPence: rewardDiscount,
    deliveryPence: delivery,
    totalPence: total,
    pointsToEarn,
    blockers,
    canCheckout: !blockers.length,
  };
}
