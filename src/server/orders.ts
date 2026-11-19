import type { PostcodeResult, UserDTO } from "@/lib/types";
import { checkPostcode, getBundles, getProducts } from "./catalog";
import { buildQuote, getRewardBalance } from "./pricing";
import { getChilledDates, getFrozenEstimate, slotsTaken } from "./schedule";
import { db, nextId, type OrderItemRec, type OrderRec } from "./store";
import { EMAIL_RE, PHONE_RE, iso, isObject, num, randomCode, text, whole, type Json } from "./util";

/* Orders and (demo) payments: creation, idempotent completion, loyalty and referral awards, reorder. */

export type CreateResult =
  | { ok: true; reference: string; totalPence: number; paid: boolean; postcode: string; payment: { mode: "demo" } }
  | { ok: false; status: number; error: string; fields?: Record<string, string>; quote?: unknown };

const err = (status: number, error: string, extra: { fields?: Record<string, string>; quote?: unknown } = {}): CreateResult => ({ ok: false, status, error, ...extra });

const paymentFor = (order: OrderRec): CreateResult => ({
  ok: true,
  reference: order.reference,
  totalPence: order.totalPence,
  paid: order.paymentStatus === "paid",
  postcode: order.address.postcode,
  payment: { mode: "demo" },
});

export function createOrder(body: Json, user: UserDTO | null): CreateResult {
  const store = db();
  const config = store.config;
  if (!user && !config.guestCheckout) return err(401, "Please sign in to place an order.");

  const customer = isObject(body.customer) ? body.customer : {};
  const addr = isObject(body.address) ? body.address : {};
  const name = text(customer.name, 120);
  const email = text(customer.email, 200).toLowerCase();
  const phone = text(customer.phone, 30);
  const line1 = text(addr.line1, 160);
  const line2 = text(addr.line2, 160);
  const city = text(addr.city, 80);
  const idempotencyKey = text(body.idempotencyKey, 80);

  const fields: Record<string, string> = {};
  if (name.length < 2) fields.name = "Enter your full name.";
  if (!EMAIL_RE.test(email)) fields.email = "Enter a valid email address.";
  if (!PHONE_RE.test(phone)) fields.phone = "Enter a valid telephone number.";
  if (line1.length < 3) fields.line1 = "Enter the first line of your address.";
  if (city.length < 2) fields.city = "Enter your town or city.";
  const pc = checkPostcode(text(addr.postcode, 12));
  if (!pc.valid) fields.postcode = pc.error;
  if (idempotencyKey.length < 12) return err(400, "Something went wrong preparing your order. Please refresh and try again.");
  if (Object.keys(fields).length || !pc.valid) return err(422, "Please check the highlighted details.", { fields });
  const postcode = pc.result.postcode;

  // Duplicate submission: return the order that already exists for this attempt.
  const existing = store.orders.find((o) => o.idempotencyKey === idempotencyKey);
  if (existing) return paymentFor(existing);

  // Re-price everything at the moment of ordering.
  const quote = buildQuote({
    lines: body.lines,
    postcode,
    promoCode: text(body.promoCode, 40) || null,
    redeemPoints: whole(body.redeemPoints) ?? 0,
    userId: user?.id ?? null,
  });
  if (!quote.canCheckout) return err(409, quote.blockers[0] ?? "Your basket can't be checked out yet.", { quote });
  if (num(body.expectedTotalPence) !== quote.totalPence) {
    return err(409, "Prices or delivery charges have changed since you last reviewed your order. Please review the updated total.", { quote });
  }

  let chilledDate: string | null = null;
  let slotId: string | null = null;
  let slotLabel: string | null = null;
  if (quote.chilled) {
    const day = getChilledDates(config).find((d) => d.date === text(body.chilledDate, 10));
    const slot = day?.slots.find((s) => s.id === text(body.chilledSlotId, 20));
    if (!day || !slot) return err(422, "Choose a delivery day and time slot for your chilled meals.");
    if (!day.open) return err(409, `The order cut-off for ${day.longLabel} has passed. Please choose another day.`);
    if (!slot.available) return err(409, `The ${slot.label} slot on ${day.longLabel} is now fully booked. Please choose another slot.`);
    if (slotsTaken(day.date, slot.id) >= config.chilledSchedule.capacityPerSlot) return err(409, "That delivery slot has just been fully booked. Please choose another slot.");
    chilledDate = day.date;
    slotId = slot.id;
    slotLabel = `${day.longLabel}, ${slot.label}`;
  }
  const frozen = quote.frozen ? getFrozenEstimate(config) : null;

  const order: OrderRec = {
    id: nextId(store, "orders"),
    reference: `CC-${randomCode(8)}`,
    idempotencyKey,
    userId: user?.id ?? null,
    name,
    email,
    phone,
    address: { line1, line2, city, postcode },
    status: "pending_payment",
    paymentStatus: "unpaid",
    paymentMode: "demo",
    subtotalPence: quote.subtotalPence,
    promoCode: quote.promo?.valid ? quote.promo.code : null,
    discountPence: quote.discountPence,
    rewardPointsRedeemed: quote.rewards.applied,
    rewardDiscountPence: quote.rewardDiscountPence,
    chilledDeliveryPence: quote.chilled?.deliveryPence ?? 0,
    frozenDeliveryPence: quote.frozen?.deliveryPence ?? 0,
    totalPence: quote.totalPence,
    pointsEarned: user ? quote.pointsToEarn : 0,
    chilledDate,
    chilledSlotId: slotId,
    chilledSlotLabel: slotLabel,
    frozenDispatchDate: frozen?.dispatchDate ?? null,
    frozenEstimate: frozen ? `Dispatched ${frozen.dispatchLabel} · estimated delivery ${frozen.estimateLabel}` : null,
    createdAt: new Date(),
    paidAt: null,
  };
  store.orders.push(order);
  for (const l of quote.lines) {
    store.orderItems.push({
      id: nextId(store, "order_items"),
      orderId: order.id,
      kind: l.type,
      refId: l.refId,
      variantId: l.variantId,
      name: l.name,
      image: l.image,
      range: l.range,
      variantLabel: l.variantLabel,
      quantity: l.qty,
      unitPricePence: l.unitPricePence,
      lineTotalPence: l.lineTotalPence,
      contents: l.contents,
    });
  }

  if (user && body.saveAddress === true) {
    const mine = store.addresses.filter((a) => a.userId === user.id);
    const same = mine.some((a) => a.line1.toLowerCase() === line1.toLowerCase() && a.postcode === postcode);
    if (!same && mine.length < 10) {
      store.addresses.push({ id: nextId(store, "addresses"), userId: user.id, label: mine.length ? "Address" : "Home", line1, line2, city, postcode, isDefault: mine.length === 0 });
    }
  }
  return paymentFor(order);
}

/** Idempotent: awards loyalty and referral rewards exactly once, when an order becomes paid. */
export function finalizeOrder(order: OrderRec): void {
  if (order.paymentStatus === "paid") return;
  const store = db();
  const now = new Date();
  order.paymentStatus = "paid";
  order.status = "confirmed";
  order.paidAt = now;
  const userId = order.userId;
  if (!userId) return;

  const { rewards, referral: rules } = store.config;
  const expires = new Date(now);
  expires.setUTCMonth(expires.getUTCMonth() + rewards.expiryMonths);
  const tx = (uid: number, kind: string, points: number, description: string, expiresAt: Date | null = null) =>
    store.rewardTx.push({ id: nextId(store, "reward_transactions"), userId: uid, orderId: order.id, kind, points, description, expiresAt, createdAt: new Date() });

  if (order.rewardPointsRedeemed > 0) {
    const balance = getRewardBalance(userId);
    tx(userId, "redeem", -Math.min(order.rewardPointsRedeemed, balance), `Redeemed on order ${order.reference}`);
  }
  if (order.pointsEarned > 0) {
    tx(userId, "earn", order.pointsEarned, `Earned on order ${order.reference}${rewards.doublePoints.active ? " (double points)" : ""}`, expires);
  }

  // Referral rewards are only released once the referred customer's order meets the qualifying spend.
  const goodsPaid = order.subtotalPence - order.discountPence - order.rewardDiscountPence;
  if (goodsPaid >= rules.minQualifyingOrderPence) {
    const referral = store.referrals.find((r) => r.referredUserId === userId && r.status === "registered");
    if (referral) {
      referral.status = "qualified";
      referral.qualifiedAt = now;
      referral.rewardPoints = rules.referrerPoints;
      tx(referral.referrerUserId, "referral", rules.referrerPoints, "Referral reward: your friend placed a qualifying order", expires);
      tx(userId, "referral", rules.friendPoints, "Welcome reward for joining through a friend", expires);
    }
  }
}

/** Validates the demo card form. Returns the digits to settle with, or a ready-made 422 body. */
export function validateDemoCard(body: Json): { card: string } | { fields: Record<string, string> } {
  const card = text(body.cardNumber, 30).replace(/\D/g, "");
  const expiry = /^(\d{2})\s*\/\s*(\d{2})$/.exec(text(body.expiry, 8));
  const cvc = text(body.cvc, 4);
  const fields: Record<string, string> = {};
  if (card.length !== 16) fields.cardNumber = "Enter the 16-digit card number.";
  const month = expiry ? Number(expiry[1]) : 0;
  if (!expiry || month < 1 || month > 12) fields.expiry = "Use the format MM/YY.";
  else {
    const year = 2000 + Number(expiry[2]);
    const firstDayAfter = Date.UTC(year + (month === 12 ? 1 : 0), month % 12, 1);
    if (firstDayAfter <= Date.now()) fields.expiry = "This card has expired.";
  }
  if (!/^\d{3,4}$/.test(cvc)) fields.cvc = "Enter the 3-digit security code.";
  return Object.keys(fields).length ? { fields } : { card };
}

/** Takes no money and stores no card details: Stripe's published test card numbers drive the success and decline journeys. */
export function settleDemoPayment(order: OrderRec, card: string): { status: number; data: Json } {
  if (card === "4242424242424242") {
    finalizeOrder(order);
    return { status: 200, data: { status: "paid", reference: order.reference } };
  }
  if (order.paymentStatus === "unpaid" || order.paymentStatus === "failed") order.paymentStatus = "failed";
  if (card === "4000000000000002") {
    return { status: 402, data: { error: "Your card was declined. You haven't been charged and your basket has been kept. Try another card.", code: "card_declined" } };
  }
  return {
    status: 402,
    data: { error: "This preview only accepts Stripe test cards: 4242 4242 4242 4242 succeeds, 4000 0000 0000 0002 is declined.", code: "test_card_required" },
  };
}

/* -------------------------------------------------------------------- reads */

export const findOrder = (reference: string) => db().orders.find((o) => o.reference === reference.toUpperCase()) ?? null;
export const itemsOf = (order: OrderRec) => db().orderItems.filter((i) => i.orderId === order.id);

export function orderDto(o: OrderRec) {
  const { idempotencyKey: _private, createdAt, paidAt, ...rest } = o;
  void _private;
  return { ...rest, createdAt: iso(createdAt), paidAt: iso(paidAt) };
}

export const itemDto = (i: OrderItemRec) => ({ ...i });

export function getOrdersForUser(userId: number) {
  return db()
    .orders.filter((o) => o.userId === userId && o.paymentStatus === "paid")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((o) => ({ order: orderDto(o), items: itemsOf(o).map(itemDto) }));
}

export function getRewardSummary(userId: number) {
  const store = db();
  const history = store.rewardTx.filter((t) => t.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);
  const expiring = history.filter((h) => h.points > 0 && h.expiresAt).map((h) => h.expiresAt!.getTime()).sort((a, b) => a - b);
  return {
    history: history.map((h) => ({ id: h.id, kind: h.kind, points: h.points, description: h.description, createdAt: iso(h.createdAt), expiresAt: iso(h.expiresAt) })),
    balance: getRewardBalance(userId),
    earned: history.filter((h) => h.points > 0).reduce((s, h) => s + h.points, 0),
    redeemed: history.filter((h) => h.points < 0).reduce((s, h) => s - h.points, 0),
    nextExpiry: expiring.length ? new Date(expiring[0]).toISOString() : null,
    referrals: store.referrals
      .filter((r) => r.referrerUserId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({
        referral: { id: r.id, status: r.status, rewardPoints: r.rewardPoints, createdAt: iso(r.createdAt) },
        friendName: store.users.find((u) => u.id === r.referredUserId)?.name ?? "",
      })),
  };
}

/** Revalidates a previous order against today's catalogue, prices and delivery rules before anything is added to the basket. */
export function reorderCheck(order: OrderRec, savedPostcode: string | null) {
  const products = getProducts();
  const bundles = getBundles(products);
  const productById = new Map(products.map((p) => [p.id, p]));
  let postcode: PostcodeResult | null = null;
  if (savedPostcode) {
    const checked = checkPostcode(savedPostcode);
    postcode = checked.valid ? checked.result : null;
  }

  const items = itemsOf(order).map((item) => {
    let line: Json | null = null;
    let nowPence: number | null = null;
    let reason: string | null = null;
    if (item.kind === "product") {
      const p = productById.get(item.refId);
      if (!p || !p.available) reason = "No longer available";
      else {
        const variant = p.variants.find((v) => v.id === item.variantId) ?? p.variants[0];
        nowPence = variant.pricePence;
        line = { key: `p:${p.id}:${variant.id}`, type: "product", productId: p.id, variantId: variant.id, qty: Math.min(item.quantity, p.maxPerOrder) };
      }
    } else {
      const b = bundles.find((x) => x.id === item.refId);
      const contents = item.contents ?? [];
      const allThere = contents.every((c) => productById.get(c.productId)?.available);
      if (!b) reason = "This bundle is no longer offered";
      else if (!allThere) reason = "A dish in this bundle is no longer available";
      else {
        nowPence = b.pricePence;
        line = {
          key: `b:${b.id}:${Date.now().toString(16)}${item.id}`,
          type: "bundle",
          bundleId: b.id,
          selections: contents.map((c) => ({ productId: c.productId, qty: c.qty })),
          qty: Math.min(item.quantity, 6),
        };
      }
    }
    let status = line ? "available" : "unavailable";
    if (line && item.range === "chilled") {
      if (!postcode) [status, reason] = ["chilled-unchecked", "Check your postcode to confirm chilled delivery"];
      else if (!postcode.chilled) [status, reason] = ["not-deliverable", `Chilled delivery isn't available for ${postcode.postcode}`];
    } else if (line && postcode && !postcode.frozen) {
      [status, reason] = ["not-deliverable", `Frozen delivery isn't available for ${postcode.postcode}`];
    }
    return { name: item.name, range: item.range, qty: item.quantity, wasPence: item.unitPricePence, nowPence, status, reason, line: status === "available" ? line : null };
  });
  return { reference: order.reference, postcode, items };
}
