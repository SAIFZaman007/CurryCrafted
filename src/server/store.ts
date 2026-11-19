import { scryptSync, randomBytes, timingSafeEqual } from "crypto";
import seed from "./seed.json";
import type { StoreConfig, Variant, Nutrition } from "@/lib/types";

/*
 * The whole "database": plain in-memory collections, seeded from seed.json.
 *
 * Nothing external is needed (no Python, no PostgreSQL). Data lives in the Node
 * process, so accounts, orders and rewards created while browsing are reset when
 * the dev server restarts. The catalogue, delivery rules and copy always come from
 * seed.json, which is the one file to edit to change products, prices or rules.
 */

export type ProductRec = {
  id: number;
  slug: string;
  name: string;
  range: "chilled" | "frozen";
  category: string;
  shortDescription: string;
  description: string;
  image: string;
  gallery: string[];
  variants: Variant[];
  dietary: string[];
  spiceLevel: number;
  ingredients: string;
  allergens: string[];
  mayContain: string[];
  nutrition: Nutrition | null;
  storage: string;
  preparation: string[];
  servings: string;
  active: boolean;
  inStock: boolean;
  maxPerOrder: number;
  popularity: number;
  featured: boolean;
  createdAt: Date;
};

export type BundleRec = {
  id: number;
  slug: string;
  name: string;
  description: string;
  image: string;
  range: "chilled" | "frozen";
  serves: string;
  mainsCount: number;
  sidesCount: number;
  pricePence: number;
  sortOrder: number;
  active: boolean;
};

export type UserRec = {
  id: number;
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  referralCode: string;
  referredByUserId: number | null;
  marketingEmail: boolean;
  marketingSms: boolean;
};

export type AddressRec = { id: number; userId: number; label: string; line1: string; line2: string; city: string; postcode: string; isDefault: boolean };

export type OrderRec = {
  id: number;
  reference: string;
  idempotencyKey: string;
  userId: number | null;
  name: string;
  email: string;
  phone: string;
  address: { line1: string; line2: string; city: string; postcode: string };
  status: string;
  paymentStatus: string;
  paymentMode: string;
  subtotalPence: number;
  promoCode: string | null;
  discountPence: number;
  rewardPointsRedeemed: number;
  rewardDiscountPence: number;
  chilledDeliveryPence: number;
  frozenDeliveryPence: number;
  totalPence: number;
  pointsEarned: number;
  chilledDate: string | null;
  chilledSlotId: string | null;
  chilledSlotLabel: string | null;
  frozenDispatchDate: string | null;
  frozenEstimate: string | null;
  createdAt: Date;
  paidAt: Date | null;
};

export type OrderItemRec = {
  id: number;
  orderId: number;
  kind: string;
  refId: number;
  variantId: string | null;
  name: string;
  image: string;
  range: string;
  variantLabel: string | null;
  quantity: number;
  unitPricePence: number;
  lineTotalPence: number;
  contents: { productId: number; name: string; qty: number }[] | null;
};

export type RewardTx = { id: number; userId: number; orderId: number | null; kind: string; points: number; description: string; expiresAt: Date | null; createdAt: Date };
export type ReferralRec = { id: number; referrerUserId: number; referredUserId: number; status: string; rewardPoints: number; createdAt: Date; qualifiedAt: Date | null };
export type PromoRec = { code: string; kind: "percent" | "fixed"; value: number; minSpendPence: number; description: string; active: boolean };
export type FrozenRestrictionRec = { id: number; prefix: string; kind: string; surchargePence: number; note: string };

export type Store = {
  config: StoreConfig;
  products: ProductRec[];
  bundles: BundleRec[];
  chilledPostcodes: { prefix: string; active: boolean }[];
  frozenRestrictions: FrozenRestrictionRec[];
  promoCodes: PromoRec[];
  users: UserRec[];
  sessions: Map<string, { userId: number; expires: number }>;
  addresses: AddressRec[];
  orders: OrderRec[];
  orderItems: OrderItemRec[];
  rewardTx: RewardTx[];
  referrals: ReferralRec[];
  newsletter: Set<string>;
  contactMessages: { name: string; email: string; topic: string; message: string; createdAt: Date }[];
  seq: Record<string, number>;
};

export function nextId(s: Store, table: string): number {
  s.seq[table] = (s.seq[table] ?? 0) + 1;
  return s.seq[table];
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hex] = stored.split(":");
  if (!salt || !hex) return false;
  const expected = Buffer.from(hex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const DAY = 86_400_000;

function build(): Store {
  const s: Store = {
    config: seed.config as StoreConfig,
    products: [],
    bundles: [],
    chilledPostcodes: seed.chilledPostcodes.map((prefix) => ({ prefix, active: true })),
    frozenRestrictions: [],
    promoCodes: seed.promoCodes.map((p) => ({ ...p, kind: p.kind as PromoRec["kind"], active: true })),
    users: [],
    sessions: new Map(),
    addresses: [],
    orders: [],
    orderItems: [],
    rewardTx: [],
    referrals: [],
    newsletter: new Set(),
    contactMessages: [],
    seq: {},
  };

  for (const p of seed.products) {
    const { daysAgo, ...rest } = p;
    s.products.push({ ...(rest as unknown as Omit<ProductRec, "id" | "createdAt">), id: nextId(s, "products"), createdAt: new Date(Date.now() - daysAgo * DAY) });
  }
  for (const b of seed.bundles) {
    s.bundles.push({ ...(b as Omit<BundleRec, "id" | "active">), id: nextId(s, "bundles"), active: true });
  }
  for (const r of seed.frozenRestrictions) {
    s.frozenRestrictions.push({ ...r, id: nextId(s, "frozen_restrictions") });
  }

  // A ready-made demo customer so the account area can be explored straight away.
  const demo: UserRec = {
    id: nextId(s, "users"),
    name: "Demo Customer",
    email: "demo@currycrafted.test",
    phone: "07700 900123",
    passwordHash: hashPassword("Curry1234!"),
    referralCode: "DEMO-CURRY",
    referredByUserId: null,
    marketingEmail: true,
    marketingSms: false,
  };
  s.users.push(demo);
  const now = new Date();
  s.rewardTx.push({
    id: nextId(s, "reward_transactions"),
    userId: demo.id,
    orderId: null,
    kind: "earn",
    points: 250,
    description: "Welcome bonus",
    expiresAt: new Date(now.getTime() + 365 * DAY),
    createdAt: now,
  });
  return s;
}

const g = globalThis as typeof globalThis & { __ccStore?: Store };

/** One store per Node process, shared by server components and API route handlers (and kept across hot reloads). */
export function db(): Store {
  return (g.__ccStore ??= build());
}
