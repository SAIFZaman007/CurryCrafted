import { createHash, randomBytes } from "crypto";
import type { UserDTO } from "@/lib/types";
import { checkPostcode, getBundles, getProducts, parsePostcode, searchProducts } from "./catalog";
import { createOrder, findOrder, getOrdersForUser, getRewardSummary, itemDto, itemsOf, orderDto, reorderCheck, settleDemoPayment, validateDemoCard } from "./orders";
import { buildQuote } from "./pricing";
import { getSchedule } from "./schedule";
import { db, hashPassword, nextId, verifyPassword, type AddressRec, type OrderRec, type UserRec } from "./store";
import { EMAIL_RE, PHONE_RE, isObject, randomCode, sleep, text, whole, type Json } from "./util";

/*
 * The storefront's API, implemented in-process.
 *
 * Same routes, request bodies and response shapes the pages were built against
 * (`/api/...`), but served from memory by plain functions. Server components call
 * handleApi() directly; browser fetches reach it through app/api/[...path]/route.ts.
 */

export type ApiRequest = {
  method: string;
  path: string; // e.g. "/api/cart/quote"
  query: URLSearchParams;
  body?: unknown;
  cookies: Record<string, string>;
};
export type CookieOp = { name: string; value: string; maxAge: number };
export type ApiResult = { status: number; data: Json; cookies: CookieOp[] };

export const SESSION_COOKIE = "cc_session";
export const ORDERS_COOKIE = "cc_orders";
export const POSTCODE_COOKIE = "cc_postcode";
const DAY = 86_400;
const SESSION_DAYS = 30;

const ok = (data: Json, cookies: CookieOp[] = [], status = 200): ApiResult => ({ status, data, cookies });
const fail = (error: string, status = 400, extra: Json = {}): ApiResult => ({
  status,
  data: { error, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined && v !== null)) },
  cookies: [],
});
const invalidFields = (fields: Record<string, string>, message = "Please check the highlighted fields.") => fail(message, 422, { fields });

/* ----------------------------------------------------------------- sessions */

const tokenId = (token: string) => createHash("sha256").update(token).digest("hex");

const userDto = (u: UserRec): UserDTO => ({
  id: u.id,
  name: u.name,
  email: u.email,
  phone: u.phone,
  referralCode: u.referralCode,
  marketingEmail: u.marketingEmail,
  marketingSms: u.marketingSms,
});

function currentUserRec(req: ApiRequest): UserRec | null {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const session = db().sessions.get(tokenId(token));
  if (!session || session.expires < Date.now()) return null;
  return db().users.find((u) => u.id === session.userId) ?? null;
}

const currentUser = (req: ApiRequest): UserDTO | null => {
  const u = currentUserRec(req);
  return u ? userDto(u) : null;
};

function startSession(userId: number): CookieOp {
  const token = randomBytes(32).toString("hex");
  db().sessions.set(tokenId(token), { userId, expires: Date.now() + SESSION_DAYS * DAY * 1000 });
  return { name: SESSION_COOKIE, value: token, maxAge: SESSION_DAYS * DAY };
}

const postcodeCookie = (postcode: string | null): CookieOp => ({ name: POSTCODE_COOKIE, value: postcode ?? "", maxAge: postcode ? 30 * DAY : 0 });

/** Order references created in this browser, so guests can view their own confirmation page. */
const rememberedOrders = (req: ApiRequest) => (req.cookies[ORDERS_COOKIE] ?? "").split(".").filter(Boolean);
const rememberOrder = (req: ApiRequest, reference: string): CookieOp => ({
  name: ORDERS_COOKIE,
  value: [reference, ...rememberedOrders(req).filter((r) => r !== reference)].slice(0, 10).join("."),
  maxAge: 30 * DAY,
});

const mayView = (req: ApiRequest, order: OrderRec) => {
  const user = currentUser(req);
  return Boolean(user && order.userId === user.id) || rememberedOrders(req).includes(order.reference);
};

function generateReferralCode(name: string): string {
  const stem = name.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5) || "CURRY";
  return `${stem}-${randomCode(5)}`;
}

/* ------------------------------------------------------------------- routes */

type Handler = (req: ApiRequest, params: string[]) => ApiResult | Promise<ApiResult>;
const routes: { method: string; pattern: RegExp; handler: Handler }[] = [];
const route = (method: string, pattern: string, handler: Handler) => routes.push({ method, pattern: new RegExp(`^${pattern}$`), handler });
const body = (req: ApiRequest): Json => (isObject(req.body) ? req.body : {});

route("GET", "/api/health", () => ok({ ok: true, service: "curry-crafted-standalone" }));

route("GET", "/api/session", (req) => {
  const saved = req.cookies[POSTCODE_COOKIE];
  const checked = saved ? checkPostcode(saved) : null;
  return ok({ user: currentUser(req), postcode: checked?.valid ? checked.result : null });
});

route("GET", "/api/config", () => ok({ config: db().config, stripeEnabled: false }));
route("GET", "/api/catalog/products", () => ok({ products: getProducts() }));
route("GET", "/api/catalog/bundles", () => ok({ bundles: getBundles() }));
route("GET", "/api/delivery/restrictions", () => ok({ restrictions: [...db().frozenRestrictions].sort((a, b) => a.prefix.localeCompare(b.prefix)) }));

route("POST", "/api/postcode", (req) => {
  const checked = checkPostcode(text(body(req).postcode, 12));
  if (!checked.valid) return fail(checked.error, 422);
  return ok({ result: checked.result }, [postcodeCookie(checked.result.postcode)]);
});
route("DELETE", "/api/postcode", () => ok({ cleared: true }, [postcodeCookie(null)]));

route("POST", "/api/cart/quote", (req) => {
  const b = body(req);
  return ok({
    quote: buildQuote({
      lines: b.lines,
      postcode: text(b.postcode, 12) || null,
      promoCode: text(b.promoCode, 40) || null,
      redeemPoints: whole(b.redeemPoints) ?? 0,
      userId: currentUser(req)?.id ?? null,
    }),
  });
});

route("GET", "/api/search", (req) => {
  const query = (req.query.get("q") ?? "").trim().slice(0, 60);
  const all = getProducts();
  const matches = query ? searchProducts(all, query) : all.filter((p) => p.featured);
  return ok({
    query,
    total: matches.length,
    results: matches.slice(0, 6).map((p) => ({ slug: p.slug, name: p.name, image: p.image, range: p.range, category: p.category, pricePence: p.pricePence, available: p.available })),
  });
});

route("GET", "/api/schedule", () => ok({ schedule: getSchedule(db().config) }));

route("POST", "/api/forms/([a-z]+)", (req, [kind]) => {
  const b = body(req);
  const email = text(b.email, 200).toLowerCase();
  const fields: Record<string, string> = {};
  if (kind === "newsletter") {
    if (!EMAIL_RE.test(email)) fields.email = "Enter a valid email address.";
    if (b.consent !== true) fields.consent = "Please confirm you'd like to receive our emails.";
    if (Object.keys(fields).length) return fail(Object.values(fields)[0], 422, { fields });
    db().newsletter.add(email);
    return ok({ subscribed: true });
  }
  if (kind === "contact") {
    const name = text(b.name, 120);
    const message = text(b.message, 4000);
    if (name.length < 2) fields.name = "Enter your name.";
    if (!EMAIL_RE.test(email)) fields.email = "Enter a valid email address.";
    if (message.length < 10) fields.message = "Tell us a little more so we can help (at least 10 characters).";
    if (Object.keys(fields).length) return invalidFields(fields);
    db().contactMessages.push({ name, email, topic: text(b.topic, 60) || "General", message, createdAt: new Date() });
    return ok({ sent: true });
  }
  return fail("Not found.", 404);
});

/* --- auth --- */

route("GET", "/api/auth/me", (req) => ok({ user: currentUser(req) }));

route("POST", "/api/auth/logout", (req) => {
  const token = req.cookies[SESSION_COOKIE];
  if (token) db().sessions.delete(tokenId(token));
  return ok({ user: null }, [{ name: SESSION_COOKIE, value: "", maxAge: 0 }]);
});

route("POST", "/api/auth/login", (req) => {
  const b = body(req);
  const email = text(b.email, 200).toLowerCase();
  const password = typeof b.password === "string" ? b.password : "";
  const fields: Record<string, string> = {};
  if (!EMAIL_RE.test(email)) fields.email = "Enter your email address.";
  if (!password) fields.password = "Enter your password.";
  if (Object.keys(fields).length) return invalidFields(fields);
  const user = db().users.find((u) => u.email === email);
  // One generic message, so the response never reveals whether an email is registered.
  if (!user || !verifyPassword(password, user.passwordHash)) return fail("That email and password don't match our records.", 401);
  return ok({ user: userDto(user) }, [startSession(user.id)]);
});

route("POST", "/api/auth/register", (req) => {
  const store = db();
  const b = body(req);
  const name = text(b.name, 120);
  const email = text(b.email, 200).toLowerCase();
  const phone = text(b.phone, 30);
  const password = typeof b.password === "string" ? b.password : "";
  const confirm = typeof b.confirmPassword === "string" ? b.confirmPassword : "";
  const referralCode = text(b.referralCode, 20).toUpperCase();

  const fields: Record<string, string> = {};
  if (name.length < 2) fields.name = "Enter your full name.";
  if (!EMAIL_RE.test(email)) fields.email = "Enter a valid email address.";
  if (!PHONE_RE.test(phone)) fields.phone = "Enter a valid telephone number.";
  if (password.length < 8) fields.password = "Use at least 8 characters.";
  else if (password.length > 200) fields.password = "That password is too long.";
  if (confirm !== password) fields.confirmPassword = "Passwords don't match.";
  const referrer = referralCode ? store.users.find((u) => u.referralCode === referralCode) : undefined;
  if (referralCode && !referrer) fields.referralCode = "We don't recognise that referral code.";
  if (Object.keys(fields).length) return invalidFields(fields);
  if (store.users.some((u) => u.email === email)) return invalidFields({ email: "An account already exists for this email. Try signing in." });

  const user: UserRec = {
    id: nextId(store, "users"),
    name,
    email,
    phone,
    passwordHash: hashPassword(password),
    referralCode: generateReferralCode(name),
    referredByUserId: referrer?.id ?? null,
    marketingEmail: b.marketingEmail === true,
    marketingSms: false,
  };
  store.users.push(user);
  if (referrer) {
    // Only recorded here; rewards are issued later, once a qualifying order is paid.
    store.referrals.push({ id: nextId(store, "referrals"), referrerUserId: referrer.id, referredUserId: user.id, status: "registered", rewardPoints: 0, createdAt: new Date(), qualifiedAt: null });
  }
  return ok({ user: userDto(user) }, [startSession(user.id)]);
});

/* --- account (signed-in customers only) --- */

const account = (inner: (req: ApiRequest, user: UserRec) => ApiResult): Handler => (req) => {
  const user = currentUserRec(req);
  return user ? inner(req, user) : fail("Please sign in.", 401);
};

const addressList = (userId: number) =>
  db()
    .addresses.filter((a) => a.userId === userId)
    .sort((a, b) => a.id - b.id)
    .map(({ userId: _u, ...a }) => a);

route("GET", "/api/account/addresses", account((_req, user) => ok({ addresses: addressList(user.id) })));

route(
  "POST",
  "/api/account/addresses",
  account((req, user) => {
    const store = db();
    const b = body(req);
    const action = text(b.action, 20) || "create";
    const id = whole(b.id);
    const mine = () => store.addresses.filter((a) => a.userId === user.id);

    // Every operation is scoped to the signed-in customer, so one account can never touch another's addresses.
    if (action === "delete") {
      store.addresses = store.addresses.filter((a) => !(a.id === id && a.userId === user.id));
      return ok({ addresses: addressList(user.id) });
    }
    if (action === "default") {
      mine().forEach((a) => (a.isDefault = a.id === id));
      return ok({ addresses: addressList(user.id) });
    }

    const line1 = text(b.line1, 160);
    const city = text(b.city, 80);
    const pc = parsePostcode(text(b.postcode, 12));
    const fields: Record<string, string> = {};
    if (line1.length < 3) fields.line1 = "Enter the first line of the address.";
    if (city.length < 2) fields.city = "Enter a town or city.";
    if (!pc) fields.postcode = "Enter a full UK postcode.";
    if (Object.keys(fields).length || !pc) return invalidFields(fields);
    if (mine().length >= 10) return fail("You can save up to 10 addresses.", 422);
    const makeDefault = b.isDefault === true || mine().length === 0;
    if (makeDefault) mine().forEach((a) => (a.isDefault = false));
    const created: AddressRec = {
      id: nextId(store, "addresses"),
      userId: user.id,
      label: text(b.label, 40) || "Home",
      line1,
      line2: text(b.line2, 160),
      city,
      postcode: pc.formatted,
      isDefault: makeDefault,
    };
    store.addresses.push(created);
    return ok({ addresses: addressList(user.id) });
  }),
);

route(
  "POST",
  "/api/account/details",
  account((req, user) => {
    const b = body(req);
    const name = text(b.name, 120);
    const email = text(b.email, 200).toLowerCase();
    const phone = text(b.phone, 30);
    const fields: Record<string, string> = {};
    if (name.length < 2) fields.name = "Enter your full name.";
    if (!EMAIL_RE.test(email)) fields.email = "Enter a valid email address.";
    if (!PHONE_RE.test(phone)) fields.phone = "Enter a valid telephone number.";
    if (Object.keys(fields).length) return invalidFields(fields);
    if (db().users.some((u) => u.email === email && u.id !== user.id)) return invalidFields({ email: "That email is already used by another account." });
    Object.assign(user, { name, email, phone });
    return ok({ user: userDto(user) });
  }),
);

route(
  "POST",
  "/api/account/password",
  account((req, user) => {
    const b = body(req);
    const current = typeof b.currentPassword === "string" ? b.currentPassword : "";
    const next = typeof b.newPassword === "string" ? b.newPassword : "";
    const fields: Record<string, string> = {};
    if (!verifyPassword(current, user.passwordHash)) fields.currentPassword = "Your current password isn't correct.";
    if (next.length < 8 || next.length > 200) fields.newPassword = "Use at least 8 characters.";
    if (Object.keys(fields).length) return invalidFields(fields);
    user.passwordHash = hashPassword(next);
    return ok({ updated: true });
  }),
);

route(
  "POST",
  "/api/account/preferences",
  account((req, user) => {
    const b = body(req);
    user.marketingEmail = b.marketingEmail === true;
    user.marketingSms = b.marketingSms === true;
    return ok({ user: userDto(user) });
  }),
);

route("GET", "/api/account/orders", account((_req, user) => ok({ orders: getOrdersForUser(user.id) })));
route("GET", "/api/account/rewards", account((_req, user) => ok(getRewardSummary(user.id))));

/* --- checkout and orders --- */

route("POST", "/api/checkout", (req) => {
  const result = createOrder(body(req), currentUser(req));
  if (!result.ok) return fail(result.error, result.status, { fields: result.fields, quote: result.quote });
  const { postcode, ...data } = result;
  return ok(data, [rememberOrder(req, result.reference), postcodeCookie(postcode)]);
});

route("POST", "/api/checkout/pay", async (req) => {
  const b = body(req);
  const order = findOrder(text(b.reference, 20));
  if (!order || !mayView(req, order)) return fail("We couldn't find that order.", 404);
  if (order.paymentStatus === "paid") return ok({ status: "paid", reference: order.reference }); // repeat submission: no second payment
  const checked = validateDemoCard(b);
  if ("fields" in checked) return fail("Please check your card details.", 422, { fields: checked.fields });
  await sleep(700); // a moment of "processing" so the payment step feels real
  const settled = settleDemoPayment(order, checked.card);
  return { status: settled.status, data: settled.data, cookies: [] };
});

route("GET", "/api/orders/([A-Za-z0-9-]+)", (req, [reference]) => {
  const order = findOrder(reference);
  if (!order) return fail("We couldn't find that order.", 404);
  if (!mayView(req, order)) return fail("Sign in to view this order.", 403, { reference: order.reference });
  return ok({ order: orderDto(order), items: itemsOf(order).map(itemDto) });
});

route("POST", "/api/orders/([A-Za-z0-9-]+)/reorder", (req, [reference]) => {
  const user = currentUser(req);
  if (!user) return fail("Please sign in.", 401);
  const order = findOrder(reference);
  if (!order || order.userId !== user.id) return fail("We couldn't find that order.", 404);
  return ok(reorderCheck(order, req.cookies[POSTCODE_COOKIE] ?? null));
});

/* ----------------------------------------------------------------- dispatch */

export async function handleApi(req: ApiRequest): Promise<ApiResult> {
  const path = req.path.replace(/\/+$/, "") || "/";
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const match = r.pattern.exec(path);
      if (match) return await r.handler(req, match.slice(1).map(decodeURIComponent));
    }
    return fail("Not Found", 404);
  } catch (error) {
    console.error("[api]", error);
    return fail("Something went wrong. Please try again.", 500);
  }
}
