# Curry Crafted: standalone frontend

A self-contained Next.js storefront. No Python, no database, no required environment variables.

```bash
npm install
npm run dev        # http://localhost:3000
```

Needs Node.js 20.9 or newer. For a production build: `npm run build && npm start`.

## The design

The home page hero is a "living photograph": one still of the butter chicken bowl (`public/images/hero-living.jpg`),
brought to life with a slow camera push, floating spices, canvas steam and sparks, grain and a vignette. On desktop a
cinematic video fades in over it. The same still is the fallback everywhere else.

- **Reduced motion, Save-Data, and off-screen:** all motion stops (or never starts). A visible *Pause motion* button covers WCAG 2.2.2.
- **Video is an enhancement.** `AmbientVideo` (`src/components/ambient-video.tsx`) shows a poster image first, downloads the
  file only when it nears the viewport, plays only while visible, and never loads for reduced-motion or Save-Data visitors.
- **Videos** live in `public/videos/` (`hero-cinematic`, `kitchen`, `unboxing`, `bowl-loop`), each with a `-poster.jpg`.
  Loops are crossfaded so they restart without a visible jump.

## How the backend-free API works

The storefront API (`/api/*`) runs inside Next.js, in `src/server/`.

| File | What it does |
| --- | --- |
| `src/server/seed.json` | **All content**: products, prices, bundles, delivery postcodes, promo code, delivery rules, contact details |
| `src/server/store.ts` | In-memory data store, seeded from `seed.json` |
| `src/server/handler.ts` | API routes (catalogue, postcode, basket, auth, account, checkout, orders) |
| `src/server/pricing.ts`, `schedule.ts`, `catalog.ts`, `orders.ts` | Pricing, delivery slots, search, orders and rewards |
| `src/server/ratelimit.ts` | Per-client rate limiting |
| `src/lib/api.ts` | Server components call the API directly (no network hop) |
| `src/app/api/[...path]/route.ts` | Exposes the same API to the browser |

Accounts, orders and reward points live in memory and reset when the server restarts. To make them persistent, replace
`src/server/store.ts` with a real database; nothing else needs to change.

## Try it

| | |
| --- | --- |
| Demo account | `demo@currycrafted.test` / `Curry1234!` (250 reward points) |
| Chilled postcode | `DY9 8DU`. Any other valid UK postcode, e.g. `SW1A 1AA`, is frozen-only |
| Promo code | `WELCOME10` (10% off, £25 minimum) |
| Test card, success | `4242 4242 4242 4242`, any future expiry, any 3-digit CVC |
| Test card, declined | `4000 0000 0000 0002` |
| Minimums | Chilled £20, frozen £30 |

## Images

Real photography is in `public/images/` (hero, collections, story, butter chicken). Every other product photo is still a
generated placeholder. Replace one by dropping a file with the same name into `public/images/products/`; no code change.

## Customer reviews

The home page hides the reviews section until `src/lib/testimonials.ts` contains real, approved reviews. Nothing is invented.

## Security

- **Content-Security-Policy** with a per-request nonce (`src/proxy.ts`), plus HSTS, `nosniff`, frame denial and a strict referrer and permissions policy (`next.config.ts`).
- **API guards:** JSON-only writes, same-origin check on every state-changing request, and rate limiting (15 requests a minute per client on login, register, payment and promo routes; more generous elsewhere).
- **Auth:** scrypt password hashing, hashed session tokens, `HttpOnly` + `SameSite=Lax` cookies (`Secure` over https).
- **Before going live:** the in-memory rate limiter is per instance; use a shared store if you run several. Payment is a demo flow, so connect a real provider (e.g. Stripe) before taking money.

## Configuration

Everything is optional; see `.env.example`. Set `NEXT_PUBLIC_SITE_URL` to your public URL so canonical links, the sitemap and social previews are correct.

## Scripts

| | |
| --- | --- |
| `npm run dev` / `build` / `start` | Develop, build, serve |
| `npm run check` | Typecheck, lint and tests in one go (what CI runs) |
| `npm test` | Vitest unit tests for the API, rate limiter and cookies |

CI (`.github/workflows/ci.yml`) runs the audit, typecheck, lint, tests and a production build on every push and pull request.
