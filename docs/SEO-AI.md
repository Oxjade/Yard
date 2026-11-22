# Search engines and AI assistants

This page covers how Yard (yardstore.space) helps search engines, Google Shopping and AI assistants (ChatGPT, Perplexity, Claude, Google AI Overviews) read its catalogue, trust it and recommend it, and what the owner has to set up outside the code.

All of it is category-neutral. Categories, brands and products come from the database, so nothing assumes Yard sells only fashion.

## What was built

| Surface | Address | Source |
|---|---|---|
| Structured data (schema.org JSON-LD) | in the HTML of public pages | `src/lib/seo/json-ld.ts`, `src/components/seo/json-ld.tsx` |
| robots.txt | `/robots.txt` | `src/app/robots.ts` |
| llms.txt and llms-full.txt | `/llms.txt`, `/llms-full.txt` | `src/lib/seo/llms.ts`, `src/app/llms.txt`, `src/app/llms-full.txt` |
| Product feed (Google Merchant Center) | `/feeds/google.xml` | `src/lib/seo/feed.ts`, `src/app/feeds/google.xml` |
| Product feed (JSON) | `/feeds/products.json` | same items, `src/app/feeds/products.json` |
| Sitemap | `/sitemap.xml` (an index of `/sitemaps/<n>.xml` past 50,000 URLs) | `src/lib/seo/sitemap.ts`, `src/app/sitemap.xml`, `src/app/sitemaps/[part]` |
| Server reads and caching | | `src/server/seo/catalog.ts` |

### Structured data

Each page has one `<script type="application/ld+json">` with a single `@graph`, rendered on the server. Every `<`, `>` and `&` is escaped, so a product name can't break out of the tag.

- **Product pages**: a `Product` with name, description, images, SKU, `Brand` (name and storefront URL), category path and URL.
  - **Variants:** when a product has several variants and their options are ones schema.org can name (size, colour, material, pattern), it becomes a `ProductGroup` with `hasVariant`, `variesBy` and an `Offer` for each variant. Products with other options get one `Offer`, or an `AggregateOffer` when variant prices differ.
  - **Offers** carry price, currency, URL, `NewCondition` and the brand as `seller`.
  - **Availability:**
    - `InStock` or `OutOfStock` from live stock.
    - `PreOrder` with `availabilityStarts` while the piece's drop hasn't opened yet.
    - `OutOfStock` while a founding brand isn't selling yet.
  - **Delivery and returns:**
    - `shippingDetails` comes from the brand's own shipping zones and rates (the rate tier that applies to the price, and the cheapest method in each zone). Zones that don't name countries are left out.
    - `hasMerchantReturnPolicy` states Yard's minimum policy from /legal/refunds: 7 days, Nigeria, return by mail, the customer pays return postage.
  - **BreadcrumbList:** Shop › Category › Brand › Product.
  - **No `aggregateRating`:** Yard has no reviews yet, and none are invented.
- **Brand storefronts**:
  - An `Organization` with name, URL, description, logo, cover image, `sameAs` links (Instagram, TikTok, X, website) and address (city and country).
  - The brand's own words are used for the description. When it has none, the description is built from facts.
  - An `ItemList` of its live products.
  - A `BreadcrumbList`: Brands › Brand.
- **Home**: Yard as an `Organization` (logo `/icon/512`, support contact) and the `WebSite` with a `SearchAction` on `/shop?q={search_term_string}`.
- **Categories, brand collections, drops, the drops index and charts**: a `CollectionPage` whose `mainEntity` is an `ItemList`, plus a `BreadcrumbList`.
  - Category pages stay fully static (`ensureStatic`), so their list holds the category's subcategory listings. Their products are listed in the sitemap and the feed.
  - Charts list the board on screen in rank order. Sponsored slots are left out.

### Metadata

- **Product and brand pages** have a title, a meta description, a canonical URL, Open Graph and Twitter cards with images.
- **Fallback description:** when a brand leaves a product description empty, it is built from facts: "{Product} by {Brand}, {city}. {price}. {category}." A brand with no intro or story gets "{Brand} is an independent brand from {city}, {country}, selling on Yard."
- **Canonical URLs** are also set on categories, collections, drops and charts.
- The root `<head>` links `/llms.txt` as `rel="alternate"`.

### robots.txt

- **AI and search crawlers:** these get their own group that allows the site: Googlebot, Bingbot, Applebot, Applebot-Extended, Google-Extended, GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User, Claude-SearchBot, PerplexityBot and Perplexity-User.
- **Private areas:** every group, including `*`, keeps the same disallows (admin, Studio, API, auth, account, bag, checkout, inbox and so on). A crawler with its own group ignores `*`, so the list is repeated.
- **Photos:** `/api/media/` is allowed explicitly, because product photos are served from there and `Disallow: /api/` used to hide them from Google Images and Merchant Center. Anonymous requests only ever get public media from that route.
- **Sitemap:** robots.txt points to `/sitemap.xml`.
- **Opting out of training:** to stay in AI search but out of model training, remove `GPTBot`, `ClaudeBot`, `Google-Extended` and `Applebot-Extended` from `AI_AND_SEARCH_CRAWLERS` and add a group that disallows `/` for them.

### llms.txt

- **llms.txt** follows llmstxt.org: an H1, a one-paragraph summary, who Yard is for, how buying works (one checkout for several brands, payment, delivery estimates, drops, returns, cancellations, support), key pages, legal pages, and the machine-readable surfaces.
- **llms-full.txt** adds every live brand (name, one-line description, city, product count and link) and each category with its product and brand counts.

### Product feed

- **Format:** RSS 2.0 with the `g:` namespace, one item per sellable variant.
- **Fields:**
  - `id`: the brand handle plus the SKU. No internal ids.
  - `item_group_id`: the product slug.
  - title, description, link, `image_link`, up to 10 `additional_image_link`.
  - `availability` (`in_stock`, `out_of_stock`, or `preorder` with `availability_date` for drops that haven't opened).
  - `price`, plus `sale_price` when a compare-at price exists.
  - brand, `condition` new, `identifier_exists` no (independent brands' own goods have no GTIN), size, colour, material and pattern.
  - `product_type`: Yard's category path.
  - `google_product_category`: only where the mapping is safe (see `GOOGLE_PRODUCT_CATEGORY` in `src/lib/seo/feed.ts`).
  - `shipping` per country from the brand's rates, and `custom_label_0` set to the brand's city and country.
- **What is included:** live, sellable products only. The SQL uses `productPublicWhere`, and each row is re-checked with the pure rule (`feedEligible` → `page-visibility.ts`). The product must be published or scheduled-and-due, not moderation-hidden, with a listed and launched brand, not restricted or suspended, never a refused sample, the brand must be selling, and the product needs at least one variant and one photo.
- **Excluded:** opens-soon pieces of founding brands, drafts, hidden pieces and restricted brands.
- **Paging:** pages of 5,000 items, with `?page=N` for the rest. The RSS gives an `atom:link rel="next"` and the JSON a `next` URL.
- **JSON feed:** `/feeds/products.json` has the same items as camelCase JSON.

### Sitemap

- **Contents:** the fixed public pages, then every listed brand, live product (with its photos as image entries), category, published collection and public drop, each with `lastModified`.
- **Excluded:** opens-soon brands and their pieces, drafts, hidden pieces and restricted brands.
- **Size:** up to 50,000 URLs, `/sitemap.xml` is the urlset itself. Past that it becomes a sitemap index of `/sitemaps/<n>.xml`.
- **Why a route handler:** in this Next version, `generateSitemaps` serves `/sitemap/<id>.xml` with no index and fixes its ids at build time, when the database isn't read. So `/sitemap.xml` is a route handler, not `sitemap.ts`.

### Cost: flat, follows time not traffic

Each whole document is built once and kept in the server's memo (`src/server/cache.ts`), however often crawlers ask:

| Document | Rebuilt at most every |
|---|---|
| feeds | 30 minutes |
| sitemap | 30 minutes |
| llms files | 1 hour |

- **HTTP caching:** responses carry `Cache-Control: public, max-age=…`, so Caddy or a CDN can serve repeats without reaching the app.
- **Catalogue writes:** the keys are outside `catalog:`, so a busy shop's sales don't trigger rebuilds. A product that is hidden or goes out of stock can still appear in the feed for up to 30 minutes. That is well inside how often Google fetches a feed (daily at most).
- **Product pages** add three small memoised reads to their JSON-LD: categories, the brand's shipping profile and the product's upcoming drop.
- **No paid services:** nothing new runs on a schedule and nothing new is billed.

### Caveats

- **Drops and `preorder`:** a drop's pieces can't be bought before the drop opens. Google's `preorder` means "taking orders now". If Merchant Center reports an availability mismatch for drop pieces, change the `PreOrder` branch in `availabilityOf` (`src/lib/seo/json-ld.ts`) to return `OutOfStock`. It is one line.
- **Returns policy:** the policy in structured data is Yard's minimum. A brand that offers longer returns is still described as 7 days.
- **Build-time addresses:** static pages (home, categories) render their absolute URLs with `YARD_PUBLIC_URL` as it was at build time, like the root `metadataBase` already does. Build with the production address set.

## Owner's steps

### 1. Google Search Console

1. Go to https://search.google.com/search-console and add a **Domain** property for `yardstore.space`.
2. Verify it with the DNS TXT record Google gives you, added at your DNS provider. Wait for it to resolve, then click Verify.
3. Open Sitemaps and submit `https://yardstore.space/sitemap.xml`.
4. Use URL Inspection on a product page and a brand page and request indexing. The Enhancements and Shopping sections fill in over the following days.

### 2. Google Merchant Center: free listings

1. Go to https://merchants.google.com, create the account for Yard and claim `yardstore.space`. Linking Search Console verifies the site.
2. In **Settings › Business information**, set Yard's address, customer support contact (support@yardstore.space) and the website.
3. Turn on **free listings** (Growth › Manage programs › Free product listings).
4. **Products › Data sources › Add product source › Add products from a file › Enter a link to your file**: `https://yardstore.space/feeds/google.xml`. Schedule a daily fetch. If a feed ever grows past 5,000 items, add `?page=2`, `?page=3` and so on as further sources.
5. **Shipping and returns** (Settings › Shipping and returns): the feed already carries per-item `shipping` from each brand's own rates.
   - Add a Nigeria shipping service as a fallback for items without one, with the typical cost and transit time.
   - Add a return policy for Nigeria: 7 days, customer pays return postage, policy URL `https://yardstore.space/legal/refunds`. International orders are final sale, so add no return policy for other countries.
6. Check **Diagnostics** after the first fetch. The usual first-run issues are photos Google can't fetch (robots.txt now allows `/api/media/`), and prices or availability that differ from the page.

### 3. Bing Webmaster Tools (also feeds ChatGPT search)

1. Go to https://www.bing.com/webmasters and sign in. Choose **Import from Google Search Console** (fastest), or add the site and verify it with a DNS record.
2. Submit `https://yardstore.space/sitemap.xml` under Sitemaps.
3. Optionally turn on **IndexNow** so Bing hears about new pages sooner.
4. ChatGPT search draws on Bing's index as well as its own crawler (OAI-SearchBot), so being indexed by Bing helps Yard appear in ChatGPT answers.

### 4. Testing structured data

- **Google Rich Results Test** (https://search.google.com/test/rich-results): paste a product URL and expect "Product snippets" and "Merchant listings" with no errors. Paste a brand page and expect "Breadcrumbs". Warnings for optional fields, like a missing GTIN, are fine.
- **Schema Markup Validator** (https://validator.schema.org): paste any page URL (home, a brand, a category, a drop, charts) to check the full graph against schema.org.
- **Locally:** `npm test` runs the JSON-LD, feed, sitemap and llms tests. On a running server, to see a page's JSON-LD:

  ```sh
  curl -s https://yardstore.space/products/<slug> | sed -n 's/.*<script type="application\/ld+json">\([^<]*\)<\/script>.*/\1/p'
  ```

### 5. ChatGPT, Perplexity and other AI shopping programs

These programs change often. Check each one's current availability, countries and terms before applying.

- **ChatGPT (OpenAI):** ChatGPT shows products in shopping answers from what OAI-SearchBot and Bing find. robots.txt already allows OAI-SearchBot and ChatGPT-User, and the structured data and sitemap make products readable. OpenAI has also run a merchant program for product feeds and checkout inside ChatGPT. If it is open to Yard's market, `/feeds/products.json` (or the Google feed) is the starting point.
- **Perplexity:** Perplexity's shopping results come from its crawler (PerplexityBot, allowed) and from merchant programs it has run for retailers. Check Perplexity's merchant or publisher program pages for current eligibility. The JSON feed is ready to share.
- **Google AI Overviews and AI Mode** use Google's regular index and Merchant Center data. Steps 1 and 2 cover them.
- **Claude (Anthropic)** reads the web through Claude-SearchBot and Claude-User, which are both allowed. llms.txt gives it the short version of Yard.
