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

## API

| Method | Path | |
|---|---|---|
| GET | `/api/admin/brand-imports?brandId=` | the brand as the importer sees it, last 20 imports |
| POST | `/api/admin/brand-imports` | `{ brandId, url, consent: true }` → 201, starts a scan |
| GET | `/api/admin/brand-imports/{id}` | progress, found products, per-item results |
| POST | `/api/admin/brand-imports/{id}/import` | `{ products: [...], profile?, note? }` → 202 |

Code: `src/server/catalog/importer/` (`url.ts`, `fetch.ts`, `html.ts`, `normalize.ts`,
`scan.ts`, `adapters/`, `service.ts`), the page `src/components/admin/importer/import-page.tsx`,
shared rules `src/lib/importer.ts`, contracts `src/lib/api/contracts/imports.ts`. Tests:
`src/server/catalog/importer/importer.test.ts` with saved pages in `fixtures/` (the Labeld pages
are real pages of 813israw.labeld.app with personal details redacted; the Shopify, WooCommerce and
generic fixtures are hand-written in those APIs' shapes).
