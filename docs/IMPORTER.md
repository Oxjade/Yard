# Import from website

An admin tool: paste a brand's own shop address, and Yard finds its products (photos, name, price,
sizes, stock, description) and sends them to the brand as **Suggestions from Yard**. Admin only.

Where: Admin › Brands › a brand (the review tray or the founding tray) › Products › **Import from
website**, which opens `/admin/brands/{brandId}/import` (a page, since it is a multi-step job).

## Consent

The admin must tick **"This brand agreed to us importing their products"** before a scan starts.
The API refuses a scan without it (`consent: true` is required), and the time and the admin are
stored on the import (`catalog_imports.consent_at`, `created_by`) and in the audit log
(`catalog.import_scan_started`, `meta.consent`). Only import a brand's own site, with their
permission.

## Steps

1. **Scan.** The URL is cleaned (tracking parameters such as `utm_*`, `fbclid`, `gclid` removed)
   and a background job reads the site. The page shows progress (pages read, products found) and
   can be left: `?import=<id>` brings you back.
2. **Review.** One card per product: photo thumbnails (from the source, not stored yet), editable
   title, price, currency, sizes (comma list) and stock per size or variant, a category select, the
   warnings, and a tick. **Select all** ticks everything. Products that look like duplicates (same
   source URL imported before, or the same name as a product or suggestion of the brand, or repeated
   on the site) are flagged and unticked; ticking one imports it anyway. For an unclaimed founding
   brand, a Yard owner can also use the site's **logo, banner, description and Instagram/TikTok
   handles** for the storefront draft (tickboxes; on by default only where the brand has none yet).
3. **Import.** The runner copies each ticked product's photos into Yard and creates a suggestion,
   one product at a time, and shows a result per product: created, skipped (with why) or failed
   (with why). The brand gets one notification and one email for the batch ("Yard suggested 4 new
   products"), not one per product.

## What gets created

Each product becomes a **new-product suggestion** (`product_proposals`, `src/server/catalog/proposals.ts`
`createProposal`), exactly as "Add product for brand" makes one: same validation, same audit row
(`catalog.proposal_created`, with `importId` and `sourceUrl` in its meta). Nothing reaches the
catalogue until the brand accepts it in Studio, or, for a founding brand with **Go live when they
claim** on, until the claim accepts Yard's waiting suggestions and publishes the storefront.

Why suggestions and not products created directly through a Yard setup session: a setup session is
a brand session an admin opens in their own browser for Studio; the importer runs in the background
as the admin and works for claimed brands too, where Yard may only suggest. Suggestions also keep
the owner in charge: they see each imported product and accept, edit or decline it, and the
existing "Go live when they claim" path publishes them for brands set up by Yard.

Photos are **never hotlinked**: each one is downloaded once and stored through the upload pipeline
(`src/server/media/upload.ts` `ingestBytes`: the same sniffing, JPEG/PNG/WebP only, metadata
stripping, 64–8000 px, 10 MB cap and per-brand daily volume as an upload), as the brand's own
private media (purpose `social_post`, like a suggestion photo an admin uploads). Logo and banner use
purpose `storefront_cover`, as on the founding brand form. ImageKit and Shopify CDN photos are
requested at most 2000 px wide.

Each variant gets a SKU from the product name and a short hash of its source (`MOLADE-TEE-1A2B3-M`),
so two products with the same name never clash. Processing days come from the site when it states
them (Labeld's production days), otherwise the brand's handling time.

## Platforms

Adapters are tried in order; the first that finds products wins. A home page that clearly belongs
to another platform skips a probe (a Labeld site isn't asked for `/products.json`).

| Platform | How it's read | What comes out |
|---|---|---|
| **Shopify** | `/products.json?limit=250&page=N` | options and variants, prices, compare-at, `available` per variant, images, type and tags. Currency from the home page (`Shopify.currency`, `og:price:currency`) or `/cart.js`. Stock counts aren't public. |
| **WooCommerce** | Store API `/wp-json/wc/store/v1/products?per_page=100&page=N` | prices in minor units with the currency, sale prices, attributes with variations as options, `is_in_stock`, images, categories and tags. Stock counts aren't public. |
| **Labeld** (`<handle>.labeld.app`; `shop.labeld.app/<handle>` is mapped to it) | home page, `/sitemap.xml`, each `/drops/<id>` page, and the drops each page lists as related | Organization JSON-LD for the brand; Product JSON-LD plus the Next.js flight payload record per drop: `sizeOptions`, `colors` (with hex), `stockRemaining` with `stockMode` global (split evenly across variants, with a warning) or variant (`variantStock`), `variantPriceAdjustmentsMinor`, `galleryImages`, production days. The shop's listing loads in the browser, so the sitemap and related products are how every drop is found; no "load more" call is needed. |
| **Any other site** | `robots.txt` sitemaps or `/sitemap.xml` (an index is followed, product sitemaps first) plus the home page's links, product-looking paths first | schema.org Product / ProductGroup JSON-LD (variants' size and colour), then Product microdata, then OpenGraph product tags. ItemList JSON-LD adds the products it lists. |

The brand comes from the site's own Organization/Store JSON-LD (a platform's node is skipped),
then OpenGraph and the meta description.

Warnings the preview shows per product include "No sizes found, defaulting to One size", "Price
missing", "Stock count not shown on the site", "The site counts 10 in stock across all sizes", "No
photos found", "Sold out on the site", and currency notes.

## Currency

Products are priced in the brand's currency (Yard stores one currency per brand). A product priced
in the brand's currency (NGN for a Nigerian brand) keeps its price as it is. A product in another
of Yard's currencies is flagged; switching the currency select converts the price at Yard's
reference rate (`src/config/markets.ts`) and says so. A currency Yard doesn't sell in is flagged and
needs the price entered by hand. The server refuses a ticked product whose currency isn't the
brand's.

## Limits and safety

- **Fetching** (`src/server/catalog/importer/fetch.ts`): http and https only, default ports only, no
  user name or password in the URL; hosts that look internal (`localhost`, single labels, `.local`,
  `.internal`, IP literals in private ranges) are refused; every host is resolved first and refused
  if any address is private, loopback, link-local, CGNAT, multicast or reserved (IPv6 forms that
  carry such an IPv4 address included), and the connection goes to that vetted address (no second
  lookup). At most 5 redirects, each checked the same way. 15 s per request; 5 MB per page and
  10 MB per photo, counted after decompression. User-Agent `YardImporter/1.0 (+https://yardstore.space)`.
- **Politeness**: at most 2 requests at a time to a site, 350 ms between request starts, at most
  440 requests per scan, at most **200 products** per scan, 8 photos per product.
- **Rate limits**: 20 scans an hour (100 a day) per admin, 10 an hour per brand, 30 import runs an
  hour per admin; one running import per brand.
- **Egress proxy**: when `YARD_IMPORTER_PROXY=http://host:port` is set, requests tunnel through it
  with CONNECT. The address check still runs whenever the host resolves locally; a host only the
  proxy can resolve is left to the proxy's policy.

## Permissions and audit

`catalog.propose` (the permission behind Suggestions from Yard); an unclaimed founding brand also
needs `brands.founding` (Yard setup territory), and only that combination may fill the storefront
draft. Suspended brands and the sample brands are refused. Audit actions:
`catalog.import_scan_started`, `catalog.import_scanned`, `catalog.import_started`,
`catalog.import_finished`, `catalog.import_failed`, plus `catalog.proposal_created` per product and
`founding.updated` when the storefront draft is filled in.

## Resuming and idempotency

Imports live in `catalog_imports` and `catalog_import_items` (migration 0023). A runner claims an
import with a 3-minute lease, renewed as it works; it is kicked when a scan or import starts and
picks up interrupted work every minute (`catalog.runImports` in `src/server/schedulers.ts`). A
restarted scan starts over; a restarted import carries on with the products still waiting and the
photos not yet copied (each copied photo is recorded before the next). A suggestion and its item's
"created" mark commit in one transaction, so a crash can't make a second suggestion. Products
already created in an import are never created again; a new scan of the same URL flags them
"Imported before" and leaves them unticked. Source URLs are stored per item.

## Watching a website

After an import (or from the import page once a scan has read the site), an admin can switch on
**Keep watching {site} for new pieces** for that brand. It is off by default, admin only
(`catalog.propose`, plus `brands.founding` for an unclaimed founding brand), and one website per
brand: the address and platform of the import on screen (else the brand's latest scan). Switching
it on again with another import replaces the address. Stored in `catalog_watches` (migration 0024):
source URL, adapter, last check, next check, failures, pause note.

**The check.** Job `catalog.watchSites` (`src/server/schedulers.ts`) runs every 15 minutes and
checks the watches that are due, at most `YARD_IMPORTER_WATCH_PER_RUN` brands a run (default 4),
most overdue first. Each site is checked every `YARD_IMPORTER_WATCH_HOURS` hours (default 6), with
±10 % spread per brand so brands switched on together drift apart. When nothing is due a run is one
indexed query. A check goes through the importer's own fetcher (the same address checks, 2 requests
at a time, 350 ms apart, `YardImporter/1.0` user agent, `YARD_IMPORTER_PROXY`), tries only the
adapter the watch was set up with, and reads only what it needs: the listing (home page, sitemap or
`products.json` / Store API pages), product pages it has never seen, and the pages of pieces already
in Yard (for changes). Pieces passed over or waiting are not read again. At most 120 requests per
check; for 813israw.labeld.app (4 products, 2 in Yard) a check is 4 requests. **Admin › Check now**
runs one at once (6 an hour per brand).

**Cost.** No paid service is called. Each check is a handful of outbound HTTP requests to the brand's
own site, so the cost is flat in time: with the defaults, at most 4 brands × 4 runs an hour = 16
checks an hour, about 96 brands per 6-hour cycle (raise `YARD_IMPORTER_WATCH_PER_RUN` past that).
Photos are copied into Yard **only when a piece is approved** (lazily), so a piece that's skipped
never costs storage.

**Failures.** A failed check (site down, refused, no products found) is retried after 6, 12, 24,
then 48 hours; the fifth failure in a row **pauses** the watch with a note Admin shows ("Paused
after 5 failed checks in a row. The last one said: …"). **Resume and check now** clears it.

### New pieces only

`catalog_site_pieces` is everything Yard has seen on a brand's site, one row per address
(`url_key`: no protocol, `www`, trailing slash; the source id matches too):

| Status | Meaning |
|---|---|
| `imported` | Created by an import (with its suggestion). |
| `ignored` | Seen and passed over: **unticked or skipped at import**, a duplicate by name of something in Yard, or on the site when watching started. |
| `waiting` | New: in "New from their website" (Admin) and "New from your website" (Studio). |
| `approving` | Taken by one side; photos copying. |
| `approved` | Added (a suggestion from Yard, or a product the brand created). |
| `skipped` | Rejected by the brand ("Not this one") or Yard ("Skip"). |

Every import records what its scan found when it finishes (`seen.ts recordImportSeen`), and
switching watching on records every earlier import of the brand, so only products that appear on
the site **after** are new. Anything with a row is never offered again; a skipped piece never comes
back. The first check of a brand with nothing recorded (no import) records the site as it is.

**Changes on their site.** For pieces in Yard (`imported`, `approved`) a check compares the site's
price and availability with the baseline (as imported or approved): a different price in the same
currency, or sold out where it was available, is **flagged** in "Changes on their site" (import
page, and a count in the brand tray), with Suggest a change / Open suggestion and Dismiss (which
takes the site's value as the new baseline). Yard's product is never changed. A flag clears itself
when the site goes back.

### Approval: either side, first wins

- **Admin** (brand tray › Products, and the import page): "New from their website (N)", each with
  Approve / Skip, and Approve all. **Approve makes the normal Suggestion from Yard** (`createProposal`,
  with the brand told by notification and email); the brand accepts it in Studio. For an unclaimed
  founding brand with **Go live when they claim**, the claim accepts it, so there Yard's approval is
  effectively final. Approve all takes every waiting piece for Yard at once (so the brand can't add
  one twice), then adds them in the background; the brand hears once for the batch.
- **Brand** (Studio › Products, "New from your website (N)", plus a card on Overview): a preview
  (the site's photos, price in the brand's currency, sizes, description) with **Add to Yard** and
  **Not this one** (`content.publish`). Add to Yard copies the photos as the brand's uploads and
  creates the product as the brand (`createProduct`, then `setProductStatus` publish when the brand
  may publish: the same path as accepting a suggestion), so it's live at once if the shop is.
- **First wins** (`pieces-db.ts`): approving first takes the row (`waiting → approving`, one
  conditional UPDATE, with a 3-minute claim), copies the photos (each recorded, so a retry reuses
  them), then creates the suggestion or product and marks the row `approved` **in one transaction**
  that only commits while that side still holds the row. Skip is one conditional UPDATE from
  `waiting`. The other side gets 409 ("The brand already added this piece", "Yard got to this piece
  first") and the item leaves its list. A failed approval puts the row back to waiting with the
  reason. An approval a crash interrupted is finished by the next job run (Yard's) or put back (a
  brand's).
- One tap uses the importer's preview rules with no one editing: the site's price (a price in
  another of Yard's currencies converted at the reference rate), sizes and stock as the site shows
  them (none shown: 0), the guessed category. A piece with no price, or in a currency Yard doesn't
  convert, can't be added in one tap and says so.

**Telling the brand.** One notification and one email per check that found new pieces ("3 new
pieces from your website are waiting. Add them to Yard in one tap."), linking to
`/studio/products#from-website`; the email respects the brand's reminder switch
(docs/BRAND-EMAILS.md). Unclaimed brands aren't told. Admin sees the count in the brand tray and on
the import page.

**Audit.** `catalog.watch_started`, `catalog.watch_stopped`, `catalog.watch_checked`,
`catalog.watch_resumed`, `catalog.watch_scanned`, `catalog.watch_failed`, `catalog.watch_paused`,
`catalog.website_piece_approved` (admin), `catalog.website_piece_added` (brand),
`catalog.website_piece_skipped`, `catalog.website_pieces_approve_all`,
`catalog.website_change_dismissed`, `brand_email.website_pieces`.

**Trying it locally.** Import a site with only some products ticked, switch watching on and press
Check now: nothing is new (the unticked ones are seen). To see new pieces, make Yard forget some
pieces, then Check now:

```sql
-- the brand's pieces passed over at import become unseen; the next check offers them as new
DELETE FROM catalog_site_pieces WHERE brand_id = '<brandId>' AND status = 'ignored';
```

With the embedded database, stop the server first and run it through PGlite
(`new PGlite("<data dir>/production/pg")` for `start:demo`, `<data dir>/development/pg` for dev).
The saved Labeld pages in `fixtures/` drive the same flow in `watch.test.ts`.

## Create brand from website

Founding-brand onboarding in one page: **paste, check, send**. Admin › Brands › Founding › **Create
brand from website** opens `/admin/brands/founding/from-website` (owners: `brands.founding`, plus
`catalog.propose`). It is the pieces above put together, not a second system
(`src/server/catalog/from-website.ts`, page `src/components/admin/importer/from-website-page.tsx`,
rules `src/lib/from-website.ts`):

1. **Scan.** Paste the site and tick the required **"This brand agreed to us building their Yard
   store from their website"**. The importer's own scan runs on a `catalog_imports` row with no
   brand yet (`brand_id` is null until Create store, migration 0025); consent and admin are stored
   and audited (`catalog.import_scan_started`, `meta.newFoundingBrand`). 10 scans an hour per site.
   `?import=<id>` resumes the page.
2. **Review**, one screen:
   - **Brand card**, every field editable: name (the site's), handle (from the site's subdomain or
     domain, `813israw.labeld.app` → `813israw`, else from the name; the first free one of it and
     `-studio`, `-official`, `-yard`, `-2`…, then checked live as typed), category (the products'
     most common), city, country and currency (best guesses with the reason shown: a Labeld shop is
     NG/NGN; the city only when the site names one, from its JSON-LD address or a line like
     "Lagos State, Nigeria"; else the products' currency and the domain's country code), logo and
     banner chosen from the site's images (its own logo and banner first, then product photos, or
     none), bio, Instagram and TikTok. Changing the currency converts every product price at Yard's
     reference rate.
   - **Duplicates**: a founding or normal brand with the same website (an import or watch of the
     same host), a similar handle (same without hyphens, one inside the other from 5 characters, or
     one typo apart from 6) or the same name is listed with a link to it. It warns; it doesn't block.
   - **Products**: the import page's own rows (tick, select all, title, price, currency, category,
     sizes, stock).
   - Three switches, all on: **Go live when they claim**, **Keep watching their website for new
     pieces**, **Show Founding brand badge**.
3. **Create store** (`POST …/from-website/{importId}/create`): everything that could refuse the
   import is checked first, then `createFoundingBrand` (unclaimed, starter shipping, storefront
   draft with the bio as intro), the scan is attached to the brand, a switch turned off is written
   with `updateFoundingBrand`, the chosen logo and banner become the scan's site images and
   `startImport` runs (products as Suggestions from Yard; logo and banner copied into the brand and
   the draft by the import's storefront step), then `setWatch`. The page shows each step until the
   import is done.
   **Idempotent:** the request key (kept in the tab's session storage per scan) is the founding
   brand's creation key, so a double click, a retry or a reload replays it; `planCreate` works out
   what's still missing from what exists (brand, scan attached, switches, import started, watch), and
   one Create store per key runs at a time in a process. A scan is only ever attached to one brand.
4. **Summary and claim link:** "{Brand} is ready: 4 products, logo, banner, goes live when they
   claim", a preview of the shop as it opens on claim (banner, logo, intro, the products as Yard
   copied them), and the founding tray's own claim composer (owner's email, Send claim link, the
   same endpoint and re-auth). The link is shown once to copy, with **Open their claim page** and
   **Send it on WhatsApp**.

Audit: `catalog.import_scan_started`, `founding.created`, `founding.created_from_website` (the
switches, product count, logo and banner), `founding.go_live_on_claim_off` / `founding.badge_off`
when switched off, `catalog.import_started` and the import's own rows, `founding.updated` (logo and
banner), `catalog.watch_started`, `founding.claim_link_issued`.

## API

| Method | Path | |
|---|---|---|
| GET | `/api/admin/brand-imports?brandId=` | the brand as the importer sees it, last 20 imports |
| POST | `/api/admin/brand-imports` | `{ brandId, url, consent: true }` → 201, starts a scan |
| GET | `/api/admin/brand-imports/{id}` | progress, found products, per-item results |
| POST | `/api/admin/brand-imports/{id}/import` | `{ products: [...], profile?, note? }` → 202 |
| GET | `/api/admin/brand-watch?brandId=` | the watch, waiting pieces, changes, seen count |
| PUT | `/api/admin/brand-watch` | `{ brandId, enabled, importId? }`: watching on or off |
| POST | `/api/admin/brand-watch/check` | `{ brandId, resume? }`: Check now (and Resume) |
| POST | `/api/admin/website-pieces/{id}` | `{ action: "approve" \| "skip" \| "dismiss_change" }` |
| POST | `/api/admin/website-pieces` | `{ brandId, action: "approve_all" }` → 202 |
| GET | `/api/studio/catalog/website-pieces` | the brand's waiting pieces (any member) |
| POST | `/api/studio/catalog/website-pieces/{id}` | `{ action: "add" \| "skip" }` (`content.publish`) |
| POST | `/api/admin/founding-brands/from-website` | `{ url, consent: true }` → 201, a scan with no brand yet |
| GET | `/api/admin/founding-brands/from-website/{importId}` | progress, products, suggestion, duplicates, and the brand once created |
| POST | `/api/admin/founding-brands/from-website/{importId}/create` | `{ brand, logoUrl, bannerUrl, products, goLiveOnClaim, watch, foundingBadge }` → 201 (200 replay) |

Code: `src/server/catalog/importer/` (`url.ts`, `fetch.ts`, `html.ts`, `normalize.ts`,
`scan.ts`, `adapters/`, `service.ts`; watching: `watch.ts`, `watch-rules.ts`, `pieces-db.ts`,
`seen.ts`), the page `src/components/admin/importer/import-page.tsx` (watching:
`website-watch.tsx`; Studio: `src/components/studio/catalog/website-pieces.tsx`),
shared rules `src/lib/importer.ts`, contracts `src/lib/api/contracts/imports.ts`. Tests:
`src/server/catalog/importer/importer.test.ts` and `watch.test.ts` with saved pages in `fixtures/` (the Labeld pages
are real pages of 813israw.labeld.app with personal details redacted; the Shopify, WooCommerce and
generic fixtures are hand-written in those APIs' shapes).
