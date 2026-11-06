# Yard

A global, discovery-driven marketplace for independent brands. It has three experiences:

| Area | Route | Feel |
|---|---|---|
| Customer marketplace | `/` and everything under `src/app/(market)` | Dark, editorial, photographic |
| Brand Studio (merchants) | `/studio` (`src/app/studio`) | Graphite, structured, analytical |
| Admin Control Center (internal) | `/admin` (`src/app/admin`) | Dense, operational |

> **Status: frontend phase.** Every screen runs on a typed local data layer
> (`src/lib/data/*`) and browser stores (`src/lib/stores/*`), so flows really work — bag,
> checkout, follows, Studio product editing, Admin decisions — but nothing persists beyond
> your browser, and no payment provider is connected: orders placed at checkout stay
> "pending payment" and nothing is charged. The backend phase swaps these for PostgreSQL
> (Drizzle), Better Auth, server actions and a payment-provider abstraction without
> changing the page code.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000 — Brand Studio is at `/studio`, the Control Center at `/admin`.
Sign in from any "Follow", "Save" or "Checkout" prompt; in this build sign-in is local.

## Stack

Next.js 16 (App Router, Cache Components, Partial Prefetching) · React 19 · TypeScript ·
Tailwind CSS v4 · shadcn/ui (Radix) · Motion for React · Recharts · Zustand · Sonner.
Next.js 16 differs from older versions — see `AGENTS.md` and `node_modules/next/dist/docs/`.

## Design system

All shared values live in `src/app/globals.css`:

- **Palette** — Black `#080808` (~75%: backgrounds, navigation, product surfaces), Purple
  `#6D19D9` (~15%: active navigation, selected elements, interactive states, brand
  highlights), Yellow `#F5FF00` (~5%: primary CTAs, sale labels, drop announcements,
  high-priority indicators), White `#F5F5F5` / Grey `#858585` (~5%: type, secondary
  information, borders, dividers). Surfaces and hairlines are derived from the black and the
  grey; `violet` (`#9452FF`) is the same purple lifted for small text on black, and `danger`
  is reserved for errors. Bold and high-contrast — no pastels, soft gradients or glow.
- **Type** — Archivo (variable width) condensed for marketplace headlines (`.font-display`),
  expanded for the wordmark (`.font-wide`); Space Grotesk for everything else.
- **Liquid Glass** — `.glass`, `.glass-strong`, `.glass-sheen`, with an opaque fallback where
  `backdrop-filter` is unsupported. Used only on floating elements and overlays.
- **Shape** — 4–10px radii; 16px+ only for floating overlays; full rounding only for chips
  and circular icon buttons.
- **Motion** — Motion for React with `reducedMotion="user"`. One orchestrated moment (the
  Discover hero); everything else responds to what the user does.

## Code map

```
src/app/(market)/      customer marketplace routes (shared shell in layout.tsx)
src/app/studio/        Brand Studio: (workspace) pages in the shell, onboarding full-screen
src/app/admin/         Admin Control Center
src/components/ui/     shadcn/ui primitives, restyled to the theme
src/components/market/ marketplace pieces: ProductCard, BrandCard, DropCard, Countdown,
                       Price, BagDrawer, SearchOverlay, AuthPrompt, SponsoredTag …
src/components/dashboard/  shared Studio/Admin pieces: AppShell, PageHeader, MetricTile,
                       TimeSeriesChart, StatusBadge, PeriodSelect, EmptyState
src/components/storefront/ StorefrontRenderer — public brand pages and the Studio preview
src/config/            site name (Yard), navigation, markets (currencies, countries, shipping)
src/lib/data/          typed sample data + query functions (the backend seam)
src/lib/stores/        browser state: cart, saved, session, orders, studio, admin
                       (saved under "nocturne-*" keys, the old working name, kept on
                       purpose so browsers keep what they have saved)
public/media/          placeholder photography (Unsplash licence), with manifests
```

## Commerce rules already modelled in the frontend

- Money is integer minor units plus a currency code; brands price in their own currency and
  shoppers see an indicative conversion (`src/lib/money.ts`, `src/config/markets.ts`).
- The bag is grouped by brand; one checkout creates one checkout group and one merchant
  order per brand, each with its own shipping (`src/lib/cart.ts`, `src/lib/stores/orders.ts`).
- Checkout submits carry an idempotency key; a repeated submit returns the existing order.
- Sponsored placements sit in designated slots and are always labelled (`src/lib/data/ads.ts`).
- Admin decisions append audit entries; ledger adjustments are requests with a second
  approver (`src/lib/stores/admin.ts`).

## Environment variables

None are needed for the frontend phase. `.env.example` lists the variables the backend
phase will read. Never expose secrets to the browser: only variables prefixed
`NEXT_PUBLIC_` reach client code, and none of the planned secrets use that prefix.

## Sample data and photography

Brands, people and products are fictional. Photos are from Unsplash, used as placeholders
under the Unsplash licence; `public/media/*/manifest.json` records each photo's ID.
Analytics figures on Studio and Admin screens are generated sample data and are labelled
as such.
