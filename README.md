# Yard

A global, discovery-driven marketplace for independent brands. It has three experiences:

| Area | Route | Feel |
|---|---|---|
| Customer marketplace | `/` and everything under `src/app/(market)` | Dark, editorial, photographic |
| Brand Studio (merchants) | `/studio` (`src/app/studio`) | Graphite, structured, analytical |
| Admin Control Center (internal) | `/admin` (`src/app/admin`) | Dense, operational |

> **Status: v2 adds an embedded server** for social connections, the Inbox, Charts, Around
> and delivery estimates (see "The v2 embedded server" below). The pages that existed before
> v2 still run on the browser data layer described next.
>
> - **Navigation:** the desktop header links Discover, Brands, Charts, Around, Drops and
>   Following, then Search, Inbox, notifications, Wishlist, Cart and your profile. Phones get a
>   home bar: Home, Explore (search, opening on Charts, Around, Drops, Brands, Shop and
>   Categories), the raised Around pin, Cart and Me. Shop and Categories live in Explore, the
>   footer and Discover. The shopping bag is called the cart everywhere (the route is still `/bag`).
> - **Studio** has Inbox, Social (Social connections and Content Studio), Locations and
>   Shipping & fulfilment in its sidebar, with live badges, and an Overview card that ticks off
>   the new features from server state. **Admin** has Delivery, Messages, Content and Charts
>   queues with live counts; Moderation is now called Listings.
> - **Still labelled, not connected:** no payment provider (receipts say "Not charged" and
>   "Order received — awaiting payment confirmation. Nothing was charged."); Instagram and TikTok
>   need app keys (a development sandbox stands in); Charts and Around carry sample activity and
>   sample places; delivery dates are estimates.
>
> **Frontend phase.** Every screen runs on a typed local data layer
> (`src/lib/data/*`) and browser stores (`src/lib/stores/*`), so flows really work — cart,
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
src/server/            the v2 server: env, db (PGlite, schema, seeds), auth, http (route
                       wrapper, CSRF), security, realtime bus, audit, notify, feature modules
src/app/api/           v2 Route Handlers (thin adapters over src/server)
src/lib/api/           typed fetch helpers, useApi and the zod contracts shared by both sides
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

## The v2 embedded server

v2 runs a real server layer inside the one Next.js process: an embedded Postgres (PGlite,
nothing to install), Drizzle schema and migrations, Route Handlers under `src/app/api`, server
sessions for demo accounts, and realtime over Server-Sent Events. `npm run dev` keeps working
with no setup: the first start creates the database, migrates it and seeds it (about 5 s).

**Where the data lives.** Outside the repository, in `~/.yard/<repo folder>-<hash>/` (mode
`0700`), or wherever `YARD_DATA_DIR` points:

```
<dataDir>/development/pg/            the development database
<dataDir>/development/uploads/       uploaded files (never under public/)
<dataDir>/development/secrets.json   generated development secrets (mode 0600)
<dataDir>/development.lock           the pid of the server using it
<dataDir>/production/…               the same for `next start`, kept apart
```

It sits outside the repo so a zip of the project never carries the database, private uploads
or keys. If you point `YARD_DATA_DIR` inside the repository (`/.data/` is git-ignored),
exclude it from any archive you share. One server process per data directory: a second one
refuses to start ("Another Yard server (pid N) …").

**Scripts.**

| Command | What it does |
|---|---|
| `npm run db:check` | Data-dir and secrets modes, anything under the data dir other users can reach, the lock's pid, migrations and every seed module's version (from the running dev server), then each cluster's checks in `scripts/checks/`. `node scripts/db-check.mjs lock` prints just the data dir and lock; `node scripts/db-check.mjs fix-modes` removes group and other access under the data dir |
| `npm run db:reset` | Deletes the development database and uploads (refuses while a dev server holds the lock); the next `npm run dev` reseeds |
| `npm run db:generate` | `drizzle-kit generate` after a schema change in `src/server/db/schema/*.ts`. Migrations run in-process at boot; never run `drizzle-kit push`, `migrate` or `studio` against the data directory. A schema change needs a dev restart |
| `npm test` | Unit tests beside the pure modules (`*.test.ts`, run with tsx) |
| `npm run admin:create -- --email … --name "…"` | One-time bootstrap of the **first real owner admin** on a deployment (see below). Refuses once a real owner exists |
| `npm run start:demo` | A **local demo** of the production build on port 3001 with demo sign-in on (generated production secrets in `<dataDir>/production/demo-secrets.json`). It listens on 127.0.0.1 only; `YARD_DEMO_HOST=0.0.0.0` exposes it to your network, which lets anyone there sign in without a password. Not a deployment |

**Accounts and demo data.** Shopper email/password accounts, email verification, password reset,
magic links, configured Google/Apple sign-in, brand invitations and admin MFA use server sessions.
Demo accounts remain available in development. Production demo sign-in and sample seeding are
off by default; enable both `YARD_DEMO_AUTH=1` and `YARD_SEED_DEMO=1` only for an isolated demo
deployment (add `YARD_DEMO_ADMIN=1` only when demo admin access is also intended). Demo sign-in
logs a warning, and disabling its flag ends the sessions it allowed. Production should use a
fresh data directory; the seed guard does not delete sample records from an existing database.

**What a production database contains.** Seeding has two parts. *Reference data* is seeded in
every environment, production included: the category taxonomy (Studio product create and brand
onboarding check against it) and the public-holiday calendar that delivery estimates read.
*Demo fixtures* (sample people, brands, the sample catalogue, drops, orders, places, shipping
profiles, delivery, social posts, inbox, safety reports and charts) are seeded only in
development/test or with `YARD_SEED_DEMO=1`. So a production database starts with categories and
holidays but **no brands, no products and no admins**.

> **Not launch-ready: the public shop is still the built-in sample catalogue.** The storefront
> pages (home, shop, categories, brands, product pages, quick-add) render the static sample
> products in `src/lib/data`, while the cart and checkout price against the **server** catalogue
> (`/api/cart/lines`). With demo seeding off, the server catalogue is empty, so every sample
> product is shown but **every add-to-cart fails** ("That piece isn't available"). The server
> logs a loud warning at every boot while the catalogue is empty. Before a real launch the
> storefront must be moved to the server catalogue (`/api/catalog/*`) and brands must list their
> own products. Until then, run production only as an isolated demo (`YARD_DEMO_AUTH=1` and
> `YARD_SEED_DEMO=1`), or don't open it to shoppers.

**The first admin.** Seeded admins are demo accounts and never get a password, and only an owner
admin can add admins (Admin → Team), so the first real owner is created once from the command
line, on the server machine:

```
# stop the server first: PGlite allows one process per data directory
npm run admin:create -- --email you@example.com --name "Your Name"
```

Run it with the same environment as the server (`YARD_DATA_DIR`, `YARD_PUBLIC_URL`, the secrets
and any `EMAIL_*` settings; like `next start` it reads `.env.production.local`, `.env.local`,
`.env.production` and `.env`, and `NODE_ENV` defaults to `production`). It opens the database
through the server's own modules (dev dependency `tsx`), creates an `owner` admin, queues a
72-hour "set your password" email and prints the link itself when no email provider is
configured (or with `--print-link`): hand it over privately. The owner sets a password, signs
in at `/admin` and enrols two-step verification. The script refuses while a server holds the
lock, refuses any role other than `owner`, and refuses once any real (non-demo) owner exists;
every later admin is added by an owner from the Control Center.

**Shared networks.** `npm run dev` listens on every interface, and its demo sign-in has no
passwords. On a network you don't control, run `npx next dev -H 127.0.0.1` instead. Even on
loopback, development only trusts requests addressed to `localhost`, `127.0.0.1`, `[::1]` or
`YARD_PUBLIC_URL`'s host, so a page that re-points its own domain at your machine (DNS
rebinding) can't pass the CSRF check.

**Deployment notes.**
- This layer targets one long-running Node process: not serverless, not horizontally scaled.
- Run Yard behind exactly one reverse proxy that sets `X-Forwarded-For`, and set
  `YARD_TRUSTED_PROXY_HOPS=1`. Without it, Yard can't see client IPs, and IP-based abuse
  controls stay off (per-account and global limits still apply).
- `YARD_PUBLIC_URL` must be the public `https://` origin: it is the CSRF origin and the OAuth
  redirect base, and https makes the session cookies `Secure` and `__Host-` prefixed.
- Rotating `YARD_SESSION_SECRET` ends every session, OAuth state, quote token and anonymous
  visitor id, and starts a new series of IP hashes (they already rotate monthly, so at most the
  current month's link between fraud evidence is lost). `YARD_ENCRYPTION_KEY` seals social
  tokens only; rotate it with `YARD_ENCRYPTION_KEY_PREVIOUS` set to the old key.

## Environment variables

`.env.example` is safe to copy to `.env.local` as it is: demo sign-in and demo seeding stay off
in production and development secrets are generated for you. In production `YARD_DEMO_AUTH=1`
and `YARD_SEED_DEMO=1` go together: either one without the other stops the server at boot. Never expose secrets to the browser: only
variables prefixed `NEXT_PUBLIC_` reach client code, and none of the secrets use that prefix.
The old backend-phase placeholders at the end of the file aren't read by the embedded server.

## Sample data and photography

Brands, people and products are fictional. Photos are from Unsplash, used as placeholders
under the Unsplash licence; `public/media/*/manifest.json` records each photo's ID.
Analytics figures on Studio and Admin screens are generated sample data and are labelled
as such.
