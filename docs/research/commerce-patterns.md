# Build Brief: Brand-First Discovery and Commerce Marketplace (v1)

**Audience:** engineering for the three apps: Marketplace (customer), Brand Studio (merchant) and Admin Control Center.
**Stack:** Next.js App Router, TypeScript, Tailwind, shadcn/ui, Motion, Drizzle and PostgreSQL, Better Auth, Redis and BullMQ.
**Markers used in this brief:**
- **Decision** is binding for v1 unless the product owner overrides it in §10.
- *(unverified)* means the fact came from secondary sources or memory. Confirm it in a sandbox or the official docs before writing code against it.

---

## 0. Global engineering conventions

- **Money.** Every money column is `*_minor bigint` with a `currency char(3)` beside it. In TypeScript, money is `bigint` and travels in JSON as a string. Floats are never used for money. A `currencies(code, exponent, paystack_unit, flutterwave_unit, stripe_unit)` table drives conversion. Flutterwave v3 takes **major** units, while Paystack and Stripe take minor units, so unit conversion lives only inside provider adapters.
- **Time.** All timestamps are `timestamptz` in UTC. Wherever a person schedules something (drops, storefront publishes, ads), also store the author's IANA timezone in `display_tz`. WAT has no daylight saving time, but UK, EU and US buyers do.
- **IDs.**
  - Primary keys are UUID v7.
  - Human-facing numbers are separate. A checkout group is `MK-7F3K2Q` (6 characters of Crockford base32). A merchant order is `MK-7F3K2Q-02`.
  - Storefront instance IDs are `sec_` or `blk_` followed by an 8-character nanoid.
- **Statuses.**
  - Each status is a Drizzle `pgEnum`. Statuses change only through `transition(aggregate, from, to, ctx)`, which is backed by a per-aggregate TypeScript transition table.
  - The change itself is a compare-and-set: `UPDATE … SET status=$to, version=version+1 WHERE id=$1 AND status=$from RETURNING *`. Every transition appends an event row.
  - No app has a free-form status dropdown, Admin included. Admin only gets buttons for allowed transitions.
- **Append-only tables.**
  - The protected tables are the ledger tables, `inventory_movements`, `order_events`, `drop_events`, `storefront_versions.config`, `ad_creatives`, `provider_events` and `audit_logs`.
  - On each of them, the app role has `REVOKE UPDATE, DELETE`, and a BEFORE UPDATE/DELETE trigger raises an error.
- **Side effects.**
  - Use a transactional outbox, `outbox(id, topic, payload, created_at, dispatched_at)`, written in the same transaction as the state change and relayed to BullMQ.
  - Every job has a deterministic `jobId`, and every worker is idempotent.
- **Validation.** One Zod schema per input, shared by client and server. Database CHECK constraints are the last guard.
- **Tenancy.** Every brand-owned row carries `brand_id`. Brand Studio data access goes through a repository that injects `brand_id`. Add Postgres RLS on brand-owned tables as defence in depth.
- **Auth.** Better Auth handles users and sessions.
  - Two-factor authentication is mandatory for Admin.
  - Brand Owner and Finance roles are prompted for 2FA at signup. It becomes mandatory before payout or bank-detail changes.

---

## 1. Summary: the 10 lessons that shape the build

1. Price, stock, cart lines, holds and order lines always point at a **variant**. Every product has at least one variant, even if it is only a default one.
2. Keep **lifecycle status**, **channel publication** and **admin moderation** separate. "Active" does not mean "visible". This separation is also what lets a drop sit unlisted until it goes live.
3. A merchant order never has one overloaded status. It has orthogonal axes for lifecycle, payment, fulfillment, returns and disputes, all derived in one service. The checkout group's display status is a pure function of its child orders.
4. The **checkout group is not an order**. It holds one payment and one customer receipt, and it produces one merchant order per brand, even for a single-brand cart. Order numbers are hierarchical.
5. **Postgres is the single source of truth for stock and holds.** Conditional `UPDATE`s plus CHECK constraints make overselling impossible by construction. Redis only sits in front, handling the queue, admission passes, rate limits and display caches.
6. Drops need four things: holds taken at add-to-bag, a purchase gate enforced on the server, a waiting room that knows how much stock is left, and an explicit late-payment path (re-reserve or auto-refund). Shopify's model has no holds before checkout and WooCommerce relies on cron-driven expiry. Both fail exactly here.
7. Money is recorded in an **immutable double-entry ledger**. Balances are sums, and corrections are reversing entries. Every provider event is verified on its raw bytes, deduplicated, and re-fetched from the provider API before anything is posted.
8. Commission is the **platform's take in basis points**. It is computed per merchant order with BigInt round-half-even, snapshotted, and reversed cumulatively on refunds. Every discount declares who funds it.
9. Storefronts are edited as a **draft that becomes immutable published versions**, with scheduled publishing tied to drops and restore-to-draft. Sections are typed and constrained, design tokens are curated, contrast is gated, and there is no custom CSS or code.
10. **Sponsored placements are separate, additional inventory**, always labelled: the word "Sponsored" is server-rendered and every unit has an "About this ad" popover. They never act as a ranking multiplier. Fixed published prices and 7-day-click attribution net of refunds are what we offer instead of Etsy- and Amazon-style ads.

---

## 2. Data model decisions

The notation below is schema sketch, not final DDL. Every money field is `_minor bigint` with a currency column alongside.

### 2.1 Brands, team, verification, payout identity

```text
brands
  id, handle citext UNIQUE                  -- 3–30 chars ^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$; reserved_handles list; history + 301s
  display_name, legal_name, base_currency, country_code, city, founded_year, tagline (≤120), story jsonb
  status            brand_status            -- §3.8: onboarding|pending_review|changes_requested|approved|rejected|suspended|closed
  verification_tier unverified|basic|verified|trusted   (derived from submissions + performance, cached)
  discovery_tier    storefront_only|standard|featured   (editorial eligibility)
  quality_score smallint 0–100              -- nightly: image quality, catalog completeness, ops metrics
  primary_category_id, logo_media_id, banner_media_id, timezone (IANA)
  processing_days_min, processing_days_max, return_window_days (≥ platform floor)
  payout_hold bool, payout_hold_reason, debt_limit_minor
  approved_at, launched_at, launch_boost_until, follower_count (job-maintained), version
brand_members(brand_id, user_id, role: owner|admin|designer|fulfillment|finance|viewer)
brand_handle_history(brand_id, handle, valid_from, valid_to)   -- UNIQUE lower(handle) across current + history (no squatting)
reserved_handles(handle, reason)                                -- route names + well-known trademarks (flag for review)
value_definitions(code, label, region_scope[], requires_verification)
brand_values(brand_id, value_code, verified_at, verified_by)    -- identity tags (e.g. women-owned) hidden until verified
brand_policies(brand_id, kind: returns|shipping|terms|privacy, body jsonb, version, published_at)
shipping_profiles(brand_id, name)
  shipping_zones(profile_id, country_codes[], region_codes[])   -- NG: 36 states + FCT; no postcodes in v1
  shipping_rates(zone_id, type: flat|weight_tiered|free_over|pickup, amount_minor, currency,
                 min_subtotal_minor, tiers jsonb, eta_min_days, eta_max_days)
verification_requirements(country_code, key: owner_identity|bank_account_match|business_registration|address|brand_authenticity,
                          required_for: sell|payouts|badge)
verification_submissions(brand_id, requirement_key, status: pending|in_review|approved|rejected|expired,
  file_keys[] (private bucket), provider: manual|smile_id|dojah|youverify (vendor choice unverified), provider_ref,
  rejection_reason_code, reviewer_id, reviewed_at, expires_at)
brand_review_decisions(brand_id, admin_id, decision, reason_codes[], notes, created_at)
merchant_payout_accounts(brand_id, provider, provider_account_ref (ACCT_/RCP_/RS_/acct_),
  settlement_schedule: auto|weekly|monthly|manual, bank_code, account_number_enc, account_last4,
  resolved_name, name_match_score, status: pending_verification|active|needs_review|restricted|disabled,
  verified_at, cooldown_until)              -- 48h payout freeze after any change; full number only encrypted
brand_onboarding_dismissals(brand_id, task_key, dismissed_at)   -- checklist state is COMPUTED, never stored
brand_performance_snapshots(brand_id, period_start, period_end, orders_count, on_time_ship_rate, tracked_rate,
  response_24h_rate, avg_rating, dispute_rate, brand_cancel_rate, top_rated bool)   -- monthly on the 1st
```

### 2.2 Storefront config (full shape in §6)

```text
storefronts(id, brand_id UNIQUE, template: editorial|minimal|street|studio, status: active|suspended|disabled,
            published_version_id, scheduled_version_id)
storefront_drafts(storefront_id PK, base_version_id, config jsonb, registry_version, revision int, updated_by, updated_at)  -- exactly 1 row
storefront_versions(id, storefront_id, number, parent_version_id, config jsonb (immutable via trigger), config_hash,
  registry_version, kind: publish|checkpoint|scheduled,
  state: published|superseded|scheduled|failed|cancelled|checkpoint,
  label, starred, source: editor|restore|template_switch|admin|migration|onboarding,
  publish_at, published_at, published_by, created_by, created_at)   UNIQUE(storefront_id, number)
storefront_ops(id bigserial, storefront_id, revision, actor_id, op jsonb, created_at)   -- used for rebase/audit, 30-day retention
```

### 2.3 Catalog: products, options, variants

```text
categories(id, parent_id, path ltree, slug, name, default_size_system)         -- platform taxonomy
products(id, brand_id, handle (UNIQUE per brand), title, description jsonb, category_id, product_type, tags text[],
  status: draft|active|unlisted|archived (default draft), kind: standard|made_to_order (v1.1),
  made_in_country (fallback: brand.country_code), size_chart_id, storefront_layout_key,
  seo_title, seo_description, first_published_at (set ONCE, never reset), archived_at,
  product_group_id (v1.1: colorways as separate products sharing a style parent), version, timestamps)
  -- never hard-deleted once referenced by an order item; archive instead
product_options(id, product_id, name, position smallint CHECK (position BETWEEN 1 AND 3), UNIQUE(product_id, position))
product_option_values(id, option_id, name, position, swatch_hex, swatch_media_id,
  normalized_value)                     -- size → platform size system, colour → colour family (powers cross-brand filters)
variants(id, product_id, brand_id, sku (UNIQUE per brand, nullable), barcode,
  price_minor, compare_at_price_minor, cost_minor (brand-private), currency,
  inventory_policy: deny|preorder (v1 enables deny only; drop variants forced deny),
  track_inventory default true, requires_shipping, weight_grams, position, is_default, status: active|archived,
  options_key text, UNIQUE(product_id, options_key))   -- one concrete combination per variant; no "Any" wildcards
variant_option_values(variant_id, option_value_id)
product_publications(product_id, channel: marketplace|storefront, publish_at, unpublish_at, published_by)
product_moderation(product_id, state: clear|suppressed, reason_code, admin_id, note, at)   -- Admin hides without touching brand status
media(id, owner_brand_id, kind: image|video, storage_key, width, height, blurhash, dominant_color,
  avg_luminance numeric(4,3), background_kind: white|neutral|dark|lifestyle, focal_x, focal_y,
  alt_text, poster_media_id, moderation: pending|approved|rejected)   -- luminance/background computed with sharp on upload
product_media(product_id, media_id, position, variant_id NULL)
size_charts(id, brand_id, name, category: tops|bottoms|outerwear|footwear|rings|custom, unit_system: cm|in,
  columns jsonb, rows jsonb, fit_note (≤200), fit_scale smallint -2..2, model_height_cm, model_wearing_size, how_to_measure_media_id)
size_conversions(category, system: EU|US_M|US_W|UK|JP_CM, label, canonical)    -- platform-owned
lookbooks(id, brand_id, slug, title, season, status, cover_media_id, published_at)
  lookbook_frames(id, lookbook_id, media_id, layout: full|pair|half, caption (≤140), position)
  lookbook_frame_products(frame_id, product_id, hotspot_x NULL, hotspot_y NULL)
```

**Limits (Decision):**
- At most 3 options and 100 variants per product, enforced by Zod and a count trigger. A full size run across 6 colorways fits. Colorways that drop separately should be separate products.
- At most 20 media items per product.
- The primary image must be 4:5 and at least 1600×2000.

**Marketplace visibility** is one SQL view, `v_marketplace_products`, defined as:
- `status='active'`,
- AND a live `marketplace` publication,
- AND `brand.status='approved'` and the brand is launched,
- AND `moderation.state='clear'`.

`unlisted` means reachable only by direct URL. Unlisted products are excluded from search, collections, recommendations and feeds; drops use this before reveal.

### 2.4 Inventory

```text
locations(id, brand_id, name, address jsonb, is_default, fulfills_online)     -- v1: exactly one ("Studio") per brand
inventory_levels(variant_id, location_id) PK
  on_hand, committed, reserved, allocated, damaged, safety_stock, incoming   int NOT NULL DEFAULT 0, each CHECK (≥ 0)
  available int GENERATED ALWAYS AS (on_hand - committed - reserved - allocated - damaged - safety_stock) STORED
  CHECK (on_hand - committed - reserved - allocated - damaged - safety_stock >= 0)
  low_stock_threshold, updated_at, version
inventory_movements (append-only)
  id, variant_id, location_id, bucket, delta, bucket_after, movement_group_id (state moves = 2 rows),
  reason: received|correction|cycle_count|damaged|shrinkage|safety_stock|restock|return_restocked|
          hold_created|hold_released|hold_expired|order_committed|order_fulfilled|order_cancelled|
          drop_allocated|drop_released|other (note required),
  reference_type: order|checkout|hold|return|refund|drop|manual|import, reference_id,
  actor_type: brand_user|admin|system|customer, actor_id, note, idempotency_key UNIQUE, created_at
inventory_holds (normal checkout holds AND drop holds, one table)
  id, variant_id, location_id, drop_id NULL, cart_id, checkout_group_id NULL, customer_id NULL, anon_id, qty,
  status: active|converted|expired|released, expires_at, extended_count smallint, admission_pass_jti,
  payment_attempt_id, order_item_id,
  release_reason: user_removed|line_removed|expired|admin|drop_cancelled|payment_failed, created_at, updated_at
  INDEX (expires_at) WHERE status='active'
  UNIQUE (drop_id, variant_id, customer_id) WHERE status='active' AND drop_id IS NOT NULL
```

**Bucket semantics.** Each event moves units between buckets as follows:

| Event | Bucket change | Notes |
|---|---|---|
| Normal hold created | `reserved += q` | |
| Drop scheduled | `allocated += allocation` | Drop holds then count against `drop_variants.held_qty` |
| Paid | `reserved` or `allocated` −q, `committed` +q | |
| Shipped | `committed` −q, `on_hand` −q | |
| Cancelled before ship | `committed` −q | Units never left the shelf |
| Return restocked | `on_hand` +q | Only when disposition is restock |

Brands may edit only `on_hand` (received, correction, cycle count), `damaged` and `safety_stock`. The `committed`, `reserved` and `allocated` buckets are written by system code only. The projection update and the movement insert happen in **one transaction**.

### 2.5 Collections

```text
collections(id, scope: brand|platform, brand_id NULL, handle, title, description,
  type: manual|automated (immutable after create), rule_set jsonb,
  sort_order: manual|best_selling|newest|price_asc|price_desc|alpha_asc,
  status: draft|published, published_at, curator_name (guest curators), cover_media_id)
  rule_set = { match: 'all'|'any', rules: [{ field, op, value }] }   -- ≤20 rules
  fields: tag|category|brand_id|price|compare_at_price|is_on_sale|created_at|in_stock|made_in|drop_id
collection_products(collection_id, product_id, position, source: manual|rule)
  -- materialized by a BullMQ job on product events, plus a nightly full rebuild; sponsored NEVER injected here
```

### 2.6 Drops

```text
drops(id, brand_id, slug UNIQUE, title, story_doc jsonb, hero_media_id,
  release_type: fcfs|draw, access_mode: public|invite_only|password, password_hash,
  status (§3.6), draw_phase: entries_open|entries_closed|drawing|results_out NULL,
  display_tz, announce_at, early_access_starts_at, starts_at, ends_at, entries_close_at, draw_at, results_at,
  winner_purchase_window_minutes (1440), hold_ttl_seconds (600; 300–900),
  limit_per_customer (1), limit_per_variant_per_customer (1),
  queue_enabled, queue_opens_at (default starts_at − 15m), admission_rate_per_minute,
  bot_protection: off|standard|strict, require_verified_phone, min_account_age_hours, eligible_country_codes[],
  payment_channels_live[], post_drop_action: return_to_catalog|archive_only, show_stock_level: none|low_badge|exact,
  live_at, sold_out_at, ended_at, cancelled_at, cancel_reason, version, created_by, approved_by)
drop_variants(drop_id, variant_id) PK, price_minor, currency (snapshot, locked once scheduled),
  allocated_qty, held_qty, sold_qty, sort_order,
  CHECK (held_qty >= 0 AND sold_qty >= 0 AND held_qty + sold_qty <= allocated_qty)
drop_units(id, drop_id, variant_id, edition_number, status: available|held|sold, hold_id, order_item_id)   -- numbered editions only
drop_customer_counters(drop_id, customer_id) PK, held_qty, purchased_qty
drop_identity_counters(drop_id, identity_hash) PK, purchased_qty        -- phone / normalized address / card fingerprint
drop_access_grants(drop_id, customer_id) PK, reason: follower|repeat_buyer|brand_invite|admin, starts_at, ends_at, used_at
drop_alerts(id, drop_id, customer_id|email|phone_e164, channels[], offsets_minutes int[] DEFAULT '{-1440,-60,-15,0}',
  timezone, source, unsubscribed_at)   UNIQUE(drop_id, customer_id)
draw_entries(id, drop_id, customer_id, variant_id, address_id, payment_method_id, identity_hash,
  status: entered|withdrawn|disqualified|selected|alternate|not_selected|purchased|payment_failed|forfeited,
  preauth_reference, preauth_status: none|held|captured|released|expired, alternate_rank,
  selected_at, purchase_deadline, merchant_order_id)   UNIQUE(drop_id, customer_id)
draw_runs(id, drop_id, seed_commitment char(64) (published at entries_open), seed (revealed after run),
  algorithm_version, entries_count, valid_entries_count, winners_count, alternates_count, ran_at, ran_by)
drop_events (append-only)(id, drop_id, from_status, to_status, phase, actor_type, actor_id, reason, payload, created_at)
-- v2: drop_release_windows(drop_id, region_code, country_codes[], starts_at, ends_at) + per-window allocations
```

### 2.7 Carts, checkout groups, merchant orders, order items

```text
carts(id, customer_id NULL, anon_id, status: active|converted|abandoned, updated_at)
cart_items(cart_id, variant_id, product_id, brand_id (denorm), qty, price_seen_minor, hold_id NULL, saved_for_later, added_at)
  -- grouping by brand is a GROUP BY at read time, not an entity
checkout_groups(id, public_number UNIQUE, cart_id, customer_id NULL (guest), email, phone_e164,
  status (§3.2), display_status (cached; derived from children), currency,
  items_subtotal_minor, brand_discount_minor, platform_discount_minor, shipping_minor, tax_minor, total_minor,
  quote jsonb      -- FROZEN per-brand quote: lines, price snapshots, discount allocations, shipping choice, commission math
  quote_hash, shipping_address jsonb (NG: state, LGA, landmark; postcode optional),
  holds_expire_at, paid_at, idempotency_key, created_at)
  CHECK (brand_count <= 10)          -- until Paystack's max subaccounts per split is confirmed
merchant_orders(id, checkout_group_id, brand_id, number UNIQUE (MK-XXXXXX-NN), brand_sequence (UNIQUE per brand), currency,
  status: open|completed|cancelled,
  payment_status: paid|partially_refunded|refunded,
  fulfillment_status: unfulfilled|scheduled|on_hold|partially_fulfilled|fulfilled|delivered,
  return_status: none|requested|in_progress|partially_returned|returned,
  dispute_status: none|open|won|lost,
  items_subtotal_minor, brand_discount_minor, platform_discount_minor, shipping_minor, tax_minor, total_minor,
  commission_rule_id, commission_bps, commission_base_minor, commission_minor, commission_vat_minor, merchant_net_minor,
  provider_fee_alloc_minor (informational), fee_bearer: platform|merchant,
  attribution jsonb {source: marketplace|brand_link|sponsored|creator, ref, campaign_id},
  shipping_rate_snapshot jsonb, note_to_brand, fulfill_after, hold_reason, cancel_reason, cancelled_at,
  delivered_at, return_window_ends_at, hold_release_at, completed_at, archived_at, version)
  INDEX (brand_id, created_at DESC), (checkout_group_id)
order_items(id, merchant_order_id, variant_id, product_id, drop_id, hold_id,
  title_snapshot, variant_title_snapshot, sku_snapshot, image_media_id,
  unit_price_minor, qty, line_subtotal_minor, brand_discount_minor, platform_discount_minor, tax_minor,
  commission_minor (allocated from order-level commission), fulfilled_qty, delivered_qty, refunded_qty, returned_qty,
  CHECK (fulfilled_qty <= qty AND refunded_qty <= qty AND delivered_qty <= fulfilled_qty))
promotions(id, scope: platform|brand, brand_id, code, type: percent|fixed|free_shipping, value,
  min_subtotal_minor, max_discount_minor, eligibility jsonb, funding: brand|platform|shared, platform_share_bps,
  usage_limit, per_customer_limit, starts_at, ends_at)   -- brand-funded share of a platform promo requires brand opt-in
promotion_redemptions(promotion_id, checkout_group_id, customer_id, amount_minor)
order_events (append-only timeline + audit)(id, subject_type: checkout_group|merchant_order|refund|return|fulfillment,
  subject_id, type, field, from, to, actor_type: customer|brand_member|admin|system|provider, actor_id, reason, payload, created_at)
```

**When merchant orders are created (Decision).** Merchant orders are created **only on verified payment**. Before that, the frozen `quote` is the source of truth, and `payment_splits` reference `brand_id` plus a quote line. At payment time, orders are materialized from the quote exactly and never recomputed, so the amounts sent to the provider always equal the amounts in the ledger. Changing the cart after "Continue to payment" invalidates the payment attempt and produces a new quote.

### 2.8 Fulfillments, returns, refunds, disputes

```text
fulfillments(id, merchant_order_id, location_id, status (§3.4), carrier (seeded: local couriers e.g. GIG, DHL, …, 'other'),
  carrier_other, tracking_number, tracking_url, notify_customer, shipped_at, delivered_at,
  delivery_evidence jsonb (POD file, signer, photo), created_by)
fulfillment_lines(fulfillment_id, order_item_id, qty)
  -- Decision: no Shopify-style fulfillment_orders in v1 (one location per brand); scheduled/on_hold live on merchant_orders.
returns(id, merchant_order_id, status (§3.5b), requested_at, approved_at, declined_reason, label_url, return_tracking,
  received_at, closed_at, customer_note)
return_lines(return_id, order_item_id, qty,
  reason: size_too_small|size_too_large|unwanted|not_as_described|wrong_item|defective|damaged_in_transit|other,
  customer_note, disposition: restock|not_restock|missing)
refunds(id, merchant_order_id, checkout_group_id, payment_attempt_id, return_id NULL, currency,
  amount_minor, items_amount_minor, shipping_refund_minor, commission_reversal_minor,
  reason_code: damaged|wrong_item|not_received|customer_return|cancelled_before_ship|out_of_stock|late_payment_unavailable|goodwill|other,
  status (§3.5), initiated_by_type, initiated_by_id, approved_by, provider_refund_ref, idempotency_key UNIQUE,
  customer_note, merchant_note, submitted_at, completed_at, failure_reason)
refund_lines(refund_id, order_item_id, qty, amount_minor, restock_type: no_restock|cancel|return, location_id)
refund_allocations(refund_id, party: merchant|platform, ledger_account_id, amount_minor)
disputes(id, payment_attempt_id, merchant_order_id, provider_dispute_ref, amount_minor, currency, reason,
  status (§3.7), liability: merchant|platform, opened_at, due_at (Paystack: opened_at + 16h), resolved_at, evidence jsonb, assigned_admin_id)
```

**Refund invariants:**
- `SUM(refund_lines.amount_minor) + shipping_refund_minor = amount_minor`. This closes WooCommerce's loophole where the stated amount wins over the line totals.
- The cumulative total of non-failed refunds is at most `merchant_orders.total_minor`. Check this under `SELECT … FOR UPDATE` on the merchant order, never at the group level.

### 2.9 Payments and payment attempts, webhook events, idempotency

```text
customer_payment_methods(id, customer_id, provider, authorization_code_enc, card_last4, card_brand, exp_month, exp_year,
  card_country, reusable, fingerprint)
payment_attempts(id, checkout_group_id, attempt_no, provider, settlement_mode: split_at_charge|collect_then_transfer,
  reference UNIQUE ('pay_{groupId}_{n}'), provider_payment_ref, amount_minor, currency,
  channel: card|bank_transfer|ussd|bank|mobile_money, card_origin: local|international,
  status (§3.3), is_late bool, provider_fee_minor (from verify response, never estimated),
  authorization_url, provider_expires_at, verified_at, raw_verify jsonb, created_at)
  UNIQUE (checkout_group_id) WHERE status IN ('succeeded','partially_refunded','refunded')
payment_splits(id, payment_attempt_id, brand_id NULL, kind: merchant_net|commission|provider_fee|tax|remainder,
  amount_minor, provider_account_ref, quote_line_ref)   -- persisted BEFORE provider init; SUM = payment amount
provider_events(id, provider, dedupe_key, event_type, signature_valid, source_ip, received_at, payload jsonb, raw_body text,
  processed_at, attempts, last_error)   UNIQUE(provider, dedupe_key); retained indefinitely
idempotency_keys(scope, key) PK, user_id, request_hash, recovery_point, response_status, response_body jsonb,
  locked_until, created_at, expires_at (+24h)
```

### 2.10 Ledger accounts, journal entries, commissions, payouts

```text
ledger_accounts(id, code UNIQUE ('merchant:{brandId}:available:NGN'), owner_type: platform|merchant|provider, owner_id,
  purpose, type: asset|liability|revenue|contra_revenue|expense, normal_balance, currency, provider, allow_negative)
ledger_transactions(id, idempotency_key UNIQUE, type, status: pending|posted|archived, effective_at, posted_at,
  reverses_transaction_id, checkout_group_id, merchant_order_id, brand_id, payment_attempt_id, refund_id, payout_id,
  dispute_id, ad_campaign_id, provider_event_id, created_by, approved_by, memo, metadata)
ledger_entries(id, transaction_id, account_id, direction: debit|credit, amount_minor CHECK (> 0), currency,
  signed_amount_minor GENERATED (debit +, credit −), created_at)
  -- insert-only; DEFERRABLE INITIALLY DEFERRED constraint trigger: Σ signed per (transaction_id, currency) = 0;
  -- entry currency must equal account currency; only postJournal() writes
ledger_account_balances(account_id PK, posted_debits, posted_credits, pending_debits, pending_credits, version)
  -- merchant accounts updated in-tx (locked in account_id order); hot platform accounts use snapshot + delta
commission_rules(id, scope: global|category|brand|product|campaign|brand_referral, scope_id, rate_bps, fixed_minor (0),
  priority, effective_from, effective_to, reason, created_by)
reserve_policies(id, tier: new|verified|trusted|custom, hold_basis: delivered|shipped, hold_days, fallback_days_after_ship,
  reserve_bps, reserve_days, drop_gmv_multiple_trigger, min_payout_minor, schedule)
reserve_holds(id, brand_id, merchant_order_id, kind: delivery_hold|rolling_reserve|drop_hold|risk_hold, amount_minor,
  release_at, status: held|released|consumed, hold_txn_id, release_txn_id)
payout_batches(id, scheduled_for, status: draft|approved|processing|completed|partially_failed, approved_by, approved_at)
payouts(id, batch_id, brand_id, provider, reference UNIQUE ('po_{id}'), recipient_ref, amount_minor, currency, fee_minor,
  fee_bearer, status (§3.3b), provider_transfer_ref, failure_reason, approved_by, initiated_at, completed_at)
payout_items(payout_id, ledger_transaction_id | merchant_order_id)
reconciliation_runs(id, provider, currency, period_start, period_end, status, totals jsonb)
reconciliation_items(id, run_id, provider_ref, internal_ref,
  category: matched|missing_internal|missing_provider|amount_mismatch|fee_mismatch|settlement_mismatch,
  provider_amount_minor, internal_amount_minor, status: open|resolved|ignored, resolution_txn_id, resolved_by, note)
fx_quotes(id, from_currency, to_currency, rate numeric(20,10), source, locked_at, expires_at)   -- v2; v1 checkout is single-currency
```

**Chart of accounts** (one account per owner, purpose and currency):

| Type | Accounts |
|---|---|
| Assets | `provider_clearing:{provider}` (funds at the provider), `platform_bank:{id}`, `merchant_receivable:{brand}` (the brand owes us), `dispute_clearing:{provider}` |
| Liabilities | `merchant_pending:{brand}` (on hold), `merchant_available:{brand}`, `merchant_reserve:{brand}`, `merchant_dispute_hold:{brand}`, `payout_in_transit:{brand}`, `customer_refunds_payable`, `vat_payable`, `sponsored_revenue_deferred` |
| Revenue | `commission_revenue`, `sponsored_revenue` |
| Contra-revenue | `commission_reversals` |
| Expenses | `processing_fees`, `transfer_fees`, `dispute_fees`, `promotions_expense`, `bad_debt` |
| Suspense | `reconciliation_suspense`, `fx_clearing:{pair}` (v2) |

### 2.11 Ad campaigns, placements, impressions

```text
ad_placement_products(id, key, surface: home|category|search|drops|brand_directory, positions, duration_unit: day|week,
  min_duration, max_advance_booking_days (60), per_brand_max_concurrent (1), per_brand_max_units_per_month (2),
  requires_creative, creative_specs jsonb {aspect:'4:5', min_px:1600, headline_max:40}, eligibility_rules jsonb, active)
ad_rates(placement_product_id, market, currency, price_minor, valid_from, valid_to)    -- versioned, never updated in place
ad_campaigns(id, brand_id, placement_product_id, market, category_id NULL, position NULL, starts_at, ends_at,
  status (§3.9), rate_id, price_minor, currency, promoted_type: product|drop|storefront, promoted_id,
  advertiser_legal_name, paid_by, current_creative_version, reviewed_by, reviewed_at, cancel_reason)
ad_bookings(id, campaign_id, placement_product_id, market, category_id, position, period tstzrange,
  status: held|booked|released, hold_expires_at (+30 min))
  EXCLUDE USING gist (placement_product_id WITH =, market WITH =, coalesce(category_id, '<none>') WITH =,
                      position WITH =, period WITH &&) WHERE (status IN ('held','booked'))   -- btree_gist; no double booking
ad_creatives (insert-only)(id, campaign_id, version, headline (≤40), media_id, alt_text NOT NULL,
  cta: shop_now|view_drop|visit_store, review_status: pending|approved|changes_requested|rejected, reviewed_by, reason_codes[])
ad_campaign_events(campaign_id, from, to, actor_id, reason_codes[], note, at)
ad_clicks(click_id, campaign_id, viewer_key, session_id, position, ts, ua_class, is_suspect)    -- partitioned monthly
ad_daily_stats(campaign_id, date, impressions, viewable_impressions, clicks, suspect_clicks, eligible_minutes,
  attributed_orders, attributed_revenue_minor, new_to_brand_orders)      -- raw impressions live only in Redis → rollups
ad_attributions(id, merchant_order_id UNIQUE, campaign_id, click_id, model 'last_click_7d', scope: same_product|same_brand,
  amount_minor, status: provisional|final|partially_reversed|reversed, finalized_at)
ad_credits(brand_id, campaign_id, amount_minor, reason, ledger_txn_id)
```

### 2.12 Follows, wishlists, discovery, editorial

```text
follows(user_id, brand_id) PK, notify_new_products, notify_drops, notify_sales, channel_prefs jsonb, created_at
feed_items(id, user_id, brand_id, event_type: new_products|drop_scheduled|drop_live|price_drop|back_in_stock|story_published,
  ref_ids[], collapsed_count, created_at, read_at)       -- bursts collapsed per brand per window
wishlist_items(user_id, product_id, variant_id NULL, price_at_save_minor, currency, added_at)  -- soft cap 500, warn, never evict silently
back_in_stock_subscriptions(user_id, variant_id, created_at, notified_at)
saved_searches(id, user_id, query_text, filters jsonb, filters_hash, frequency: instant|daily|weekly, watermark_published_at, last_notified_at)
curation_picks(id, subject_type: product|brand|story, subject_id, label: editors_pick|staff_pick|featured_brand,
  collection_id, curated_by, rationale, starts_at, expires_at, status)
stories(id, slug, title, dek, hero_media_id, author_id, status: draft|in_review|scheduled|published|unpublished, published_at, brand_ids[], tags[])
story_blocks(story_id, position, type: rich_text|image|image_pair|quote|product_embed|product_grid|brand_card|drop_card|video, payload jsonb)
  -- embeds store IDs only; price/stock resolved at render; sold out → "Sold out · Notify me" or brand card
home_modules(id, market, type: story_hero|drops_rail|following_feed|collection|brand_spotlight|new_brands|category_tiles|sponsored_rail|journal_teaser,
  position, audience: all|signed_in|signed_out, config jsonb (Zod per type), status: draft|scheduled|live|archived, starts_at, ends_at)
  -- validator + CHECK: sponsored_rail never at position 1 or 2
search_documents(product_id PK, brand_id, title, brand_name, category_path ltree, colour_family, size_values[], price_minor, currency,
  ships_to_countries[], ships_from_country, made_in_country, brand_value_codes[], is_on_sale, first_published_at, drop_status,
  in_stock, top_rated_brand, quality_score, tsv tsvector)   -- GIN + pg_trgm; refreshed by job on product/variant/stock/price events
```

### 2.13 Events for recommendations and analytics (one pipeline)

**Decision:** one ingestion path. The client batches events to `POST /api/events`. They go onto a Redis stream, a BullMQ consumer writes them into Postgres partitions, and rollups are built from there.

```text
analytics_sessions(id, visitor_id, user_id, started_at, ended_at, landing_path, referrer_source, utm jsonb, entry_surface, country, device)
events(id, ts, session_id, visitor_id, user_id, type, brand_id, product_id, variant_id, drop_id, campaign_id,
  surface, position, is_sponsored, context jsonb)          -- partitioned by month
  type: page_view|product_view|brand_view|search|filter|add_to_bag|remove_from_bag|wishlist_add|follow|checkout_started|
        payment_initialized|order_paid|drop_notify|queue_join|hold_created|story_view|
        sponsored_impression|sponsored_viewable|sponsored_click
brand_daily_metrics(brand_id, date (brand tz), sessions, product_views, add_to_bag, checkouts, orders, gross_minor,
  discounts_minor, returns_minor, net_minor, commission_minor, returning_customers, total_customers)
```

Organic recommenders and ranking features **exclude every `is_sponsored` event**, so paying for ads never compounds into organic rank.

### 2.14 Customers, consent, notifications

```text
customers(id, user_id NULL (guest), email, phone_e164, phone_verified_at, first_name, last_name, default_address_id,
  locale, country, platform_marketing_consent jsonb {state, at, source})
addresses(id, customer_id, line1, line2, city, region (NG state), lga, landmark, postcode NULL, country_code, phone)
brand_customers (projection)(brand_id, customer_id) PK, orders_count, total_spent_minor, first_order_at, last_order_at,
  followed_at, email_consent: subscribed|not_subscribed|pending|unsubscribed, consent_updated_at, consent_source
  -- brands only ever see buyers/followers of THEIR brand; consent is per brand
segments(brand_id, preset_key: repeat|lapsed_90d|high_spend|followers_never_bought|drop_waitlist, member_count, last_evaluated_at)
notification_preferences(user_id, category, channel, enabled, quiet_hours)
notification_deliveries(id, event_id, recipient, channel: in_app|email|push|whatsapp|sms, template,
  status: queued|sent|failed|suppressed, dedupe_key UNIQUE)
```

### 2.15 Audit logs

```text
audit_logs (append-only)(id, app: marketplace|studio|admin|system, actor_type, actor_id, actor_role, brand_id,
  action ('payout.approve', 'product.suppress', …), subject_type, subject_id, before jsonb, after jsonb (PII redacted),
  reason (required on every Admin write), request_id, ip, user_agent, created_at)
maker_checker_requests(id, action, payload, prepared_by, approved_by (≠ prepared_by), status, created_at, decided_at)
  -- required for: ledger adjustments, payouts over threshold or after bank change, commission overrides, ad campaigns over threshold
admin_users roles: support | trust_safety | finance | editorial | ads_review | superadmin
```

The domain logs (`order_events`, `drop_events`, `inventory_movements`, `storefront_ops`, `ad_campaign_events` and the ledger) hold the detail. `audit_logs` is the cross-app record of who did what.

---

## 3. State machines

**Implementation rule:**
- Each aggregate has one `transitions.ts` table.
- Every transition is a guarded compare-and-set, appends an event, and emits outbox messages.
- Derived axes are recomputed by `deriveOrderStatuses(merchantOrderId)` inside the same transaction as the change that triggered them. They are never set by hand.

### 3.1 Merchant order (the stored lifecycle plus four derived axes)

**Lifecycle (`status`, stored):**

| From | To | Trigger | Guards and effects |
|---|---|---|---|
| none | `open` | Payment conversion | Created only on verified payment |
| `open` | `cancelled` | Brand, admin, customer before shipment, system (validator or fraud) | All items have `fulfilled_qty = 0`. A reason is required. Creates a full refund with `restock_type=cancel`, releases committed stock and reverses commission |
| `open` | `completed` | Daily system job | Either fully `delivered`, or `fulfilled` with the shipped fallback period passed. The return window has ended. No open return, refund or dispute. Funds released |
| `completed`, `cancelled` | none | Terminal | Admin goodwill refunds and late disputes are still allowed after `completed`. They do not reopen the order |

A partial cancellation is a refund with `restock_type=cancel` lines. The order stays `open`.

**`payment_status`** is derived from processed refunds:
- `paid` → `partially_refunded` → `refunded`
- `paid` → `refunded`

**`fulfillment_status`** is derived. Fulfillable quantity is `qty − cancelled qty`. Rules are evaluated in this order:
1. `on_hold` if `hold_reason` is set (fraud review, address issue).
2. `scheduled` if `fulfill_after > now()` and nothing has shipped (drops, preorders). It auto-moves to `unfulfilled` at `fulfill_after`.
3. `delivered` if all fulfillable quantity is delivered.
4. `fulfilled` if all fulfillable quantity has shipped.
5. `partially_fulfilled` if anything has shipped.
6. Otherwise `unfulfilled`.

Allowed movement: `unfulfilled ⇄ on_hold`, `scheduled → unfulfilled`, `unfulfilled → partially_fulfilled → fulfilled → delivered`. Only an admin can move it backwards, by cancelling a fulfillment.

**`return_status`:** `none → requested → in_progress → partially_returned | returned`. It goes from `requested` back to `none` when the return is declined or cancelled.

**`dispute_status`:** `none → open → won | lost`.

**Ship-by SLA:** `paid_at + processing_days_max` in business days. Late shipments feed `brand_performance_snapshots`.

### 3.2 Checkout group

| From | To | Trigger | Guards and effects |
|---|---|---|---|
| `draft` | `awaiting_payment` | `POST /api/checkout` with an Idempotency-Key | Every line has an active hold. Per-brand validation passes (ships to the address, brand minimum, drop eligibility). Splits are persisted, the provider is initialized and holds are extended (§4.1) |
| `awaiting_payment` | `paid` | Verified `payment.succeeded` | **One transaction:** holds become `converted`, merchant orders are materialized from the quote, ledger journals J1–J3 are posted, and notifications go to the outbox |
| `awaiting_payment` | `failed` | Attempt failed or declined | Holds stay in place until they expire |
| `failed` | `awaiting_payment` | Customer retries | New attempt with a new reference. Holds must still be active or be re-acquired |
| `draft`, `awaiting_payment`, `failed` | `expired` | `holds_expire_at` passes with no success | Release holds |
| `draft` | `cancelled` | Cart edited or abandoned | The next checkout creates a new group |
| `expired` | `paid` | Late verified success and **every** line can be re-held | Emits a `late_payment_recovered` event |
| `expired` | `auto_refunded` | Late success and **any** line cannot be re-held | Full refund at platform cost. Customer is notified and still-available lines are restored to the bag. This is all-or-nothing in v1 (Decision) |

**Display status** (cached in `display_status`) is computed by a pure function `deriveGroupDisplayStatus(orders)`. Rules are evaluated in order:
1. All orders cancelled → `cancelled`.
2. All orders cancelled or fully refunded, with at least one refunded → `refunded`.
3. Every non-cancelled order delivered → `delivered`.
4. Every non-cancelled order fulfilled or delivered → `shipped`.
5. Any order fulfilled, partially fulfilled or delivered → `partially_shipped`.
6. Otherwise → `confirmed`.

Flags sit alongside, not inside, the status: `has_partial_refund`, `has_cancellation`, `has_open_return`, `has_open_dispute`. The customer UI shows a timeline per brand rather than relying on this one label.

### 3.3 Payment attempt status

| From | To | Trigger |
|---|---|---|
| `created` | `pending` | Provider initialized and customer redirected |
| `created` | `failed` | Initialization error |
| `pending` | `succeeded` | `verifyPayment()` returns success **and** amount, currency and reference all match |
| `pending` | `failed`, `abandoned` | Verify result or webhook |
| `pending` | `expired` | Our TTL passed (we stop waiting) |
| `expired` | `succeeded` | Late success. Sets `is_late=true` and runs the late-payment path from §3.2 |
| `succeeded` | `partially_refunded` → `refunded` | Processed refunds |

Webhooks only **trigger** verification. Only the provider's verify API result can set `succeeded`. Redirect query parameters are never trusted.

**3.3b Payout:**
- `draft → pending_approval → queued → processing → paid | failed | reversed`
- `draft → queued` when auto-approved (low risk, under threshold).
- A failure or reversal posts a reversal journal.
- In `split_at_charge` mode, payout rows are created from provider settlement reports directly in the `paid` state, as records only.

### 3.4 Fulfillment (shipment)

| From | To | Trigger |
|---|---|---|
| `pending` | `shipped` | Brand adds carrier and tracking. Customer is notified |
| `shipped` | `in_transit` → `out_for_delivery` → `delivered` | Carrier update or brand action with evidence, or the customer taps "I received it" |
| `shipped`, `in_transit`, `out_for_delivery` | `failed_attempt` | Carrier update |
| `failed_attempt` | `out_for_delivery` or `returned_to_sender` | Carrier update |
| `pending` | `cancelled` | Brand or admin |

`delivered_at` drives both fund release and the return window. If nobody ever confirms delivery, the shipment stays `shipped` and funds are released on the shipped-at fallback (§4.7). Delivery is **never** auto-assumed.

### 3.5 Refund

| From | To | Trigger | Ledger effect |
|---|---|---|---|
| none | `requested` | Brand, admin or system creates it | None |
| `requested` | `approved` | Auto-approve policy or admin | `refund_initiated` (locks the brand's funds) |
| `requested` | `rejected` | Admin (with reason) | None |
| `approved` | `submitted` | Provider refund API call made with a persisted reference | None |
| `submitted` | `processing` | Provider reports pending or processing | None |
| `processing` | `succeeded` | Provider reports `processed` | `refund_completed` |
| `processing` | `needs_attention` | Provider needs the customer's bank details | None |
| `needs_attention` | `processing` or `failed` | Details provided, or timeout | Failure posts a reversal |
| `submitted` or `processing` | `failed` | Provider failure | Reversal of `refund_initiated` |

**Auto-approve** when all of these hold:
- the brand initiates the refund on its own order,
- the amount is within the remaining refundable amount,
- the order is at most 60 days old,
- the brand's available plus pending balance covers it.

Anything else goes to the Admin queue with a 1-business-day SLA. Multiple partial refunds are allowed and are serialized by a row lock on the merchant order.

**3.5b Return:**
- `requested → open` (brand approves; auto-approved for `defective`, `wrong_item` or `not_as_described` inside the window)
- `requested → declined` (brand, with a reason)
- `declined → escalated` (customer, within 7 days) → `open` if the admin overturns, or `closed` if the admin upholds
- `open → received` → `closed` (refund issued for accepted lines)
- `requested` or `open` → `cancelled` (customer)

### 3.6 Drop

| From | To | Trigger | Guards and effects |
|---|---|---|---|
| `draft` | `in_review` | Brand submits | At least one `drop_variant` has `allocated_qty > 0`. `starts_at ≥ now() + 30m`. Story complete |
| `in_review` | `draft` | Admin requests changes | Reason codes |
| `in_review` | `scheduled` | Admin approves (auto for `trusted` brands) | Allocates stock (`inventory_levels.allocated`). Creates BullMQ jobs `drop:{id}:start`, `drop:{id}:alert:{offset}`, `drop:{id}:end`. Product status set to `unlisted` until live |
| `scheduled` | `live` | `starts_at` reached (delayed job plus 30-second sweeper) | `UPDATE drops SET status='live', live_at=now() WHERE id=$1 AND status='scheduled' AND starts_at<=now()` |
| `live` | `paused` | Brand or admin kill switch | No new holds. Existing holds keep running |
| `paused` | `live` | Resume | |
| `live` | `sold_out` | `available = 0` and no active holds | |
| `sold_out` | `live` | A hold expires or an order is cancelled before `ends_at` | |
| `live`, `sold_out`, `paused` | `ended` | `ends_at` reached, brand ends early, or 30-minute grace after selling out | Unsold stock follows `post_drop_action` |
| `draft`, `in_review`, `scheduled`, `paused` | `cancelled` | Brand or admin | Subscribers notified, allocation released, any paid orders refunded |
| `ended`, `cancelled` | none | Terminal | The URL lives on as the archive page |

**Draw phases** (while `status='live'`): `entries_open → entries_closed` at `entries_close_at` → `drawing` (idempotent draw job) → `results_out` (winners charged or given a `purchase_deadline`, alternates promoted) → the drop moves to `ended`.

**Display phases are derived, not stored:**
- `hidden`: scheduled, before `announce_at`
- `announced`: countdown and Notify me
- `early_access`: has a grant and `now ≥ early_access_starts_at`
- `live`, `all_reserved` (stock 0 but holds outstanding), `sold_out`, `ended`

**Edits after `scheduled`:**
- `starts_at` can change until 1 hour before start. Admin can change it later. Every change sends an automatic "Rescheduled" notice and moves the job IDs.
- Allocation can grow, and can shrink only down to held plus sold.
- Price is locked.

**The purchase gate never depends on job timing.** Inside the reserve transaction it computes `is_purchasable = status IN ('scheduled','live') AND status <> 'paused' AND now() >= starts_at AND (ends_at IS NULL OR now() < ends_at)`, plus the early-access grant check. Jobs only update displayed status, send notifications and call `revalidateTag('drop:'+id)`.

### 3.7 Dispute

- `open → evidence_submitted → won | lost`
- `open → accepted`, which has the same economics as `lost`.
- At `due_at`, a dispute with no response is auto-accepted. Paystack auto-accepts after 16 hours, so we escalate to Admin at `due_at − 6h`.

### 3.8 Brand account and verification

**Account status:**

| From | To | Trigger | Guards |
|---|---|---|---|
| `onboarding` | `pending_review` | Brand submits | All required checklist tasks complete (§5.6) |
| `pending_review` | `approved`, `changes_requested`, `rejected` | Admin review (decision and reason codes logged) | |
| `changes_requested` | `pending_review` | Resubmit | |
| `approved` | `suspended` | Admin (trust and safety, debt over limit, IP claim) | Storefront and products are hidden from the marketplace. Payouts are held |
| `suspended` | `approved` | Admin reinstates | |
| any | `closed` | Owner request or admin | Zero balance, no open orders, returns or disputes |

"Live" is not a status. It is derived: `approved` AND storefront published AND `launched_at` set. A brand can build and preview its storefront in any status through a signed preview URL.

**Verification tier** is derived from `verification_submissions` and performance:

| Tier | Requirements | Unlocks | Payout policy (§4.7) |
|---|---|---|---|
| `unverified` | none | Build and preview only | none |
| `basic` | Owner identity (BVN/NIN) plus bank account resolved-name match | Selling (once approved), payouts | `new` |
| `verified` | `basic` + business registration (CAC, where applicable) + 30 days + ≥20 delivered orders + dispute rate <1% | "Verified" badge (auto-rendered) | `verified` |
| `trusted` | Admin grant | Auto-approved drops, faster payouts, on-demand payouts | `trusted` |

A tier can be downgraded when a document expires, a recheck fails, or an admin acts.

- **Verification submissions:** `pending → in_review → approved | rejected`, and `approved → expired`. A rejection requires a new submission.
- **Payout account:** `pending_verification → active | needs_review | disabled`, `needs_review → active | disabled`, and `active → restricted` during the 48-hour cooldown after a bank change.

### 3.9 Ad campaign

| From | To | Trigger | Effects |
|---|---|---|---|
| `draft` | `pending_payment` | Brand picks a slot | `ad_bookings` row `held` for 30 minutes |
| `pending_payment` | `pending_review` | Payment verified, or balance deduction in collect mode | Booking becomes `booked`. `sponsored_charge` journal |
| `pending_payment` | `cancelled` | Hold expires or brand abandons | Booking `released` |
| `pending_review` | `scheduled` | Ads reviewer approves (SLA 1 business day; under 48h to start is flagged urgent) | |
| `pending_review` | `changes_requested` | Reviewer (reason codes) | |
| `changes_requested` | `pending_review` | Brand resubmits a new creative version | |
| `pending_review`, `changes_requested` | `rejected` | Reviewer, or no fix by `starts_at − 24h` | Full refund (reversal journal), booking released |
| `scheduled` | `active` | `starts_at` | Daily revenue recognition begins |
| `scheduled` | `cancelled` | Brand at least 72h before start (full refund), or admin | |
| `active` | `paused` | Admin only (incident) | Paused time over 20% of the window triggers a make-good credit |
| `paused` | `active` | Admin | |
| `active` | `cancelled` | Admin | Pro-rata credit |
| `active` | `completed` | `ends_at` | |

Editing an approved creative creates version n+1 in `pending_review`, while version n keeps serving. Suppression (out of stock, unpublished, filter mismatch) is a delivery-eligibility rule, not a state.

---

## 4. Commerce reliability

### 4.1 Inventory holds and TTLs

**Decision:**

| Case | When the hold is taken | TTL |
|---|---|---|
| Normal catalog | At "Continue to payment", for all lines. Add-to-cart only soft-validates | 15 minutes |
| Drop item | At add-to-bag or Buy now, after the gate, admission pass and Turnstile checks | `hold_ttl_seconds`, default 600, range 300–900 |
| Extension at payment initialization (once only) | Card: `max(expires_at, now+5m)`. Bank transfer or USSD: `max(expires_at, now+15m)`, passed as Paystack `account_expires_at` (minimum 15 minutes) | Hard cap of 30 minutes from creation |

- The checkout deadline is `min(hold.expires_at)`.
- A drop line whose hold expires **before** payment initialization is removed from the bag with a notice. The rest of the multi-brand cart continues and is re-quoted.
- After initialization, lines are frozen because the splits have already been sent to the provider.

**Reserve transaction.** Use READ COMMITTED, no HTTP calls inside the transaction, and a fixed lock order: customer counters, then `drop_variants` by `variant_id`, then `inventory_levels` by `(variant_id, location_id)`, then merchant ledger balances by `account_id`.

```sql
BEGIN;
SET LOCAL lock_timeout = '500ms'; SET LOCAL statement_timeout = '2s';
-- Drops only: per-customer limit
INSERT INTO drop_customer_counters (drop_id, customer_id) VALUES ($d, $c) ON CONFLICT DO NOTHING;
UPDATE drop_customer_counters SET held_qty = held_qty + $q
 WHERE drop_id = $d AND customer_id = $c AND held_qty + purchased_qty + $q <= $limit
RETURNING 1;                                   -- 0 rows → LIMIT_REACHED
-- Drops: gate + stock in one conditional update
UPDATE drop_variants dv SET held_qty = dv.held_qty + $q
  FROM drops d
 WHERE dv.drop_id = $d AND dv.variant_id = $v AND d.id = dv.drop_id
   AND d.status IN ('scheduled','live') AND now() >= d.starts_at AND (d.ends_at IS NULL OR now() < d.ends_at)
   AND dv.allocated_qty - dv.held_qty - dv.sold_qty >= $q
RETURNING dv.allocated_qty - dv.held_qty - dv.sold_qty AS remaining;
                                               -- 0 rows → reclaim expired holds for this variant once, retry, else SOLD_OUT / NOT_LIVE
-- Normal catalog equivalent:
-- UPDATE inventory_levels SET reserved = reserved + $q WHERE variant_id=$v AND location_id=$l AND available >= $q RETURNING available;
INSERT INTO inventory_holds (..., status, expires_at) VALUES (..., 'active', now() + make_interval(secs => $ttl));
-- + inventory_movements row (reason hold_created, idempotency_key = 'hold:'||hold_id)
COMMIT;
```

- Under READ COMMITTED, a concurrent `UPDATE` waits for the row lock and then re-checks the `WHERE` clause against the new row version, so the conditional decrement is race-free. This is standard Postgres behaviour.
- The CHECK constraints on `drop_variants` and `inventory_levels` are the final guard against a code bug.
- On serialization or lock timeout, return `503 {code:'BUSY'}`. The client retries with jittered backoff. Do **not** use SERIALIZABLE.

**Expiry:**
- One BullMQ delayed job per hold (`jobId: hold:{id}:expire`).
- A sweeper every 30 seconds runs `UPDATE inventory_holds SET status='expired' WHERE id IN (SELECT id … WHERE status='active' AND expires_at < now() ORDER BY expires_at LIMIT 500 FOR UPDATE SKIP LOCKED) RETURNING …` and decrements the counters in the same transaction.
- The reserve path also reclaims expired holds lazily.
- Alert when the count of `active` holds with `expires_at < now() − 60s` is greater than 0.

**Conversion on verified payment.** One transaction: holds go `active → converted`. For drops, `held −q` and `sold +q`, and the customer counter moves `held → purchased`. Then `reserved` or `allocated` −q and `committed` +q, then merchant orders, order items, ledger journals and outbox entries.

**Hot drops:**
- **Waiting room.** A Redis ZSET `drop:{id}:queue` opens at `queue_opens_at`. Joins before the start get **random** scores, and joins after the start are FIFO by join time.
- **Admission.** Admit at `admission_rate_per_minute`, capped at 2× the remaining units. Stop admitting when available plus active holds reaches 0, and tell everyone immediately.
- **Admission pass.** A signed JWT `{sub, drop_id, sid, jti, exp: admitted_at+10m}`, required by the reserve endpoint. The `jti` is stored on the hold.
- **Bot protection:**
  - `standard`: a Turnstile token on queue join and on reserve. Verify it server-side before opening the database transaction, using `idempotency_key` set to the request ID. Mint the token at T-0, because it expires after 300 seconds.
  - `strict`: adds a verified phone, account age of at least 24 hours, and no guest checkout.
  - Drops always require a signed-in account with a verified email.
- **One guard function**, `assertDropPurchasable(dropId, customerId, pass)`, runs on every purchase path: cart add, buy now, express wallets, mobile API and admin-created orders.
- **Post-payment validator.** A BullMQ job checks limits across the identity graph (`drop_identity_counters`). It auto-cancels violating orders, refunds them and posts ledger reversals.
- **Hot-row fallback.** If load tests show lock waits, split one variant's allocation into K `drop_variant_buckets` and pick a bucket with `FOR UPDATE SKIP LOCKED LIMIT 1`. Numbered art editions use per-unit `drop_units` rows with `SKIP LOCKED`, which also gives each buyer an auditable edition number.
- **Countdown.** `GET /api/drops/{slug}/status` returns `{status, phase, server_now, starts_at, ends_at, opens_in_ms, queue, availability:{level, sizes[]}}`. The client computes its clock offset from `server_now` with an RTT correction, and re-polls every 60 seconds, on `visibilitychange`, and through the final 10 seconds. The server flips the state; the purchase panel is never statically cached.
- **Capacity.** Load-test with k6 at 10× the expected peak before the first hot drop. The ceiling of about 200 concurrent reserve attempts per hot variant is *(unverified)*. Admin caps hot drops at 3 per 30-minute slot.

### 4.2 Idempotency

- **Inbound.** `Idempotency-Key` is required on `POST /api/checkout`, refunds, payout approvals, ad bookings and admin money actions. Keys are stored in `idempotency_keys` with a request hash, a recovery point (`started | checkout_locked | splits_persisted | provider_initialized | finished`) and the final response, and expire after 24 hours. The same key with different parameters returns 422. Concurrent use returns 409. The checkout client generates one key per checkout attempt and keeps it in `sessionStorage`, so a double-click on Pay during a drop returns the same `authorization_url`.
- **Outbound references.** References are deterministic and **persisted before** the HTTP call: `pay_{groupId}_{n}`, `po_{payoutId}`, `rf_{refundId}`, and for Stripe later `transfer:{orderId}` and `reversal:{refundId}`.
  - Retry with the **same** reference. A new reference creates a second transfer.
  - Treat a timeout as status unknown and query the provider before retrying.
  - Paystack refunds have no documented idempotency key *(unverified)*, so call `GET /refund?transaction=` before any retry.
  - Flutterwave rejects duplicate transfer references (code 201409).
- **Internal keys.**
  - `ledger_transactions.idempotency_key` is UNIQUE, so webhook redelivery cannot post twice. Formats are `{provider}:{event}:{providerRef}` and `{domain}:{entityId}:{step}`.
  - `inventory_movements.idempotency_key` is UNIQUE.
  - `notification_deliveries.dedupe_key` is UNIQUE.
  - Every BullMQ `jobId` is deterministic.

### 4.3 Webhook verification and ingestion

```ts
// app/api/webhooks/paystack/route.ts
export const runtime = 'nodejs';
export async function POST(req: Request) {
  const raw = await req.text();                                  // raw bytes; never re-serialized JSON
  const sig = req.headers.get('x-paystack-signature') ?? '';
  const mac = createHmac('sha512', env.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
  const ok = sig.length === mac.length && timingSafeEqual(Buffer.from(sig), Buffer.from(mac));
  if (!ok) return new Response(null, { status: 401 });
  const evt = JSON.parse(raw);
  const dedupeKey = `${evt.event}:${evt.data?.id}:${evt.data?.status ?? ''}` || sha256(raw);
  await db.transaction(async (tx) => {
    const row = await tx.insert(providerEvents).values({ provider: 'paystack', dedupeKey, /* … */ })
      .onConflictDoNothing().returning();
    if (row[0]) await enqueueOutbox(tx, 'webhook-ingest', { id: row[0].id });   // jobId = provider_events.id
  });
  return new Response(null, { status: 200 });                    // < 1s
}
```

| Provider | Authentication | Required follow-up |
|---|---|---|
| Paystack | `x-paystack-signature`, HMAC-SHA512 hex of the raw body, keyed with the secret key. IP allowlist 52.31.139.75, 52.49.173.169 and 52.214.14.220 as defence in depth, read from the trusted forwarded header | Re-fetch `GET /transaction/verify/:reference` and assert `success`, amount, currency and reference |
| Flutterwave v3 | `verif-hash` is a **static** secret compared for equality. It can be replayed | Verifying through `GET /v3/transactions/{id}/verify` is **mandatory** before posting. Deduplicate on `data.id`. The v4 HMAC-SHA256 base64 header is *(unverified)* |
| Stripe (phase 2) | Timestamped signature with a 300-second tolerance | Event-id dedupe |

- **Workers** move state forward only. A `refund.pending` that arrives after `refund.processed` is recorded and ignored. Ledger posting happens inside the worker's database transaction.
- **Missed-webhook sweeper** (every 5 minutes) verifies:
  - card payments still `pending` after 15 minutes,
  - bank-transfer payments still pending after `provider_expires_at`,
  - payouts still `processing` after 1 hour,
  - refunds still pending after 24 hours.
- **Retention and tooling.** `provider_events` is kept indefinitely, because Paystack retries for up to about 72 hours *(unverified)*. Admin has a "Reprocess stored event" action, which re-runs the idempotent worker and never re-sends the raw event. Secrets are separate per provider and per environment.
- **The return page** polls `/api/checkout/{id}/status`, which is server-verified. Query parameters such as `?status=success` are ignored.

### 4.4 Settlement mode (decide in §10)

The ledger is identical in both modes. Only the accounts that record where funds sit differ.

- **`split_at_charge` (default for launch).**
  - One Paystack transaction per checkout group, with an **inline flat multi-split**: one entry per brand subaccount, where share is `merchant_net_minor`, and `bearer_type=account`, so Paystack's fee comes out of the platform remainder.
  - Never use percentage splits, because provider-side rounding will not match the ledger.
  - The platform remainder equals the sum of commissions.
  - Ask Paystack to put subaccounts on WEEKLY or MANUAL settlement *(approval-gated, unverified)*. Without that, hold and reserve policies cannot be enforced in this mode.
- **`collect_then_transfer`.** All funds land in the platform's provider balance, and brands are paid through the Transfers API after holds. This mode is only allowed with a written opinion from Nigerian fintech counsel, because of the CBN restriction on holding customer funds *(applicability unverified)*.

The `PaymentProvider` interface branches on declared capabilities, never on provider names:

```ts
interface PaymentProvider {
  id: 'paystack' | 'flutterwave' | 'stripe' | 'adyen';
  capabilities: { splitAtCharge: boolean; maxSplitRecipients?: number; providerHeldDelayedSettlement: boolean;
    manualPayouts: boolean; partialRefunds: boolean; preauth: boolean; maxPreauthHoldDays?: number;
    refundIdempotency: 'native' | 'reference' | 'none'; currencies: string[]; amountUnit: 'minor' | 'major';
    webhookAuth: 'hmac_sha512_hex' | 'static_secret' | 'hmac_sha256_b64' | 'timestamped_hmac' };
  resolveBankAccount(i): Promise<{ accountName: string }>;
  onboardMerchant(i): Promise<{ providerAccountRef: string; status: 'pending' | 'active' | 'restricted'; requirements: string[] }>;
  createPayment(i: { idempotencyKey: string; reference: string; amountMinor: bigint; currency: string; customer;
    splits: SplitLine[]; channels?: string[]; expiresAt?: Date; returnUrl: string; metadata })
    : Promise<{ providerPaymentRef: string; redirectUrl?: string; clientSecret?: string; expiresAt?: Date }>;
  verifyPayment(reference: string): Promise<NormalizedPayment>;
  chargeSavedAuthorization?(i): Promise<NormalizedPayment>;           // draws: charge on win
  preauthorize?(i); capturePreauth?(i); releasePreauth?(i);          // draws: if capability
  refund(i: { idempotencyKey: string; providerPaymentRef: string; amountMinor: bigint; currency: string; reason: string;
    allocations?: SplitLine[] }): Promise<NormalizedRefund>;
  createPayout(i: { reference: string; recipientRef: string; amountMinor: bigint; currency: string; narration: string })
    : Promise<NormalizedPayout>;
  verifyWebhook(raw: string, headers: Headers): boolean;
  parseWebhook(raw: string, headers: Headers): NormalizedEvent[];   // payment.*, refund.updated, payout.updated, dispute.*, settlement.updated
  listSettlements(i); listSettlementItems(id: string);
  submitDisputeEvidence?(i); resolveDispute?(i);
}
// SplitLine = { kind: 'merchant_net'|'commission'|'provider_fee'|'sponsored_fee'|'tax'|'remainder', brandId?, amountMinor, reference }
```

Typed split lines map one-to-one onto Adyen's split model later. Adapters for providers that support fewer kinds collapse them.

### 4.5 Ledger posting rules

These are posted by one writer, `postJournal(tx, {idempotencyKey, type, effectiveAt, entries[], links})`, inside the business transaction.

**Notation:**
- `g_b` is the brand's gross credit: items − brand-funded discount + shipping + tax.
- `c_b` is the commission and `v_b` the VAT on commission, if charged.
- `n_b = g_b − c_b − v_b`.
- `T` is what the customer paid, `P` the platform-funded discount, `F` the actual provider fee.

| Event | Journal type | Entries (Dr / Cr) | Idempotency key |
|---|---|---|---|
| Payment verified | `payment_captured` | Dr `provider_clearing` T; Dr `promotions_expense` P; Cr `merchant_pending:{b}` g_b for each brand (T + P = Σg_b) | `{provider}:payment:{reference}` |
| Same transaction | `commission_assessed` | Dr `merchant_pending:{b}` c_b + v_b; Cr `commission_revenue` c_b; Cr `vat_payable` v_b | `commission:{merchantOrderId}` |
| Same transaction | `provider_fee` | Dr `processing_fees` F; Cr `provider_clearing` F | `fee:{paymentAttemptId}` |
| Funds release (delivered + N, or shipped fallback) | `hold_release` | Dr `merchant_pending` n; Cr `merchant_available` n − r; Cr `merchant_reserve` r | `release:{merchantOrderId}` |
| Reserve release | `reserve_release` | Dr `merchant_reserve` r; Cr `merchant_available` r | `reserve_release:{holdId}` |
| Payout initiated (collect mode) | `payout_initiated` | Dr `merchant_available` P; Cr `payout_in_transit` P | `payout:{id}:initiated` |
| Payout paid | `payout_settled` | Dr `payout_in_transit` P; Cr `provider_clearing` P (+ Dr `transfer_fees` / Cr `provider_clearing` when the platform bears the fee) | `payout:{id}:settled` |
| Payout failed or reversed | `reversal` | Mirror of `payout_initiated` | `payout:{id}:reversed` |
| Provider settles a brand directly (split mode) | `provider_settlement_merchant` | Dr `merchant_available` (or `pending` if not yet released) n; Cr `provider_clearing` n | `{provider}:settlement:{id}:{brandId}` |
| Platform settlement to bank | `provider_settlement_platform` | Dr `platform_bank` X; Cr `provider_clearing` X | `{provider}:settlement:{id}` |
| Refund approved | `refund_initiated` | Dr `merchant_available` (or `pending`) R_b − cr; Dr `commission_reversals` cr; Cr `customer_refunds_payable` R; Cr `promotions_expense` p (platform-funded share of the refunded lines, so R_b = R + p) | `refund:{id}:initiated` |
| Refund processed | `refund_completed` | Dr `customer_refunds_payable` R; Cr `provider_clearing` R | `{provider}:refund:{ref}:processed` |
| Refund failed | `reversal` | Mirror of `refund_initiated` | `refund:{id}:failed` |
| Negative balance sweep (daily) | `adjustment` | Dr `merchant_receivable` d; Cr `merchant_available` d | `negsweep:{brandId}:{date}` |
| Dispute opened | `dispute_opened` | Dr `dispute_clearing` D; Cr `provider_clearing` D; Dr `merchant_available` (D − c_D); Cr `merchant_dispute_hold` (D − c_D) | `{provider}:dispute:{id}:opened` |
| Dispute won | `dispute_won` | Reverse both pairs | `{provider}:dispute:{id}:won` |
| Dispute lost, brand liable | `dispute_lost` | Dr `merchant_dispute_hold` (D − c_D); Dr `commission_reversals` c_D; Cr `dispute_clearing` D; fee: Dr `merchant_available` (or `dispute_fees`) f; Cr `provider_clearing` f | `{provider}:dispute:{id}:lost` |
| Dispute lost, platform liable | `dispute_lost` | Release the hold back to `merchant_available`; Dr `bad_debt` D; Cr `dispute_clearing` D | same |
| Sponsored purchase (card) | `sponsored_charge` | Dr `provider_clearing` S + V; Cr `sponsored_revenue_deferred` S; Cr `vat_payable` V. In collect mode, a balance deduction debits `merchant_available` instead | `ad:{campaignId}:charge` |
| Daily ad recognition | `sponsored_recognized` | Dr `sponsored_revenue_deferred` s; Cr `sponsored_revenue` s | `ad:{campaignId}:recognize:{date}` |
| Ad reject, cancel or make-good | `reversal` / `ad_credit` | Mirror, or credit to `ad_credits` | `ad:{campaignId}:refund` |
| Late payment auto-refund | `payment_captured_unallocated` then `refund_completed` | Dr `provider_clearing` T; Cr `customer_refunds_payable` T; fee to `processing_fees`. In split mode, brand shares already routed become `merchant_receivable` and are recovered from future splits | `{provider}:late:{reference}` |
| Manual correction | `adjustment` | Any balanced set. Maker-checker approval, reason and attachment required | `adj:{makerCheckerId}` |

VAT on commission reverses proportionally with the commission. Holds, draw entries and pre-authorizations are **memo only**: no postings until capture.

**Worked example.** Brand A has ₦50,000 of items plus ₦3,000 shipping. Brand B has ₦30,000 of items plus ₦2,000 shipping. The customer pays T = ₦85,000 on a local card. The fee is 1.5% + ₦100 = ₦1,375.
- J1: Dr `provider_clearing` 85,000; Cr A pending 53,000; Cr B pending 32,000.
- J2: Dr A pending 2,500 and Dr B pending 1,500; Cr `commission_revenue` 4,000.
- J3: Dr `processing_fees` 1,375; Cr `provider_clearing` 1,375.
- Split sent to Paystack: A 50,500 and B 30,500 (flat). The platform remainder is 4,000 − 1,375 = **₦2,625 net**.

**Integrity checks:**
- A nightly job checks that Σ of all entries per currency is 0.
- Flag `provider_clearing` items older than T+1 plus weekends and holidays.
- Merchant balance tiles in Brand Studio read the ledger accounts directly.
- No table holds a mutable "balance" number.

### 4.6 Commission and rounding rules

- **Rate.** Stored as the platform's take in bps, with 500 = 5%.
  - Resolution order: time-boxed `campaign` override, then `product`, then `brand`, then `category`, then `global`. The first match by priority wins.
  - v1 enables only `global` (500) and `brand` overrides for negotiated deals.
  - The resolved rule ID, bps and amounts are snapshotted at quote time and never recomputed.
- **Base.** `commission_base = Σ(line_subtotal − brand_funded_discount)`. Shipping and VAT are **excluded** and pass through to the brand. Platform-funded discounts **never** reduce the base or the brand's net.
- **Formula.** Computed per merchant order, in BigInt: `commission = roundHalfEven(base × bps / 10000)`. Let `q = (base×bps) / 10000` and `r = (base×bps) % 10000`. If `2r > 10000`, add 1. If `2r = 10000`, add 1 only when q is odd.
- **No fixed fees in v1.** If fixed fees are ever introduced, they apply once per merchant order, never per unit. A WCFM bug applied them per unit.
- **Allocation.** Discounts, shipping and commission are spread across brands and lines with largest-remainder (Hamilton) allocation: floor each share, then hand out the remaining units by largest fraction, breaking ties by line ID. The parts always sum to the whole.
- **Refund reversal is cumulative.** `rev_k = round(C × Rcum_k / G) − round(C × Rcum_{k−1} / G)`, where G is the commission base and Rcum is the cumulative refunded base.
  - Example: three items at ₦3,333.33 give G = 999,999 kobo and C = round(49,999.95) = 50,000 kobo.
  - Refunding one item at a time gives reversals of 16,667, then 16,666, then 16,667, which sum to exactly 50,000.
- **Provider fees.** Recorded from the verify response. The platform absorbs them at launch (`fee_bearer=platform`); see §10 for international cards.
- **Testing.** Property tests with fast-check assert that split lines sum to the charge, allocations sum to totals, and full refunds reverse exactly C. Cases cover multi-unit lines, 10-brand carts, zero-commission items, and currencies with 0 and 3 decimal places.

### 4.7 Payout holds and reserves (Decision; values are configurable in `reserve_policies`)

| Tier | Funds become available | Rolling reserve | Schedule | Minimum payout |
|---|---|---|---|---|
| `new` | `delivered_at` + 7 days (fallback `shipped_at` + 14 days) | 10% held for 60 days | Weekly | ₦5,000 |
| `verified` | `delivered_at` + 3 days (fallback `shipped_at` + 10 days) | 0 | Weekly. On-demand allowed, with the brand paying the transfer fee | ₦5,000 |
| `trusted` | `shipped_at` + 2 days | 0 | Weekly or on-demand | ₦5,000 |

- **Drop hold.** If a drop's GMV exceeds 5× the brand's trailing 30-day GMV, drop orders get +7 days.
- **Manual approval** is required for a brand's first payout, for payouts above a threshold, and for any payout within 48 hours of a bank-detail change.
- **Negative balances** are allowed. They net automatically against future credits. Above `debt_limit_minor`, the brand's selling is frozen and an admin is alerted. In split mode, debt is recovered by holding back part of the brand's future flat split shares.
- **Refund float.** Keep at least 7 days of trailing refunds in the Paystack main balance and alert below that. Third-party sources say refunds on settled splits are drawn from the main balance *(unverified)*.
- **Reconciliation.** A daily BullMQ job runs at 06:00 WAT for D-1, per provider and currency, and does a three-way match:
  - ledger against provider transactions (reference, amount, currency, fee),
  - settlements against their items (including per-subaccount settlements),
  - bank credits against platform settlements.

  It uses the provider's `settlement_date`, not `created_at`. Exceptions go to Admin for resolution through maker-checker adjustment journals.

### 4.8 Refund and chargeback cost allocation

| Reason | Customer receives | Brand bears | Commission | Processing fee |
|---|---|---|---|---|
| Return within policy, not as described, wrong item, defective, damaged in transit | Paid amount for the lines, plus shipping if the brand was at fault | Goods net | Reversed pro rata | Platform absorbs |
| Cancelled before ship, or out of stock (brand cancels) | Full amount | Goods net. Counts toward the brand cancel rate | Reversed | Platform absorbs |
| Late payment unavailable, drop oversell, platform bug | Full amount | Nothing | Not applicable | Platform |
| Goodwill (admin) | As decided | Nothing | Not applicable | Platform |
| Chargeback lost, brand liable (no proof of delivery) | Per provider | D − c_D, plus the dispute fee (configurable) | Reversed | Platform |
| Chargeback lost, platform liable (fraud screen miss) | Per provider | Nothing | Not applicable | Platform (`bad_debt`) |

Return shipping is paid by the brand when the brand is at fault. For change-of-mind returns, the brand's return policy decides.

### 4.9 Operational alerts

- Leaked holds.
- Webhook backlog and the age of the oldest unprocessed event.
- Sweeper findings.
- Any breach of the ledger Σ=0 invariant (page immediately).
- `provider_clearing` aging.
- Refund float below threshold.
- Reserve endpoint p95 latency and lock-timeout rate on drop days.
- Dispute `due_at` within 6 hours with no response.
- Reconciliation exception count.

---

## 5. Brand Studio UX patterns to adopt

### 5.1 One `<ResourceIndex>` used everywhere (Brand Studio and Admin)

- **Built on** shadcn Table and TanStack Table.
- **Header:** title, a primary action ("Add product"), and secondary actions (Import, Export).
- **Saved-view tabs:** synced to the URL and stored per user in the database.
- **Controls:** debounced search, filter chips, a sort popover, and cursor pagination.
- **Selection:** row selection with "Select all N matching". The **filter query** is sent to the server, never a list of IDs.
- **Bulk actions:** a sticky bar with verb-plus-noun labels. Bulk work runs as a BullMQ job with a progress toast ("Archiving 312 products…") and an audit log. Destructive actions open a modal that states the count.
- **Badge tones:**
  - `draft` neutral, `active` success, `unlisted` info, `archived` muted.
  - `paid` success, `partially_refunded` warning, `refunded` neutral.
  - `unfulfilled` attention, `scheduled` info ("Scheduled for drop"), `on_hold` warning.
  - Badges are always text, never a colour dot alone.

**Index pages:**

| Page | Tabs | Columns | Bulk actions |
|---|---|---|---|
| Products | All, Active, Draft, Unlisted, Archived | Thumbnail and title, status, inventory text ("14 in stock for 4 variants", red at 0), category, marketplace visibility, in-drop flag. Filters: status, category, collection, tag, stock (in, low, out), in drop | Set active, Set draft, Archive, Add tags, Add to collection, Delete |
| Orders | To fulfil, Unpaid (n/a because orders are born paid, so this tab is omitted), Scheduled, Shipped, Delivered, Returns, Cancelled, Archived, All | Brand order number with the group number as secondary text, date, customer, items, total, **your earnings**, payment badge, fulfillment badge, SLA chip ("Ship by Thu") | Mark as fulfilled, Print packing slips, Archive, Add tags |
| Customers | Segment presets as tabs: All, Repeat, Lapsed 90d, High spend, Followers who never bought, Subscribed | Name, consent badge, location, orders with this brand, total spent | CSV export of **consented contacts only** |

### 5.2 Detail pages and the save bar

- **Layout:** two columns, a main column (about two thirds) of cards and a sidebar (about one third). The header has a back arrow, title, status badge, secondary actions and previous/next arrows.
- **Form:** one form per page, using React Hook Form and Zod. A global `<SaveBar>` appears whenever `formState.isDirty`.
  - It reads "Unsaved changes" with [Discard] and [Save], or "Unsaved product" for a new item.
  - Save is disabled while the form is invalid or submitting.
  - Leaving a dirty page asks for confirmation, through both a `beforeunload` handler and Next.js router interception, including the browser back button.
  - A failed save shows inline field errors plus a top banner listing them.
- **Optimistic concurrency:** each save sends `version`. A stale save gets 409 and a banner: "This product was changed by someone else. Review changes."
- **Test cases:** discard, failed save, client-side navigation and the back button.

**Product editor:**
- **Main column:**
  - Title and description (restricted rich text).
  - Media grid with drag-to-reorder, first image as cover, alt text required, and the 4:5 rule enforced. White backgrounds are detected with the note: "White background detected; it will show on a soft plate in the marketplace."
  - Pricing: price, compare-at, cost, live margin, and **"You earn ₦X after 5% commission"**.
  - Inventory: track toggle, SKU, barcode, quantity. The "continue selling" option is hidden for drops.
  - Shipping: weight, requires shipping.
  - Variants: an option builder for up to 3 options with chip inputs. It auto-generates a matrix with inline price, quantity and SKU, a group-by option, bulk edit, and duplicate-combination prevention.
  - Size chart picker and builder with presets (Tops, Bottoms, Footwear, Rings).
  - SEO preview.
- **Sidebar:** Status, Visibility (Marketplace, Storefront, Drop with schedule), Organization (category, tags, collections), Storefront layout (alternate product page).

**Inventory page** (per variant and location):
- "Available" is editable through a ± popover that **requires a reason** (Received, Correction, Count, Damaged, Shrinkage, Safety stock, Other with a note).
- "On hand", "Committed", "Held" and "Unavailable" are read-only, each with a tooltip definition.
- "View history" opens a drawer listing date, activity (linked to the order, return or drop), actor, and per-bucket change with the resulting value.

**Order detail:**
- **Header:** `MK-7F3K2Q-02`, with badges and actions [Fulfill] [Refund] [More: Cancel order, Archive, Print].
- **Main cards:**
  - Unfulfilled (n), with Mark as fulfilled.
  - Fulfilled, with tracking and Edit tracking.
  - Money breakdown: Subtotal, Brand discount, Platform-funded discount ("covered by platform, you still earn on full price"), Shipping, Tax, Total. Then Commission 5.00% of base X (rule source), Processing fee (only if passed through), **Your earnings**, and payout state ("On hold until 14 Nov (new brand: 7 days after delivery)", then Available, then In payout #123, then Paid). Each line links to its ledger transaction.
  - Timeline from `order_events` with a comment box.
- **Sidebar:** customer (number of orders with this brand), contact, shipping address, notes, tags, and a link to the group in Admin.

**Fulfill flow:**
- One quantity stepper per line, defaulting to the remaining quantity.
- Carrier select (local couriers plus Other) and tracking number, with the tracking URL built automatically.
- A "Notify customer" checkbox, then [Fulfill items].
- A partial fulfillment leaves the remainder in Unfulfilled.

**Refund drawer:**
- Per-line quantity, with restock type derived automatically (`cancel` if unfulfilled, `return` if fulfilled).
- Shipping refund field and a required reason code.
- A live preview: "Customer receives ₦X · Your earnings change −₦Y · Commission returned ₦Z · Processing fee not returned (absorbed by platform)."
- A note on whether it auto-approves or needs platform review, with the SLA.
- Afterwards, a timeline (Requested, Processing, Refunded) with "up to 10 business days to reach the customer".

### 5.3 Finance

- **Four balance tiles,** each mapped one-to-one to a ledger account: **On hold** (pending, with the next release date), **Available**, **Reserve** (with a release schedule popover), and **Paid out (30d)**.
- **Next payout card:** "Tue 11 Nov · est. ₦182,400 → GTBank ••4321", with the account status.
- **"Balance owed" banner** in red whenever `merchant_receivable > 0`.
- **Statement table:** Date, Type (Sale, Commission, Refund, Reversal, Payout, Reserve hold or release, Dispute, Sponsored), Reference, ±Amount, running balance. Reversals appear as linked lines ("Reversal of TX-…"). CSV export. Rows are never editable.
- **Payouts list:** ID, initiated, expected arrival, status, amount, fee, number of orders. A drawer lists included ledger lines, and a failure shows a "Fix bank details" call to action.
- **Disputes inbox:** sorted by `due_at`, with a large countdown (red under 6 hours).
  - The evidence form is prefilled from fulfillment data (courier, tracking, `delivered_at`, address, proof of delivery), with Accept or Challenge.
  - Push, email and SMS go out the moment a dispute opens.
  - Disputes auto-escalate to Admin Trust & Safety at T-6h.

### 5.4 Empty states

Every list has two variants:
- **First run:** an illustration, an action heading, one sentence and one call to action. For example, Drops: "Plan your first drop: schedule a limited release with a countdown your followers get notified about", with [Create drop].
- **No results:** "No orders match these filters", with [Clear filters].

Skeleton loaders mirror the final layout. Toasts include Undo where it is safe. Page-level banners carry warnings such as "Hidden from the marketplace: under review".

### 5.5 Home and metrics

- **Before approval,** Home is the launch checklist (§5.6).
- **After approval,** Home shows:
  - KPI cards with a date range, comparison to the previous period, a sparkline and an (i) tooltip with the **exact formula**.
  - A funnel: Sessions, then Product views, then Added to bag, then Checkout started, then Paid.
  - Top products, and traffic sources, with **Sponsored** shown as its own labelled source.
  - Action cards: "5 orders to fulfil", "Drop goes live in 2d", "Low stock on 3 variants", "Dispute due in 9h".

**Metric definitions.** These are implemented once in a shared `analytics` module used by Brand Studio, Admin and payout statements:

| Metric | Definition |
|---|---|
| Session | Continuous activity on brand surfaces (storefront, PDP, drop page). Ends after 30 minutes of inactivity or at midnight **in the brand's timezone**. The tooltip states that this differs from Shopify's UTC reset |
| Conversion rate | Sessions with at least one paid order for this brand ÷ sessions |
| Orders | Merchant orders paid in the period. Never counted as checkout groups |
| Gross sales | Σ unit price × quantity before discounts |
| Discounts | Brand-funded only. Platform-funded discounts are shown separately and not deducted |
| Returns | Refunded item amounts, booked on the **refund processed date** |
| Net sales | Gross − brand discounts − returns |
| Total sales | Net sales + shipping + tax |
| AOV | (Gross − brand discounts) ÷ orders, per merchant order |
| Returning customer rate | Customers in the period with at least 2 lifetime orders from this brand ÷ customers who ordered in the period. Uses all-time history |
| Net payout | Net ledger movement into this brand's merchant accounts in the period. Reconciles exactly to statements |
| Drop sell-through and time to sell out | Units sold ÷ allocated, and `sold_out_at − live_at` |
| Hold conversion | Holds converted ÷ holds created |
| Attributed orders (ads) | 7-day click, net of refunds. See §8 |

### 5.6 Onboarding: a short wizard plus a computed checklist

**Wizard** (at most 5 steps, resumable, with progress dots):
1. Account, with a 2FA prompt.
2. Brand basics: name, handle with a live availability check, country, base currency, primary category.
3. Template pick: four large live previews (Editorial, Minimal, Street, Studio) using the brand's own logo and images when available.
4. First product, using a minimal form.
5. Payout account: choose the bank and enter the account number. `resolveBankAccount` shows the resolved account name beside the KYC legal name with a match indicator, and the brand confirms before it is stored.

**Launch checklist.** `getOnboardingState(brandId)` computes it from real rows, so it never goes stale.

| Gate | Requires |
|---|---|
| Build and preview | Nothing. Always available. Building is never blocked by KYC |
| Submit for review | Profile complete (square logo at least 512px, banner, tagline, story of at least 80 characters, category, city and country). Template chosen with a hero section. **At least 3** sale-ready products (approved 4:5 image, price, stock, and a size chart for apparel or footwear). Shipping profile (zone, rate, processing days). Return policy. `basic` verification. Active payout account |
| Listed on the marketplace and selling | `approved` + storefront published |
| Payout release | Active payout account, not in cooldown |
| Launch boost (30 days from approval) | At least 6 products with at least 3 images each |
| Sponsored eligibility | Approved for at least 14 days, at least 1 fulfilled order, no open disputes |
| Verified badge | `verified` tier |

Recommended tasks (dismissible): size charts, lookbook, first drop, team invited.

### 5.7 Other Brand Studio surfaces

- **Drop wizard (6 steps):**
  1. Products and per-size allocation, read from available stock.
  2. Release type, with a recommendation. If the demand ratio, (notify-me count + 0.1 × followers) ÷ units, is above 5, suggest a Draw or FCFS with a queue *(our heuristic)*.
  3. Schedule in the brand's timezone, with live previews in WAT, GMT and ET, DST warnings and slot-congestion warnings. Suggested "Drop Day" slots are Thursday and Saturday at 11:00 WAT.
  4. Access and limits: early-access grants, per-customer limits, countries, bot protection.
  5. Story page.
  6. Review.

  After scheduling, a **Drop room** shows live counters.
- **Discovery panel:** launch-boost countdown and unlock checklist, discovery tier and quality score with improvement tasks, follower growth, Top Rated progress, editorial pick history (with start and end dates), and sponsored performance kept separate from organic.
- **Roles:**
  - Owner, Admin and Designer can publish the storefront.
  - Finance owns payouts, bank details and refunds above a threshold.
  - Fulfillment ships orders.
  - Viewer is read-only.
- **Admin reuses the same components** for its queues: brand review, verification, refund approvals, payout batches (with a second approver above a threshold), ad review, curation, the ledger explorer (T-account view and raw webhook viewer), reconciliation, and the drop control room (queue length, admit rate slider, active holds, p95 latency, kill switch, draw seed viewer).

---

## 6. Storefront editor model

### 6.1 Config document (stored as `jsonb`, validated by one Zod schema)

```ts
type StorefrontConfig = {
  schemaVersion: 1;
  template: 'editorial' | 'minimal' | 'street' | 'studio';
  style: string;                                   // template style preset id (≤5 per template, e.g. 'street/ink', 'street/acid')
  theme: ThemeTokens;
  groups: { announcement: SectionList; header: SectionList; footer: SectionList };   // ≤4 sections each
  pages: {
    home: SectionList; product: SectionList; collection: SectionList; drop: SectionList; about: SectionList;
    [alt: `product:${string}`]: SectionList;                                        // ≤3 alternate product layouts
    [custom: `page:${string}`]: SectionList & { title: string; slug: string; seo: Seo }; // ≤10 custom pages
  };
  seo: { titleTemplate: string; description: string; ogImageAssetId?: string };
  embeds: { metaPixelId?: string; tiktokPixelId?: string; ga4Id?: string };        // off by default; platform-rendered under strict CSP
};
type SectionList = { order: SectionId[]; sections: Record<SectionId, SectionInstance> };   // map + order array (cheap reorder, readable diffs)
type SectionInstance = {
  type: string;            // registry key, e.g. 'hero.media'
  v: number;               // section schema version (migrations run on read)
  variant?: string;        // allowed list depends on template
  hidden: boolean;         // eye toggle; keeps data
  locked?: true;           // platform-set only
  visibility: { desktop: boolean; mobile: boolean };
  settings: Record<string, SettingValue>;
  blocks?: Record<BlockId, BlockInstance>; blockOrder?: BlockId[];
};
type BlockInstance = { type: string; hidden: boolean; settings: Record<string, SettingValue>;
  blocks?: Record<BlockId, BlockInstance>; blockOrder?: BlockId[] };               // children only on container blocks; depth ≤ 2
type ThemeTokens = {
  schemes: Partial<Record<'ink' | 'paper' | 'acid' | 'inverse' | 'bone',
    { bg: Hex; fg: Hex; muted: Hex; accent: Hex; accentFg: Hex; border: Hex }>>;   // role-based, generated from brand palette
  fontPair: FontPairId;    // curated list of ~12, self-hosted via next/font
  radius: 'none' | 'sm' | 'md'; density: 'compact' | 'regular' | 'airy'; motion: 'none' | 'subtle' | 'expressive';
  logo: { assetId: string; maxHeight: number }; faviconAssetId?: string;
};
```

Theme tokens compile to CSS variables (`--sf-bg`, `--sf-fg`, and so on) on the storefront root. Tailwind classes reference the variables only, never raw hex.

### 6.2 Constraints

| Limit | Value |
|---|---|
| Sections per page | Home 20, other pages 12 |
| Sections per group | 4, and only types that declare `allowedGroups` |
| Blocks per section | `maxBlocks` defaults to 12, absolute maximum 24 |
| Blocks per page | 150 |
| Nesting depth | 2: section, block, sub-block. Only container blocks such as `slides` or `columns` can have children |
| Alternate product layouts | 3 |
| Custom pages | 10 |
| Styles per template | 5 |
| Serialized config size | 256 KB |
| `product_list` / `collection_list` | 24 / 12 items |
| `range` | Integers only, at most 101 steps |
| Publish rate | 1 per 30 seconds per storefront |

- The UI shows remaining capacity ("14/20") and disables Add when a limit is reached, so a save never fails on a limit.
- The applier enforces structural invariants (`order` equals the set of section keys, no duplicates, no orphans), not only Zod, so a misbehaving client can never persist a broken draft.
- **No `custom_css`, no custom HTML, Liquid or script, no free font library, and no freeform positioning.**

### 6.3 Section registry (in code, not the database)

```ts
defineSection({
  type: 'hero.media', version: 2, name: 'Hero', category: 'hero', icon: 'image',
  allowedPages: ['home', 'collection', 'drop', 'about', 'page:*'], allowedGroups: [],
  templates: { editorial: { variants: ['full-bleed', 'split'] }, street: { variants: ['full-bleed', 'stacked'] },
               minimal: { variants: ['split'] }, studio: { variants: ['gallery'] } },
  limitPerPage: 2, maxBlocks: 2,
  blocks: { button: { limit: 2, settings: [/* label, link, style */] } },
  settings: [
    s.colorScheme('scheme', { kind: 'presentation' }),
    s.image('media', { kind: 'content', minPx: 1600 }),
    s.text('heading', { kind: 'content', maxLength: 60 }),
    s.range('overlay', { kind: 'presentation', min: 0, max: 80, step: 5, visibleIf: (v) => !!v.media }),
    s.select('height', { kind: 'presentation', options: ['medium', 'tall'], responsive: true }),
  ],
  presets: [{ id: 'drop-hero', name: 'Drop hero with countdown', category: 'drops', settings: {/*…*/}, blocks: [/*…*/] }],
  fallbackType: 'hero.split',                       // used on template switch
  migrations: { 1: (old) => ({ ...old, overlay: old.dim ?? 40 }) },
});
```

- **Setting types:**
  - `text` (maxLength), `textarea`, `richtext` (bold, italic, link and lists only, sanitized at render)
  - `number`, `range`, `select`, `segmented`, `toggle`
  - `color_scheme` (one of the template's schemes), `accent_color` (hex, contrast-gated), `font_pair`
  - `image` (`{assetId, focal, alt}`, from the moderated library, with a minimum resolution)
  - `video` (asset, or YouTube or Vimeo ID)
  - `link`: a discriminated union of product, collection, drop, page or url
  - `product`, `product_list` (IDs, or `{source:'collection', id, limit}`), `collection`, `collection_list`, `drop`, `alignment`

  Every setting carries `kind: content|presentation`, `default`, `visibleIf` (a typed predicate) and `responsive`. Responsive settings store `{base, mobile?}`.
- **Hidden conditional settings** keep their values and are skipped by publish validation.
- **v1 section catalog:**
  - Hero: `hero.media`, `hero.split`
  - Drops: `drop.countdown` (locked on the drop page), `drop.rail`
  - Product page: `product.main` (**locked**: price, variant picker, add to bag, shipping and returns, and the "Sold and shipped by" blocks can be reordered but not removed), `product.more_from_brand`
  - Listing: `collection.main` (locked on the collection page), `product.grid`, `collection.rail`
  - Story and media: `lookbook`, `story.text`, `media.image_pair`, `media.video`, `press.quotes`, `values.strip`, `faq`
  - Groups: `newsletter.brand` (per-brand consent capture), `announcement.bar`, `header.brand`, `footer.legal` (**locked**: returns policy, contact, marketplace attribution)
- **`@platform` blocks** that brands can place but cannot code: `notify_me`, `size_guide`, `shop_the_look`. `reviews` and `instagram_strip` are v2.
- **Templates:**
  - **Editorial:** magazine layout, large type, lookbooks.
  - **Minimal:** whitespace and grid-first; a light scheme is allowed.
  - **Street:** bold type, acid accents, drop-forward, dense.
  - **Studio:** gallery layout for art, design and objects; numbered editions; plated imagery.

  Each template defines its allowed schemes (4–6), variants, default page compositions and presets.

### 6.4 Validation layers (run on autosave and on publish)

1. **Structural.** Zod parse of the whole document: unknown types or keys rejected, the order and map invariant, limits, depth and size.
2. **Registry.** The section is allowed on this page or group and in this template, the variant is allowed, `limitPerPage` and per-block limits hold, and locked sections are present in their required positions.
3. **Referential** (publish only, one SQL round trip per type). Every product, collection and drop belongs to this brand and is not deleted or suspended. Every `assetId` is moderation-approved.
4. **Quality gates.** WCAG AA contrast: fg against bg at least 4.5:1, and accent against bg at least 3:1. Missing alt text is a warning.

Autosave accepts warnings and soft errors so work is never lost. Publish requires zero errors, and the issues panel offers "Go to section" for each one.

### 6.5 Operations, drafts, versions, publishing

- **Operations** (client to server, applied server-side, logged in `storefront_ops`):
  - `section.add`, `section.remove`, `section.move`, `section.duplicate`, `section.setHidden`, `section.setVisibility`, `section.setVariant`
  - `block.add`, `block.remove`, `block.move`, `block.setHidden`
  - `setting.set {path, value}`, `theme.set`
  - `template.switch {template, style}`, `page.create`, `page.delete`
- **Autosave** batches operations every 1.5 seconds with `expectedRevision`.
- **Undo** is a session-only stack of inverse operations.
- **Concurrency.** A revision mismatch returns 409 with the server's operations since that revision. Operations that don't conflict are rebased automatically. When the same path changed on both sides, the user sees "Ada changed Hero heading 1 min ago" with [Keep mine] or [Use theirs] for that path. There is never an option to overwrite everything.
- **Presence.** A Redis key `sf:presence:{storefrontId}` with a 30-second heartbeat drives avatars in the top bar.
- **The draft** is a single row. "Unpublished changes" is computed by comparing the draft hash with the published `config_hash`. Autosave **never** touches live.
- **Publish transaction** (Server Action into the service layer):
  1. `SELECT … FOR UPDATE` on the storefront row.
  2. Check `expectedRevision`.
  3. Run migrations and validation layers 1–4.
  4. Insert a `storefront_versions` row with `kind=publish`, `state=published`, `number = max + 1`.
  5. Mark the previous version `superseded`.
  6. Point `published_version_id` at the new version.
  7. Set the draft's `base_version_id`.
  8. Commit.
  9. After commit: `revalidateTag('storefront:'+id)`, and outbox jobs for OG image, sitemap, search metadata and analytics, with `jobId = versionId`.
- **Scheduled publish** is a native feature for every brand. Shopify keeps it behind Plus and Launchpad.
  - A BullMQ delayed job (`sf-sched:{versionId}`) re-validates the **snapshot** at fire time.
  - On failure (for example, the drop was cancelled or a product was suspended), live stays unchanged, the version is set to `failed`, and the brand is notified immediately.
  - Only one scheduled version is allowed per storefront.
  - "Match drop start" links the schedule to a drop, so rescheduling the drop moves the publish.
- **Checkpoints** are taken every 10 minutes of activity, and before any template switch, section delete or restore.
- **Restore** copies a version into the draft (checkpointing the current draft first). It is never applied to live directly. The UI states plainly that restoring a layout does not restore products, prices or drops.
- **Template switch.** Checkpoint first. Keep sections that the new template allows, mapping variants to the new template's defaults. Convert others through `fallbackType`, or remove them and list them in a "Removed sections" report that can be undone. Reset every `presentation` setting, keep every `content` setting, and keep the logo and accent where contrast allows.
- **Retention.** Publish versions are kept for at least 1 year and starred versions indefinitely. Checkpoints are kept for 30 days or the last 50, whichever is more. Admin actions (force-unpublish to a safe default, suspend, view or diff any version) are written to the audit log, and admin publishes carry `source='admin'`.
- **Rendering and caching.**
  - Live pages read `published_version_id`, then the version config. Versions are immutable, so they are cached indefinitely under the tag `sf-version:{id}`.
  - Product, price and stock data is fetched separately with a short cache, so a price change never needs a storefront publish.
  - Every historical published version must still render after each deploy. CI renders all of them.
- **Preview** lives at `/studio/preview/[storefrontId]?page=home`.
  - It uses the same React Server Components as live, `no-store`, and `X-Robots-Tag: noindex`.
  - Access is limited to brand members, or anyone with an HMAC share token (storefront ID and revision, 7-day expiry).
  - Sections and blocks are wrapped with `data-sf-section` and `data-sf-block` attributes.
  - A typed `postMessage` protocol connects editor and preview. Editor to iframe: `config:replace`, `config:patch`, `select`, `scroll-into-view`. Iframe to editor: `ready`, `hover`, `click`, `height`.
  - Presentational patches apply on the client. Patches that touch data trigger `router.refresh()`.
  - Motion components and countdowns must re-initialize on remount and pause while dragging.

### 6.6 Editor UX

- **Top bar:** storefront name, page switcher (Home, Product, Product:alt, Collection, Drop, About, custom pages, + New page), device toggle (Desktop 1440, Mobile 390, Full screen), undo and redo, autosave status ("Saved 3s ago" or "Offline, retrying"), Preview link, History, presence avatars, and a primary **Publish** split button with "Schedule publish…".
- **Left panel (320px):** a section tree in three groups: Header (announcement, header), the page, and Footer.
  - Each row has a drag handle (dnd-kit with keyboard support and aria-live announcements), a type icon, an auto-generated label, an eye toggle, desktop and mobile visibility icons, and a kebab menu (Duplicate, Rename, Move, Remove).
  - Locked rows show a lock icon and have no remove or hide action.
  - "+ Add block" is disabled at the limit, with a tooltip.
- **Right panel (340px):** settings grouped under Content, Layout, Style and Mobile. Each setting has info text and a reset-to-default link. Resource pickers are command palettes searching **only the brand's own catalog**. The image picker opens the brand media library with alt text and a focal-point editor.
- **Center:** the preview iframe.
  - Hovering a section outlines it and shows a floating label with quick actions.
  - Clicking selects the section in the tree. Selecting in the tree scrolls the preview to it.
  - Missing or suspended references show a dashed placeholder in preview and render nothing (or the section's fallback) on live. Live never shows an error.
- **Add section:** a modal (a Sheet on mobile) with a category rail (Hero, Products, Drops, Story, Media, Social proof, Platform) and preset cards rendered in the current template. Disallowed presets are hidden. Presets at their limit read "Already on this page".
- **Mobile mode** edits the `mobile` value of responsive controls. A "Mobile override" badge appears with an "Inherit from desktop" reset. Hidden-on-device sections are rendered with CSS, so the HTML stays the same for caching.
- **Theme tab:**
  - Template and style cards with a "Current vs New" side-by-side preview and a list of what will change.
  - A palette editor that generates schemes, with a live contrast ratio and AA pass or fail per pair. Failing pairs cannot be saved.
  - Font-pair specimens, and radius, density and motion controls.
- **Publish dialog:**
  - A change summary at the operation level ("Home: +1 section (Drop countdown), moved Lookbook up, 3 settings changed; Theme: accent changed").
  - The issues list, an optional label, and [Publish now] or [Schedule…].
  - Confirmation reads "Live · v14 · View storefront".
- **History drawer:** filters for Published, Checkpoints and Starred. Each entry offers Preview (read-only), Compare with draft, Star and Restore to draft. The live version and any pending schedule are marked.
- **Onboarding:** the template pick builds a prefilled draft from the brand's logo, hero image and first products. A 3-step coach mark follows: Reorder, Edit, Publish.

**Platform chrome is never editable.** It covers the platform bar (wordmark, search, bag, account), the Sponsored and badge systems, the Verified badge (rendered automatically), checkout, and the locked buy box. Storefront URLs are `/b/{handle}`, PDPs are `/b/{handle}/p/{product}`, and drops are `/d/{slug}`. Custom domains are v2.

---

## 7. Customer UX patterns to adopt

### 7.1 Visual system: dark editorial with restraint

- **Tokens** (Tailwind v4 `@theme`):

  | Token | Value | Use |
  |---|---|---|
  | `bg` | `#0A0A0B` | Base |
  | `surface-1` | `#121214` | Cards, panels |
  | `surface-2` | `#1A1A1E` | Popovers, drawers, sheets |
  | `surface-3` | `#232328` | Hover |
  | `text-primary` | `#EDEDED` | |
  | `text-secondary` | `#A1A1AA` | About 7.5:1 on bg |
  | `border` | `rgb(255 255 255 / .08)` | |

  - Never use `#71717A` for text under 18px, because it is about 4.1:1 and fails.
  - Depth comes from lighter surfaces, not shadows.
  - Use regular or medium weights at 12–14px.
  - Run a CI contrast test over all token pairs.
- **Liquid Glass** is for the functional layer only. This follows Apple's HIG.
  - **Allowed:** the scrolled header, the mobile tab bar, floating bag and quick-action pills, and the drop countdown chip or video controls over media.
  - **Banned:** cards, the PDP buy box, tables, filter panels, the bag body, checkout, all of Brand Studio and all of Admin.
  - **No glass on glass.** Menus that open from the glass header are solid `surface-2`.
  - **One component.** Glass is implemented only as `<GlassSurface variant='regular'|'clear'>`. A lint or grep check enforces that `backdrop-blur` appears nowhere else.
  - **Regular:** `rgb(14 14 16 / .62)`, blur 24px, saturate 160%, 1px white/8% border.
  - **Clear:** `/.18`, blur 12px, only over media, with a 35% black dimmer when `media.avg_luminance > 0.5`.
- **Fallbacks:**
  - `@supports not (backdrop-filter)`: solid `/.96`.
  - `prefers-reduced-transparency`: solid. Browser support is partial *(unverified)*, so also ship an in-app "Reduce transparency" setting stored in a cookie that SSR reads.
  - `prefers-contrast: more`: `#000` with a 50% white border.
  - `forced-colors`: Canvas and CanvasText.
  - Low-memory devices (`navigator.deviceMemory < 4`, a heuristic *(unverified)*): solid.
- **Glass chrome is monochrome.** At most one tinted control per view, applied as the fill of the primary CTA. Brand accent colours never tint marketplace glass.
- **Images.** White packshots render on a soft plate (`#E7E5E1`, object-contain, `brightness(.96)`). Lifestyle images go full-bleed with object-cover.
- **Motion** is used sparingly: fades and shared-element card-to-PDP transitions, behind `useReducedMotion()`. Under reduced motion, use opacity fades instead and countdowns tick without flip animation.
- **Touch targets** are at least 44×44.

### 7.2 Shell

- **Desktop header (64px):** wordmark, text navigation (Discover, Drops, Brands, Categories), then Search, Account and Bag(n).
  - It is transparent over the hero, with a 120px top scrim so white labels pass 4.5:1 over any brand hero.
  - Once an IntersectionObserver sentinel scrolls out, it becomes regular glass with a 24px scroll-edge mask.
  - Mega-menus are solid text columns plus one editorial image.
- **Mobile:** a 5-item bottom tab bar (Home, Drops, Search, Brands, Bag). It compacts to an icon pill after 64px of downward scroll and restores on upward scroll (disabled under reduced motion), with `env(safe-area-inset-bottom)` padding. All sheets use the vaul Drawer on solid surfaces.

### 7.3 Home

`home_modules` are curated in Admin per market. The default order is:
1. **Editorial story hero.** Full-bleed media (the video poster is the LCP image, loaded with `priority`), kicker, headline, dek, and "Read the story". Never sponsored.
2. **Drops rail:** Dropping soon and Live now, with countdown chips. Never sponsored.
3. **New from brands you follow** (signed-in users only).
4. A curated collection.
5. A brand spotlight.
6. **New on the platform:** the exploration rail for brands under 90 days old.
7. Category tiles.
8. **One** labelled Sponsored rail.
9. Journal teaser.

Stories are shoppable: embeds resolve price and stock live. Each story has its own indexable URL.

### 7.4 Brand directory and brand pages

- **`/brands`:** an A–Z and # jump bar, tiles (banner crop, logo, name, city and country, 1–2 value tags), and filters for category, country, values, new, and has a live drop.
- The featured strip at the top is labelled **"Featured"** when editorial or **"Sponsored"** when paid. It is never unlabelled.
- **Storefront header:** banner, logo, name, tagline, "Based in Lagos, NG · Founded 2019", verified value tags, a Follow button with follower count, and tabs Shop, Drops, Story and Policies.
- Inside a storefront, the brand's own product order is kept. Per-viewer ranking applies only on marketplace surfaces.

### 7.5 Product card

- **Image:** 4:5, plated or full-bleed. The second image swaps in on hover only under `@media (hover:hover)`.
- **Text:** brand name first (uppercase, 11–12px, tracking .04em), then a one-line product name, then the price (compare-at struck through when on sale).
- **Wishlist heart** in the top right.
- **No star ratings and no urgency stickers on cards.**
- **The Sponsored pill is mandatory** when the card is paid. It is part of the accessible name, separate from the status badge, and always in the same position.
- **At most one status badge:** Drop live or Dropping [date], then Sold out, then Low stock (3 or fewer), then New, then Sale.
- **Editor's Pick never appears on a Sponsored card.** If both apply on a surface, Sponsored wins and the pick is hidden.

### 7.6 PDP (the canonical PDP, rendered in the brand template with the locked buy box, and ad-free)

- **Desktop:** `grid-cols-[1.6fr_1fr]`. Image stack on the left with a zoom lightbox. A **solid** sticky buy box on the right.
- **Mobile:** a full-bleed scroll-snap gallery with a progress bar, and a sticky bottom bar ("₦X · Select size") that opens a size sheet and then becomes "Add to bag".
- **Buy box order:**
  1. Brand link and Follow.
  2. Title.
  3. Price, with "Duties and taxes calculated at checkout".
  4. Size radiogroup. Sold-out sizes use `aria-disabled` plus the text "Sold out" and offer Notify me. "Size guide" sits next to it.
  5. Add to bag (disabled until a size is chosen) and Wishlist.
  6. "Sold and shipped by {Brand} · Ships from {City, Country}".
  7. "Estimated delivery {range} to {country}", computed from processing days plus zone transit.
  8. Returns summary.
  9. Accordions: Details, Materials & care, Size & fit, Shipping & returns.

  Below the buy box: a brand story card, More from {Brand}, Featured in, and You may also like. All of it is organic.
- **Size guide drawer:**
  - Fit note and fit-scale bar, model info, and a cm/in toggle.
  - An **HTML table** (never an image) with the selected size's row highlighted.
  - A "How to measure" figure, and a footwear conversion tab (EU, US M, US W, UK, JP cm).

### 7.7 Bag, checkout, confirmation

- **Bag drawer** (420px right sheet on desktop, full screen on mobile):
  - Grouped by brand, each group showing logo, "Ships from", processing time, brand subtotal, a shipping estimate, a free-shipping nudge ("Add ₦4,000 more from Brand X for free shipping"), and timers on drop items.
  - "Ships separately from N brands".
  - One "Checkout" button. Each line has Save for later.
  - No ads.
- **Cart page:** the same grouping plus "Checkout this brand only". Brands that cannot ship to the address appear in an "Unavailable for your address" section with the reason. All per-brand constraints are validated **before** the Pay button.
- **Checkout:** one page, logo only, with no marketplace navigation or ads. Guest checkout is allowed for catalog items.
  1. Contact (email, phone defaulting to +234).
  2. Delivery address (Nigerian state and LGA dropdowns, landmark, postcode optional).
  3. "Shipping from {Brand}", with one rate radio group and ETA **per brand**.
  4. Payment: one block through the provider (card, bank transfer, USSD).
  5. Summary grouped by brand, collapsible on mobile.

  Drop lines show "Held for 04:59". An "Items no longer available" interstitial lets the buyer remove sold-out lines and continue.
- **Confirmation:** one group number plus one entry per brand order, each with its own number, status and expected delivery.
  - Email: one umbrella receipt, then per-brand shipping updates.
  - Order page: a per-brand status stepper (Confirmed, Shipped with tracking, Out for delivery, Delivered), a per-brand "Request return" within the window, and per-brand refund chips.

### 7.8 Search and filters

- **Facets:**
  - Category tree, Brand (searchable multi-select)
  - Size (normalized per category), Colour family, Price (buyer currency)
  - Ships to my country (**on by default**), Ships from, Delivery by
  - On sale, New in (7 or 30 days), Drops (upcoming, live, restocked)
  - Brand values, Made in, In stock only (**on by default**), Top Rated
- **Sorts:** Recommended (default), Newest, Price ascending, Price descending.
- **State:** filters and sort live in URL parameters. Applied-filter chips with "Clear all" sit above the grid.
- **Desktop:** left filter rail. **Mobile:** a sticky bottom "Filter & Sort" bar that opens a full-height sheet with live counts and "Show N results".
- **Pagination:** "Load more" with `?page=N` and scroll restoration. No unbounded infinite scroll.
- **Save search** with frequency instant, daily or weekly.
- **Grid density:** 2 or 4 columns on desktop, 2 or 1 on mobile, remembered in `localStorage`. Editorial tiles appear every 12–16 items on category pages, never in search results.
- **Organic ranking:** `relevance × quality × (1 + freshness) + exploration`.
  - Freshness decays from 0.3 to 0 over 14 days from `first_published_at` and never resets.
  - Launch boost lasts 30 days from approval once the checklist is complete.
  - Exploration takes 10% of category-grid positions plus the New-on-platform rail, using Thompson sampling on CTR and add-to-bag.
  - The ranking service **never reads ad tables**, enforced by a module boundary and a lint rule.
- **Transparency (DSA Art. 27 readiness):** a "How ranking works" page and a "Personalize my recommendations" toggle.
- **Engine:** Postgres (tsvector, pg_trgm, `search_documents`) behind a `SearchIndex` interface. Move to Typesense or Meilisearch at about 200k documents or a facet p95 above 300ms *(our threshold)*.

### 7.9 Following, wishlist, alerts

- **Follow button:** Follow, then Following with a tick and a dropdown of notification types (New pieces, Drops, Sales). Signed-out users get a sign-in sheet that returns them to the same state.
- **Updates feed** (behind the bell): grouped cards ("{Brand} added 6 new pieces", with a 3-image strip), drop reminders, wishlist price drops, back-in-stock alerts and unread dots.
- **Channels:**
  - In-app is always on.
  - Email, push and WhatsApp require marketing consent and per-category opt-in, and respect quiet hours. WhatsApp is the priority channel in Nigeria *(our assumption)*.
  - Following a brand opts into a weekly digest, not every reminder.
- **Wishlist:** a price-drop alert fires when the price falls at least 10% below the price when saved. Back-in-stock alerts are per variant.

### 7.10 Drops UX

- **`/drops` calendar:**
  - Tabs: Upcoming, Live now, Past.
  - A day-grouped list with filters for category, brand, release type and "ships to me".
  - A "My drops" view: subscribed, entered, won, held.
  - A per-customer ICS feed plus per-drop `.ics` files.
  - A Thursday and Saturday "Drop Day" hero on Home.
- **Drop card time label:**
  - More than 7 days away: "Thu 20 Nov"
  - Under 7 days: "Thu 11:00"
  - Under 24 hours: an `hh:mm:ss` countdown
  - Live: "Live now"
  - Over: "Sold out" or "Ended"
- **Before launch:**
  - Countdown in local time plus the brand's zone ("11:00 WAT · 10:00 GMT · 05:00 ET").
  - Notify me with a channel picker, and Add to calendar.
  - The size grid is shown but disabled.
  - FAQs cover limits, release type and eligible countries.
- **Final 60 seconds:** the button reads "Starting…" until the server says the drop is live. When the queue is enabled, the button reads "Join queue" from `queue_opens_at`, with the copy "Everyone in line before 11:00 gets a random place, so there's no need to refresh."
- **Queue screen:** position or "You're in, waiting for start", an ETA range, a stock level ("Plenty" or "Going fast"), "Don't close this tab", web push on admission, and an immediate sold-out exit.
- **Live, first come first served:** Buy now (express single-drop checkout) and Add to bag. A persistent "Held for you 09:58" bar appears, turning amber at 2:00, with a one-time +5 minutes when payment starts. On expiry, the toast reads "Your hold expired. Check if it's still available."
- **All reserved:** "Everything is in someone's bag right now. Unpaid holds expire within 10 minutes, so stay here and we'll update automatically." The page updates over SSE. This state is never shown as a hard Sold out.
- **Sold out:** "Sold out in 3m 12s", Join restock list (offers a personal 30-minute hold if units free up), Follow, and Upcoming drops.
- **Draw:**
  1. Enter draw: size, saved address, saved card, terms.
  2. Confirmation: "You're in. Results by Fri 18:00 WAT."
  3. Withdraw is available until entries close.
  4. Results: "You got it" or "Pay by {deadline}", or "Not this time" with a link to the next drop.
  - Entry is free, and only winners pay.
  - The draw uses a seeded CSPRNG Fisher–Yates shuffle per size bucket, with a commit-reveal seed.
  - Duplicate identities are disqualified before the draw.
- **Draw payment:**
  - If the provider supports preauthorization and results land within the hold limit minus one day (Paystack defaults to 5 days, Flutterwave 7; both need support enablement), preauthorize at entry, capture for winners and release for everyone else.
  - Otherwise, save a reusable card authorization and charge on win, with a 24-hour purchase window. Alternates are promoted when a winner fails.
- **Archive page:** the same URL forever, indexable. It shows the story, lookbook, release facts, a Sold out or Ended stamp, and "Next drop from {Brand}".
- **Truthful scarcity only.** "Only {n} left" when there are 3 or fewer, "Sold out in {x} min", and "Back in stock". No "in X carts" counters. Countdowns always map to a real `starts_at` or `ends_at`. Exact counts appear only when the brand opts in for numbered editions ("12 of 50 left").

---

## 8. Advertising rules

**Model (Decision):** fixed-price, booked placements of **extra** inventory. No CPC auctions, no keyword bidding, and **never** a percentage-of-sale ad fee. Commission stays a flat 5% whether a sale was organic or ad-attributed. This goes on the public "How fees work" page.

### 8.1 v1 rate card

Prices are per market, set and versioned in Admin, and published before booking.

| Key | Surface and position | Inventory | Unit |
|---|---|---|---|
| `home_featured_brand_rail` | The single home Sponsored rail, at position 3 or lower | 4 positions | Week |
| `category_spotlight` | Category grid slots | 2 per category | Week |
| `search_category_tile` | Search results within a category | 2 per category | Week |
| `drops_featured` | Drops page plus calendar highlight | 1 | Day |
| `brand_directory_feature` | Directory featured strip | 3 | Week |

- **Fairness:** at most one concurrent booking per brand per placement, at most 2 weeks of the same placement per month, and booking at most 60 days ahead.
- **Impression estimates** are shown as a range from the last 4 weeks of traffic, labelled "estimate, not guaranteed".
- **Double booking** is prevented by the Postgres EXCLUDE constraint plus 30-minute holds.

### 8.2 Slot positions, density and frequency (unit-tested `ad_rules` config)

- **Home:** at most one sponsored module, never at position 1 or 2.
- **Category and search grid (24 per page):**
  - Sponsored only at positions **5 and 14** (on mobile, after row 2), at most 2 per page, never in positions 1–4, and at most one per brand per page.
  - In longer grids, the ratio stays at or below 1 sponsored per 8 results.
- **Relevance and eligibility.** The sponsored product must match the active category, filters and in-stock state. Otherwise the slot is **backfilled organically**. A product is suppressed automatically if it is out of stock, unpublished, policy-flagged or a filter mismatch. Reports show eligible minutes.
- **Dedupe.** The same product never appears both sponsored and organic on one page; the organic position is shown instead.
- **Frequency cap:** at most 3 impressions per viewer per campaign per day, tracked in Redis as `fc:{viewer}:{campaign}:{yyyymmdd}`. "Hide this ad" suppresses that campaign for 7 days.
- **Ad-free zones:** brand storefronts, PDPs, the bag, checkout, order and account pages, Journal and stories, Editor's Picks, Trending and New-drops feeds, and **navigational searches for a brand's name**. Competitors are never shown above a brand's own name search.
- **Eligibility:** approved for at least 14 days, at least 1 fulfilled order, no open disputes, not suspended.
- **Monitoring.** An Admin "Ad load monitor" shows actual sponsored share per surface against the cap over 24 hours and 7 days, with alerts. A per-placement **kill switch** (a Redis flag) stops delivery without cancelling bookings.

### 8.3 Labelling (FTC native-ads guidance, EU DSA Art. 26)

- **The word "Sponsored".** No icon-only badges and no "Featured" or "Promoted" euphemisms.
- **Rendering:** server-rendered in the initial HTML, at least 12px, at least 4.5:1 contrast, a fixed position above the brand name, and part of the accessible name ("Sponsored: {Brand} {Product}"). A visual-regression test guards it.
- **"About this ad" popover** (solid, never glass on glass): advertiser legal name, placement, dates, and "Shown because this brand booked {placement} for {category} in {market}. Not based on your personal data." This statement is true in v1 because there is no targeting. Plus Hide this ad and a policy link.
- **Record keeping.** `advertiser_legal_name` and `paid_by` are stored at booking. Admin can export every creative that ran, for a future ad repository.
- **Separation from curation.** Paid "Sponsored", unpaid "Editor's Pick" and opt-in "Event" badges are visually and semantically distinct. A paid booking never influences picks; the Admin UI shows an audit note if a picker selects a brand with an active booking.

### 8.4 Review flow

1. **Brand "Promote" flow:**
   1. Placement card (price, example of where it appears, estimate).
   2. Market, category and dates on an availability calendar ("2 of 4 left").
   3. What to promote: product, drop or storefront.
   4. Creative editor, previewed with the real `ProductCard` and `SponsoredBadge` components.
   5. Review and pay (price, 7.5% VAT for Nigeria, invoice, refund policy).
   6. Status timeline.
2. **Admin ads review queue:**
   - Sorted by `starts_at`, with SLA chips ("Urgent" under 48 hours).
   - In-context preview on the dark grid and on mobile.
   - Destination checks: in stock, price matches, published.
   - Brand risk summary.
   - Reason codes: `image_quality`, `misleading_claim`, `prohibited_item`, `ip_or_counterfeit_risk`, `text_overlay_excessive`, `destination_mismatch`, `price_or_stock_mismatch`, `not_age_appropriate`.
   - Actions: Approve, Request changes, Reject. Campaigns above a price threshold need a second approver.
3. **Creatives** are immutable versions. Delivery always serves the latest approved version. Destinations are internal only.
4. **Money:**
   - The purchase posts to deferred revenue, which is recognized daily.
   - Rejection, or no fix by `starts_at − 24h`, gives a full refund.
   - The brand can cancel for a full refund until 72 hours before start.
   - Platform-caused downtime or pausing over 20% of the window triggers an automatic make-good credit.

### 8.5 Honest measurement and attribution

- **Viewable impression:** at least 50% of pixels in view for at least 1 continuous second, measured by IntersectionObserver.
- **Clicks** go through a signed token `?spt={campaign, placement, position, ts}`, are recorded server-side, bot-flagged, and set a first-party `sp_last` cookie for 7 days.
- **Attribution model:** **last sponsored click, 7-day click-through, scoped to the advertised brand's merchant order.** Not the checkout group. At most one campaign is credited per order. No view-through sales.
- **Reporting:**
  - "Same product" and "Other products from your brand" are separate columns, never summed.
  - "New customers to your brand (12 months)" is shown.
  - Attribution is `provisional` until the return window closes, then `final`, or `reversed` or `partially_reversed` when refunds happen.
  - The report shows the brand's organic sales for the same period as context.
- **Attribution never changes what the brand pays or the commission.**
- **Isolation.** Sponsored clicks are excluded from organic ranking and personalization features.

---

## 9. Where incumbents are weak and how we do better

| Incumbent | Weakness | Our answer |
|---|---|---|
| Shopify themes | Saving in the live theme publishes immediately. The only "draft" is a duplicated theme. JSON templates and settings have no version history. Scheduled publishing is Plus- and Launchpad-only. A whole-document "content override" dialog forces someone to lose work, sometimes falsely | A per-storefront draft, immutable versions, automatic checkpoints and restore-to-draft. Scheduled publish for every brand, linked to drops. Operation-level rebase plus presence |
| Shopify commerce | No hold before checkout submit. Offsite gateway redirects open an oversell window. Bot Protection is Plus-only and needs support to enable. The customer model is single-merchant | Holds at add-to-bag for drops, a Postgres-authoritative conditional decrement and a defined late-payment path. A built-in waiting room and Turnstile for every brand. Platform-wide accounts with a brand-scoped projection and per-brand consent |
| WooCommerce | One overloaded status, any-to-any transitions from a dropdown. Stock changes are side effects of status hooks (double decrements, missing restocks). WP-cron hold expiry cancels paid orders. Variation UX degrades above 30, and "Any" wildcards cause ambiguity | Orthogonal derived axes and transition tables. Explicit idempotent inventory commands. Expiry correct by query and lazy reclaim. A capped, concrete variant matrix sent to the client in one payload |
| Dokan, WCFM (orders) | Sub-orders are full orders: duplicate emails, inflated analytics, automations firing per sub-order. The parent status is editable and can contradict its children. Vendors see sub-order numbers customers don't recognise | The checkout group is not an order. Display status is derived. Numbering is hierarchical (`MK-…-02`) and searchable by either number. Notifications are deduped with audience rules |
| Dokan, WCFM (money) | Mutable balance tables that need "rebuild" tools and SQL fixes. Payouts are mostly manual, and African gateways are not first-class *(unverified)*. Marketplace coupons silently cut vendor earnings (before Dokan 4.0). Vendors absorb refund shipping and tax, or the admin loses commission (GitHub #2267). Only one pending refund per order. A per-unit "fixed" fee bug. A COD reverse-withdrawal CVE where the client-submitted amount was trusted | An immutable ledger with balances as sums. A provider abstraction with splits or Transfers and scheduled payouts. Every promotion declares its funding. Proportional commission reversal. Multiple partial refunds under a row lock. Fixed fees at most once per order. Amounts trusted only from the provider's verify API |
| Dokan (store and verification) | A banner, a logo and 4 global header templates. Manual document review, not tied to payout eligibility. The badge only shows if an admin adds a widget | Four brand-selectable templates with typed sections and versioning. KYC requirements tied to capabilities, with Nigerian identity checks *(provider unverified)* and bank name matching. The badge renders automatically |
| Etsy | Mandatory 12–15% Offsite Ads fee. Opaque, platform-set CPC bids. A 30-day attribution window. "In X carts" urgency nudges. Picks badges vanish without explanation. Free shipping used as a ranking stick | No percentage-of-sale ad fees. Fixed published prices. 7-day click attribution net of refunds. Truthful scarcity only. Badge start and end notices with criteria. Ranking factors explained in Brand Studio and phased in |
| Amazon | Ad labels small, low-contrast or lazy-loaded (2021 FTC complaint). High ad load. Competitor ads on detail pages | SSR "Sponsored" label with contrast and regression tests. Hard density caps with a monitor and kill switch. Ad-free PDPs and storefronts. No conquesting on a brand's own surfaces |
| Farfetch, SSENSE | A silent 100-item wishlist cap *(anecdotal)*. Brand pages can be thin | A soft cap of 500 with a warning. Brand pages led by story, values and provenance |
| SNKRS, END. | Exclusive Access selection is opaque. Some raffles reportedly pre-charge all entrants (END., *unverified*) | Disclosed eligibility. Commit-reveal draws with an Admin audit view. Free entry, with preauthorization or charge-on-win |
| Squarespace, Webflow, Wix, Big Cartel | No staging (Squarespace). Freeform layouts produce messy, inaccessible stores. Code edits don't survive a theme switch (Big Cartel). Restores don't restore commerce data (Wix) | Constrained typed sections with section variants. No code. Template switches keep content settings. The UI says explicitly that a restore affects layout only |

---

## 10. Risks and open decisions for the product owner

### 10.1 Decisions needed (with our recommendation)

| # | Decision | Recommendation | Needed by |
|---|---|---|---|
| 1 | **Settlement mode and licensing.** The CBN may restrict holding customer funds to licensed money operators *(unverified)* | Launch with `split_at_charge` through Paystack multi-split (flat shares, `bearer_type=account`). Allow `collect_then_transfer` only with a written opinion from Nigerian fintech counsel. The ledger is identical either way | Before payments build (week 0) |
| 2 | **Paystack account capabilities** | Confirm with the account manager: WEEKLY or MANUAL subaccount settlement, maximum subaccounts per split, card preauthorization enablement, refund idempotency, `percentage_charge` semantics. If MANUAL settlement is refused, holds and reserves cannot be enforced in split mode. Then either accept the risk (refund float plus receivable holdback) or pursue the licensed route | Week 0 |
| 3 | **Commission on refunds** | Reverse commission pro rata on every refund. This is fair, builds trust, and avoids Dokan's failure modes | Pricing page |
| 4 | **Provider fees** | The platform absorbs all provider fees at launch ("5%, nothing else"). Revisit if international cards exceed about 15% of GMV, because a 3.9% fee leaves about a 1% margin *(heuristic)* | Pricing page |
| 5 | **VAT** on commission and ad fees, and marketplace-facilitator VAT on goods | Quote "5% + VAT on our fee". Tax counsel confirms whether the brand or the platform is the seller of record for goods VAT | Before launch |
| 6 | **Launch geography and currency** | NGN-only checkout and settlement in v1 (one currency per checkout group). The schema is multi-currency ready. FX quotes and cross-border brands are v2 | Now |
| 7 | **Return policy floor** | Brands set their own policy. Platform minimum: 7 days for not-as-described, defective or wrong item. Change-of-mind returns are optional per brand | Before brand onboarding |
| 8 | **Brand-referred orders** (a Faire Direct analogue) | Yes, in v1.1: 3% commission on orders through the brand's tracked link (30-day cookie), after fraud controls. Snapshot it at order creation | v1.1 |
| 9 | **Cash on delivery** | Not at launch. The ledger supports it later through `merchant_receivable` netting | Revisit after 3 months |
| 10 | **Draw legality** (National Lottery Act 2005, *unverified*) | Free entry, payment only on selection. Counsel reviews before the first draw | Before the first draw |
| 11 | **ARCON pre-vetting of advertisements** (scope *unverified*) | Counsel opinion before launching paid creatives. Product-only sponsored cards may be launched first | Before ads launch |
| 12 | **Rate card prices** | Product owner sets them per placement and market, published publicly | Before ads launch |
| 13 | **Counterfeit and IP risk** (sneakers, luxury) | A `brand_authenticity` verification requirement for high-risk categories, trademark-keyword flags in review, a takedown flow, and a product-level "Verified" badge in v2 | Before launch |
| 14 | **Guest checkout** | Allowed for catalog items. Drops require an account with verified email, plus phone under `strict` | Now |
| 15 | **Brands per checkout** | Cap at 10 until Paystack's split recipient limit is confirmed | Now |
| 16 | **Hold and reserve tiers** | Values as in §4.7. Finance can tune them | Before launch |
| 17 | **Identity and value tags** (Black-owned, women-owned and so on) | Hidden until an admin verifies them. A documented evidence standard | Before the directory launches |

### 10.2 Top risks

- **Regulatory.** Holding funds, VAT, lottery and advertising rules. Mitigated by decisions 1, 5, 10 and 11, and a settlement-mode-agnostic ledger.
- **Single payment rail.** Build the Flutterwave adapter in v1 behind the same interface as a failover.
- **Thin margin.** On international cards, and on small orders with the ₦100 fixed fee. Monitor `processing_fees ÷ commission_revenue` daily.
- **Drop-day load, bots and contention.** k6 load tests at 10× peak, a stock-aware waiting room, at most 3 hot drops per slot, and a kill switch.
- **Chargebacks on hype items, and late payments.** Proof-of-delivery capture, the 16-hour dispute workflow, drop holds and the late-payment policy.
- **Payout fraud through bank-detail takeover.** Re-authentication, name matching, email confirmation and a 48-hour cooldown.
- **Quality dilution from free registration.** The review gate, discovery tiers with quality score at least 70 for editorial modules, and upload constraints.
- **Ad load creep.** Hard caps in tested config, the monitor, and the policy commitment in §8.
- **Metric distrust.** A single analytics module, formulas shown in the UI, and refund-date booking that reconciles to the ledger.
- **Data protection** (NDPA 2023 and NDPR; GDPR and UK later). Per-brand consent, data subject export and delete, and DSA Art. 26 and 27 readiness built in.

### 10.3 Unverified facts to confirm before coding against them

- **Paystack:**
  - Meaning of `percentage_charge`.
  - `settlement_schedule` values and MANUAL approval.
  - Maximum subaccounts per split.
  - Refund idempotency.
  - Whether fees are returned on refunds.
  - Refunds on settled splits drawn from the main balance.
  - Dispute evidence field names and `due_at`.
  - The 72-hour webhook retry schedule, and whether payloads carry a stable event ID.
  - `charge.failed` existence.
  - Transfer status values.
  - 7.5% VAT on fees and ₦50 stamp duty.
  - Unit handling for XOF.
  - The authorization `signature` as a card fingerprint.
- **Flutterwave:** the v4 `flutterwave-signature` HMAC, webhook event names, idempotency headers, and mobile-money coverage.
- **Stripe:** whether a Nigerian platform entity is supported (third-party sources say no). **Adyen:** split type names and onboarding thresholds.
- **Regulatory:** CBN framework applicability, ARCON scope, National Lottery Act. US money-transmission rules were not researched.
- **Shopify details.** Do not treat these as parity requirements:
  - `OrderCancelReason` values beyond CUSTOMER, FulfillmentOrder `requestStatus` values, hold reasons, and `changeFromQuantity` semantics.
  - The 60-condition cap on smart collections, Combined Listings plan eligibility, and the exact AOV and returning-customer formulas.
  - Range of at most 101 steps, the preset `category` key, section-group limits, a 512 KB template limit, the 50-item list cap, combining `enabled_on` and `disabled_on`, and the full editor event list.
  - The checkout hold duration ("several minutes").
- **Marketplace:** Etsy recency-boost duration, Star Seller thresholds, and ad label wording. END. pre-charging. The Farfetch 100-item cap. Depop boost fees. The PayPal 10-shop limit.
- **Drops:** SNKRS draw window lengths, Cloudflare Waiting Room plan availability, the Postgres per-variant contention ceiling, and WhatsApp as the priority channel.
- **UX:** browser support for `prefers-reduced-transparency`, the `deviceMemory` heuristic, and the brand-site patterns (ALD, Kith, Acne and others), which come from memory.

---

## 11. Sources

### Shopify: commerce model, admin UX, analytics
- [Variant limit is now 2048 (dev changelog)](https://shopify.dev/changelog/the-product-variant-limit-is-now-2048-for-all-merchants)
- [We've increased the product variant limit to 2048 (changelog)](https://changelog.shopify.com/posts/we-ve-increased-the-product-variant-limit-to-2048)
- [Shopify blog: 2048 variants](https://www.shopify.com/blog/2048-variants)
- [Community: 4+ product options (3-option cap, Combined Listings)](https://community.shopify.dev/t/4-product-option/34014)
- [Shopify limits 2026 (third-party)](https://craftshift.com/shopify-limits-2026-complete-guide/)
- [ProductStatus enum](https://shopify.dev/docs/api/admin-graphql/latest/enums/ProductStatus)
- [ResourcePublicationConnection](https://shopify.dev/docs/api/admin-graphql/latest/connections/ResourcePublicationConnection)
- [Inventory states (Help Center)](https://help.shopify.com/en/manual/products/inventory/managing-inventory-quantities/inventory-states)
- [Apps in inventory management](https://shopify.dev/docs/apps/build/inventory-management-apps)
- [InventoryAdjustQuantitiesInput](https://shopify.dev/docs/api/admin-graphql/2024-01/input-objects/InventoryAdjustQuantitiesInput)
- [CData: inventoryAdjustQuantities reference](https://cdn.cdata.com/help/FON/py/pg_GRAPHQL202601sp-inventoryadjustquantities.htm)
- [High View Apps: inventory adjustment reasons](https://www.highviewapps.com/kb/ez-inventory-shopify-inventory-adjustment-reasons/)
- [ShopifyQL inventory_adjustment_history](https://shopify.dev/docs/api/shopifyql/latest/schemas/inventory/inventory_adjustment_history)
- [CollectionRuleConditions](https://shopify.dev/docs/api/admin-graphql/latest/objects/CollectionRuleConditions)
- [CollectionRuleRelation](https://shopify.dev/docs/api/admin-graphql/latest/enums/CollectionRuleRelation)
- [SmartCollection (REST)](https://shopify-dev.shopifycloud.com/docs/api/admin-rest/latest/resources/smartcollection)
- [Automated collections with metafields](https://shopify.dev/docs/apps/custom-data/metafields/definitions/automated-collections)
- [OrderDisplayFinancialStatus](https://shopify.dev/docs/api/admin-graphql/unstable/enums/OrderDisplayFinancialStatus)
- [OrderDisplayFulfillmentStatus](https://shopify.dev/docs/api/admin-graphql/latest/enums/OrderDisplayFulfillmentStatus)
- [Customer API OrderFinancialStatus](https://shopify.dev/docs/api/customer/latest/enums/orderfinancialstatus)
- [FulfillmentOrderStatus](https://shopify.dev/docs/api/admin-graphql/latest/enums/FulfillmentOrderStatus)
- [Fulfillment object](https://shopify.dev/docs/api/admin-graphql/latest/objects/Fulfillment)
- [Fulfilling orders individually](https://help.shopify.com/en/manual/fulfillment/fulfilling-orders/single-fulfillment)
- [orderCancel mutation](https://shopify.dev/docs/api/admin-graphql/unstable/mutations/orderCancel)
- [RefundLineItemRestockType](https://shopify.dev/docs/api/admin-graphql/latest/enums/refundlineitemrestocktype)
- [Refund resource (REST 2025-04)](https://shopify.dev/docs/api/admin-rest/2025-04/resources/refund)
- [ReturnStatus](https://shopify.dev/docs/api/admin-graphql/latest/enums/ReturnStatus.md)
- [Shopify Engineering: Scaling inventory reservations](https://shopify.engineering/scaling-inventory-reservations)
- [Selling out of stock products](https://help.shopify.com/en/manual/products/inventory/getting-started-with-inventory/selling-when-out-of-stock)
- [Community: oversell for 1-qty items after payment](https://community.shopify.com/t/help-over-sell-double-sell-for-1-qty-items-after-payment-no-reserve-hold-for-1-qty-race-cond/135828)
- [One-page checkout](https://help.shopify.com/en/manual/checkout-settings/one-page-checkout)
- [One-page checkout is now the default](https://changelog.shopify.com/posts/one-page-checkout-is-now-the-default-shopify-checkout)
- [Choose between one-page and three-page checkout](https://changelog.shopify.com/posts/all-merchants-can-now-choose-between-the-one-page-checkout-and-three-page-checkout-1)
- [Customer segment reference guide](https://help.shopify.com/en/manual/customers/customer-segmentation/reference-guide)
- [Shopify-based segment filters](https://help.shopify.com/manual/customers/customer-segmentation/reference-guide/shopify-segments)
- [Segment query language reference](https://shopify.dev/docs/apps/build/shopifyql/segment-query-language-reference.md)
- [Acquisition reports (sessions definition)](https://help.shopify.com/manual/reports-and-analytics/shopify-reports/report-types/traffic)
- [Community: returning customer rate](https://community.shopify.com/t/how-is-the-returning-customer-rate-calculated-in-analytics/217973)
- [Polar Analytics: Shopify analytics guide](https://www.polaranalytics.com/post/shopify-analytics-guide)
- [Mipler: net vs gross sales](https://mipler.com/blog/net-sales-and-gross-sales-in-shopify/)
- [ShopifyQL sales schema](https://shopify.dev/docs/api/shopifyql/2026-01/schemas/sales_revenue/sales)
- [Polaris: Index table](https://polaris.shopify.com/components/index-table)
- [App Home: index page pattern](https://shopify.dev/docs/api/app-home/patterns/templates/index)
- [Polaris: Empty state](https://polaris.shopify.com/components/empty-state)
- [Polaris: Contextual save bar](https://polaris.shopify.com/components/contextual-save-bar)
- [Migrate ContextualSaveBar to Save Bar API](https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react/contextual-save-bar.md)
- [App Bridge Save Bar API](https://shopify.dev/docs/api/app-bridge-library/apis/contextual-save-bar)
- [Shopify Help Center manual (setup guide)](https://help.shopify.com/en/manual)
- [Protecting your store from bots](https://help.shopify.com/en/manual/checkout-settings/bot-protection)
- [Cart and checkout validation](https://shopify.dev/docs/apps/checkout/validation)
- [Launchpad (App Store)](https://apps.shopify.com/launchpad)
- [Launchpad options](https://help.shopify.com/manual/apps/apps-by-shopify/launchpad/launchpad-options)
- [Plus: campaigns and flash sales](https://www.shopify.com/in/plus/solutions/ecommerce-campaigns-flash-sale-automation)
- [Limit: Purchase Order Quantity](https://apps.shopify.com/quantity-limit)
- [Back In Stock Alert Notify Me](https://apps.shopify.com/back-in-stock-alert-notify-me-sb)
- [CrowdHandler Waiting Room (App Store)](https://apps.shopify.com/crowdhandler-waiting-room)

### Shopify themes and site builders
- [JSON templates](https://shopify.dev/docs/storefronts/themes/architecture/templates/json-templates)
- [Theme limits](https://shopify.dev/docs/storefronts/themes/architecture/limits)
- [Section schema](https://shopify.dev/docs/storefronts/themes/architecture/sections/section-schema)
- [Input settings](https://shopify.dev/docs/storefronts/themes/architecture/settings)
- [Conditional settings (visible_if)](https://shopify.dev/changelog/conditional-settings-in-the-theme-editor)
- [Deprecated settings](https://shopify.dev/docs/storefronts/themes/architecture/settings/deprecated-settings)
- [Color palettes changelog](https://shopify.dev/changelog/color-palettes)
- [Community: color_palette vs color_scheme_group](https://community.shopify.dev/t/color-palette-vs-color-scheme-group-intended-end-state-per-element-theming-and-whats-next/35453)
- [Section groups](https://shopify.dev/docs/storefronts/themes/architecture/section-groups)
- [Partners blog: Section groups](https://shopify.com/partners/blog/section-groups)
- [Static blocks](https://shopify.dev/storefronts/themes/architecture/blocks/theme-blocks/static-blocks)
- [Community: nested blocks depth](https://community.shopify.dev/t/nested-blocks-depth-limit/35499)
- [App blocks](https://shopify.dev/docs/storefronts/themes/architecture/blocks/app-blocks)
- [Theme app extensions configuration](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration)
- [settings_data.json](https://shopify.dev/docs/storefronts/themes/architecture/config/settings-data-json)
- [Style settings](https://shopify.dev/docs/storefronts/themes/architecture/settings/style-settings)
- [Integrate sections and blocks with the editor](https://shopify.dev/docs/storefronts/themes/best-practices/editor/integrate-sections-and-blocks)
- [Community: device-specific settings](https://community.shopify.dev/t/device-specific-settings/37344)
- [ThemeRole enum](https://shopify.dev/docs/api/admin-graphql/latest/enums/themerole)
- [Theme resource (REST, 20-theme limit)](https://shopify.dev/docs/api/admin-rest/latest/resources/theme)
- [Alternate templates](https://shopify.dev/docs/storefronts/themes/architecture/templates/alternate-templates)
- [Help: code editor](https://help.shopify.com/docs/themes/tools/code-editor)
- [Help: editing theme code (older versions)](https://help.shopify.com/en/manual/online-store/themes/theme-code/edit-theme-code)
- [Community: simultaneous theme editing](https://community.shopify.com/t/can-users-make-changes-on-a-theme-simultaneously/334656)
- [Community: editor wrongly reports another user editing](https://community.shopify.dev/t/theme-editor-incorrectly-reports-another-user-is-editing-the-theme/35848)
- [GitHub integration for themes](https://shopify.dev/docs/storefronts/themes/tools/github)
- [Featurebase help: editing your theme (third-party)](https://ourselves.featurebase.app/help/articles/2327036-editing-your-theme)
- [Community: range input supports integers only](https://community.shopify.com/t/settings-schema-range-input-only-supports-integers/173996)
- [Partners blog: font picker](https://www.shopify.com/partners/blog/font-picker)
- [Liquid focal_point object](https://shopify.dev/docs/api/liquid/objects/focal_point)
- [Horizon theme blocks (unofficial mirror)](https://mintlify.com/Shopify/horizon/architecture/theme-blocks)
- [Shopline JSON templates](https://developer.shopline.com/docs/themes-2-0/architecture/templates/json-templates)
- [Squarespace: Fluid Engine](https://support.squarespace.com/hc/articles/6421525446541)
- [Squarespace site styles guide (third-party)](https://www.paigebrunton.com/blog/squarespace-site-styles-editor)
- [Webflow: save and restore backups](https://help.webflow.com/hc/en-us/articles/33961244069395)
- [Webflow: staging subdomain](https://help.webflow.com/hc/en-us/articles/33961419650067)
- [Webflow: page branching](https://help.webflow.com/hc/en-us/articles/33961355506195)
- [Webflow Data API: publish site](https://developers.webflow.com/data/reference/sites/publish.md)
- [Wix: site history](https://support.wix.com/en/article/viewing-and-managing-your-site-history)
- [Wix: restoring a saved version](https://support.wix.com/en/article/restoring-a-saved-version-of-your-site)
- [Wix: hidden elements in the mobile editor](https://support.wix.com/en/article/wix-editor-hidden-elements-in-the-mobile-editor)
- [Big Cartel: customize your theme](https://www.bigcartel.com/resources/help/article/how-to-customize-your-theme)
- [Big Cartel: edit your theme code](https://www.bigcartel.com/resources/help/article/how-to-edit-your-theme-code)

### WooCommerce and multivendor plugins
- [WooCommerce order statuses](https://woocommerce.com/document/managing-orders/order-statuses/)
- [GoDaddy: WooCommerce order statuses](https://www.godaddy.com/help/understanding-woocommerce-order-statuses-40211)
- [Code reference: DraftOrders](https://woocommerce.github.io/code-reference/files/woocommerce-src-blocks-domain-services-draftorders.html)
- [Code reference: ReserveStock](https://woocommerce.github.io/code-reference/files/woocommerce-src-checkout-helpers-reservestock.html)
- [Code reference: wc-stock-functions](https://woocommerce.github.io/code-reference/files/woocommerce-includes-wc-stock-functions.html)
- [Failed orders restore stock in 11.0](https://developer.woocommerce.com/?p=8770915)
- [wc_cancel_unpaid_orders()](https://wp-kama.com/plugin/woocommerce/function/wc_cancel_unpaid_orders)
- [Orders not cancelled after hold-stock time (cron)](https://blog.chip-in.asia/woocommerce-orders-not-canceled-after-hold-stock-time-frame/)
- [WebToffee: unpaid order cancelled, time limit reached](https://www.webtoffee.com/blog/resolve-unpaid-order-cancelled-time-limit-reached/)
- [Variation dropdown threshold](https://woocommerce.com/document/change-limit-on-number-of-variations-for-dynamic-variable-product-dropdowns/)
- [Adding a product (product types)](https://woocommerce.com/document/managing-products/add-product/)
- [REST API: order refunds](https://developer.woocommerce.com/docs/apis/rest-api/v3/order-refunds/)
- [StackHarbor: refunds and restock](https://stackharbor.com/en/knowledge-base/woo-refunds-partial-refunds-restock/)
- [StackHarbor: stock management and backorders](https://stackharbor.com/en/knowledge-base/woo-stock-management-backorders/)
- [Barn2: backorders](https://barn2.com/blog/display-woocommerce-backorder-products/)
- [Dokan: sub order](https://dokan.co/docs/wordpress/common-questions/sub-order/)
- [WordPress.org: remove sub order and notification](https://wordpress.org/support/topic/remove-sub-order-and-notification/)
- [WordPress.org: vendor can't identify sub-order](https://wordpress.org/support/?p=15032768)
- [YITH Multi Vendor: suborder status rules](https://docs.yithemes.com/yith-woocommerce-multi-vendor/premium-version-settings/vendor-settings/enable-order-management-vendor)
- [Dokan: selling options](https://dokan.co/docs/wordpress/settings/selling-options/)
- [Dokan: vendor commission setup](https://dokan.co/docs/wordpress/tutorials/how-to-setup-dokan-vendor-commission)
- [Dokan blog: new commission structure](https://dokan.co/blog/493756/new-commission-structure-for-dokan-multivendor/)
- [Dokan changelog v3.14.0](https://dokan.co/changelog/v3-14-0-december-02-2024/)
- [Dokan: withdraw options](https://dokan.co/docs/wordpress/settings/withdraw-options/)
- [Dokan: escrow / withdraw threshold](https://dokan.co/docs/wordpress/common-questions/escrow-feature-in-dokan/)
- [Dokan: automatic withdraw disbursement](https://dokan.co/docs/wordpress/withdraw/automatic-withdraw-disbursement/)
- [Dokan: reverse withdrawal](https://dokan.co/docs/wordpress/withdraw/dokan-reverse-withdrawal/)
- [CVE-2026-16577](https://cve.cert.hr/cve/CVE-2026-16577)
- [Dokan: refund](https://dokan.co/docs/wordpress/refund/)
- [Dokan changelog v3.9.2](https://dokan.co/wordpress/changelog/v3-9-2-oct-17-2023/)
- [Dokan GitHub issue #2267](https://www.github.com/getdokan/dokan/issues/2267)
- [Dokan changelog v3.6.1](https://dokan.co/changelog/v3-6-1-may-31-2022/)
- [Split Pay plugin: Dokan integration](https://split-pay-plugin-docs.pages.dev/features/integrations-and-compatibility/dokan-marketplace/)
- [Dokan: coupon deduction calculation](https://dokan.co/docs/wordpress/vendor-dashboard/coupons-2/coupon-price-deduction-how-to-calculate/)
- [Dokan: zone-wise shipping](https://dokan.co/docs/wordpress/vendor-guide/dokan-zone-wise-shipping/)
- [Dokan: seller wizard](https://dokan.co/docs/wordpress/vendor-guide/dokan-seller-multi-step-wizard/)
- [Dokan: vendor store settings](https://dokan.co/docs/wordpress/vendor-dashboard/settings/)
- [Dokan: Elementor module](https://dokan.co/docs/wordpress/modules/elementor-dokan/)
- [Dokan: seller verification](https://dokan.co/docs/wordpress/modules/dokan-seller-verification-admin-settings)
- [Dokan: seller badge](https://dokan.co/docs/wordpress/modules/seller-badge/)
- [Dokan: tools](https://dokan.co/docs/wordpress/tools/)
- [WCFM: commission](https://wclovers.com/knowledgebase/wcfm-marketplace-commission/)
- [WCFM: withdrawal](https://docs.wclovers.com/withdrawal/)
- [WCFM: withdrawal threshold](https://docs.wclovers.com/withdrawal-threshold/)
- [WCFM forum: fixed commission per product](https://wclovers.com/forums/topic/the-fixed-commission-is-taken-per-product-and-not-per-order/)
- [WCFM forum: COD balance](https://wclovers.com/forums/topic/cash-on-deliver-balance-automatic-detection/)
- [WC Vendors: Pro commissions](https://wcvendors.com/knowledge-base/how-commissions-work-in-wc-vendor-pro)
- [WC Vendors: tiered commission](https://wcvendors.com/?p=164716)
- [MultiVendorX listing](https://www.xpay.sh/directory/woocommerce/plugins/dc-woocommerce-multi-vendor/)
- [MultiVendorX vendor guide (mirror)](https://backiee.wasmer.app/https_multivendorx_com/docs/knowledgebase/a-complete-vendor-guide)
- [MarketKing: shipping/tax fee recipient](https://woocommerce-multivendor.com/docs/admin-and-vendor-commissions-multivendor-marketplace-commissions/)
- [Kolonell: split payments with Paystack (2026)](https://kolonell.com/en/blog/marketplace-split-payments-vendors-paystack-2026)

### Curated marketplaces, discovery, ads regulation, UX research
- [Etsy: multi-shop cart](https://help.etsy.com/hc/articles/115013196707)
- [Etsy: Introducing Multi-Shop Checkout](https://community.etsy.com/t5/Announcements/Introducing-Multi-Shop-Checkout/m-p/13364077)
- [EcommerceBytes: Etsy cart update](https://www.ecommercebytes.com/?p=979)
- [Etsy community: minimum is per shop](https://community.etsy.com/t5/Technical-Issues/Order-total-too-low-to-be-accepted/m-p/145805271)
- [Etsy community: large cart / 10-shop limit](https://community.etsy.com/t5/Technical-Issues/Etsy-isn-t-allowing-you-to-checkout-a-large-cart-at-once/m-p/144533614)
- [Etsy advertising terms](https://openapi-f.etsy.com/legal/advertising)
- [Ecomclips: "Ad by Etsy seller" (third-party)](https://ecomclips.com/blog/etsy-advertising-what-is-etsy-advertising-and-where-will-it-shows/)
- [Etsy: What are Etsy's Picks](https://help.etsy.com/hc/en-us/articles/16594038248855-What-are-Etsy-s-Picks)
- [Etsy Editors' Picks](https://www.etsy.com/featured/favorite-shops)
- [Etsy Design Awards](https://help.etsy.com/hc/articles/360022359394)
- [Etsy: tips for getting featured](https://www.etsy.com/seller-handbook/article/tips-for-getting-featured-on-etsy/44104253845)
- [Etsy: Star Seller badge](https://help.etsy.com/hc/en-us/articles/4403058372503)
- [Etsy: search for items and shops](https://help.etsy.com/hc/articles/115015627947)
- [Etsy: Bestseller badge](https://help.etsy.com/hc/en-in/articles/4409221032599-How-to-Find-the-Best-Items-for-You-on-Etsy)
- [Etsy community: "in their carts"](https://community.etsy.com/t5/Technical-Issues/More-Than-20-People-Have-This-Item-In-Their-Carts/m-p/141072309)
- [Etsy community: Updates feature](https://community.etsy.com/t5/Announcements/Help-bring-buyers-back-with-the-Etsy-Updates-feature/m-p/139341924/highlight/true)
- [Etsy investor release: free shipping](https://investors.etsy.com/news-events/press-releases/detail/117/etsy-unveils-plans-to-make-free-shipping-a-core-part-of-the-shopping-experience)
- [ChannelX: free-shipping search priority](https://channelx.world/2019/07/etsy-to-give-priority-to-items-that-guarantee-free-shipping-to-us-buyers/)
- [Craftybase: Etsy SEO (third-party)](https://craftybase.com/blog/seo-strategies-for-etsy-sellers)
- [Etsy fees and payments policy](https://www.etsy.com/legal/fees)
- [Depop: ranking and recommendations](https://depophelp.zendesk.com/hc/en-gb/articles/9422984899985)
- [Depop: Boosted Listings policy](https://depophelp.zendesk.com/hc/en-gb/articles/9253129255569-Boosted-Listings-Policy)
- [Depop: Boosted Listings](https://depophelp.zendesk.com/hc/en-gb/articles/10110299060753)
- [Depop Partner API: boosting](https://partnerapi.depop.com/api-docs/concepts/boosting/)
- [Depop: search FAQ](https://depophelp.zendesk.com/hc/en-gb/articles/360050410093-Frequently-Asked-Questions-Depop-Search)
- [Faire release notes 2025](https://www.faire.com/blog/for-brands/release-notes-2025)
- [Faire: get discovered](https://www.faire.com/blog/selling/get-discovered-on-faire)
- [Faire support: ranking and discovery](https://www.faire.com/support/articles/360018461772)
- [Faire support: Made in filter](https://www.faire.com/support/articles/29979556053787)
- [Faire Direct](https://www.faire.com/blog/selling/how-to-use-faire-direct)
- [Faire retailer guide](https://faire.com/blog/buying/retailer-guide-to-buying-on-faire)
- [Grailed (App Store)](https://apps.apple.com/us/app/grailed-buy-sell-fashion/id1061302787)
- [Farfetch (App Store)](https://apps.apple.com/us/app/id906698760)
- [Farfetch: how to shop](https://www.farfetch.com/how-to-shop)
- [Farfetch: customer promise](https://www.farfetch.com/ie/customer-promise/)
- [SSENSE people site](https://people.ssense.com/en)
- [Desirability Lab: SSENSE retail design](https://desirabilitylab.com/backfill/backfill-2025-68-ssense-online-retail-design)
- [Desirability Lab: SSENSE editorial](https://desirabilitylab.com/backfill/backfill-2022-207-ssense-online-editorial)
- [SSENSE](https://www.ssense.com/)
- [Retail Gazette: Wolf & Badger interview](https://www.retailgazette.co.uk/blog/2026/10/wolf-badger-co-founder-shoppers-want-each-purchase-to-count-that-plays-to-our-strengths/)
- [Modern Retail: Wolf & Badger](https://www.modernretail.co/operations/marketplace-briefing-how-wolf-badger-is-winning-u-s-shoppers-despite-luxury-retails-slowdown/)
- [Wolf & Badger: About](https://www.wolfandbadger.com/pages/about/)
- [FashionUnited: Wolf & Badger Tastemakers](https://fashionunited.com/news/business/wolf-badger-launches-ambassador-programme/2024041259388)
- [PYMNTS: Garmentory](https://pymnts.com/news/retail/2016/why-boutique-shopping-needs-a-marketplace-all-its-own)
- [Garmentory](https://www.garmentory.com/)
- [Wikipedia: Not Just a Label](https://en.wikipedia.org/wiki/Not_Just_a_Label)
- [FashionUnited: NJAL DTC model](https://fashionunited.com/executive/management/not-just-a-label-launching-a-direct-to-consumer-model/2020072134563)
- [Axios: FTC complaint on Amazon ads](https://www.axios.com/2021/12/08/amazon-ftc-complaint-search-results-deceiving-ads)
- [Checkbook: Amazon ads in search](https://www.checkbook.org/national/amazon-ads-in-search-results)
- [Amazon Ads: ad policy](https://advertising.amazon.com/resources/ad-policy)
- [FTC: deceptively formatted advertisements](https://www.ftc.gov/legal-library/browse/enforcement-policy-statement-deceptively-formatted-advertisements)
- [EU Digital Services Act (Reg. 2022/2065)](https://eur-lex.europa.eu/eli/reg/2022/2065/oj)
- [arXiv: DSA and online advertising](https://arxiv.org/pdf/2503.05764)
- [Pinsent Masons: DSA for platforms](https://www.pinsentmasons.com/en-gb/out-law/analysis/how-the-digital-services-act-changes-things-for-platforms)
- [Baymard: applied filters](https://baymard.com/research-articles/how-to-design-applied-filters)
- [Baymard: PLP UX](https://baymard.com/blog/product-listing-page-plp-ux)
- [Baymard: applied filters on mobile](https://baymard.com/guidelines/2572-applied-filters-on-mobile)
- [Centric: luxury e-commerce UX](https://www.centricdxb.com/insights/luxury-e-commerce-ux-conversion-high-end-buyers)

### Drops and launch mechanics
- [Nike: SNKRS 101](https://www.nike.com/launch/t/inside-snkrs-snkrs-101)
- [Nike: SNKRS Draw help](https://www.nike.com/help/a/nike-snkrs-draw)
- [Nike: draw rules (UK)](https://www.nike.com/gb/help/a/nike-launch-drawing)
- [Nike: draw rules (AU)](https://www.nike.com/au/help/a/nike-launch-drawing)
- [Nike: launch terms (IN)](https://www.nike.com/in/help/a/snkrs-launch-terms)
- [Nike: launch tips](https://www.nike.com/jp/en/help/a/launch-tips)
- [Nike: Exclusive Access](https://www.nike.com/launch/t/inside-snkrs-exclusive-access)
- [Nike: SNKRS Pass updates](https://www.nike.com/launch/t/inside-snkrs-updates-to-snkrs-pass)
- [Sole Retriever: how SNKRS draws work](https://www.soleretriever.com/guides/how-snkrs-draws-work)
- [Sole Retriever: SNKRS 101](https://www.soleretriever.com/news/articles/nike-snkrs-101-how-to-buy-sneakers-on-the-snkrs-app)
- [Sole Retriever: Exclusive Access explained](https://www.soleretriever.com/news/articles/nike-snkrs-exclusive-access-explained-everything-you-need-to-know)
- [Sole Retriever: END. raffle review](https://www.soleretriever.com/news/articles/end-raffle-review)
- [Sole Retriever: Supreme guide](https://www.soleretriever.com/guides/ultimate-guide-to-supreme-where-to-buy-online-in-store-releases)
- [Sneaker Freaker: SNKRS Pass raffle](https://www.sneakerfreaker.com/news/nike-snkrs-app-snkrs-pass-raffle-system-update)
- [END.: entering Launches](https://endclothing.zendesk.com/hc/en-us/articles/4770065977116)
- [END.: Launches in store](https://endclothing.zendesk.com/hc/it-it/articles/4415199024924-END-Launches-in-Store)
- [Kith Monday Program](https://kith.com/collections/kith-monday-program/sneakers)
- [Hypebeast: Palace Fall 2026 drop 2](https://hypebeast.com/2026/8/palace-skateboards-fall-2026-drop-2-release-info)
- [StockX release calendar](https://stockx.com/releases/upcoming)
- [Dover Street Market raffle page](https://london.doverstreetmarket.com/pages/nike-air-max-sunder)
- [CrowdHandler: Shopify flash-sale queue](https://www.crowdhandler.com/blog/waiting-room-queue-for-shopify-flash-sales)
- [CrowdHandler: anti-cheat settings](https://www.crowdhandler.com/docs/integrations/shopify/anti-cheat-settings)
- [Queue-it: pre-queue](https://queue-it.com/pre-queue/)
- [Queue-it: FIFO vs randomization](https://www.queue-it.com/blog/first-in-first-out-randomization)
- [Cloudflare Waiting Room: events](https://developers.cloudflare.com/waiting-room/additional-options/create-events/)
- [Cloudflare Turnstile: server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Stripe: limited inventory with Checkout](https://stripe.com/docs/payments/checkout/managing-limited-inventory)
- [DEV: countdown and Date.now gotcha](https://dev.to/brinobruno/javascript-countdown-gotcha-why-datenow-depends-on-the-users-clock-2gl9)
- [EightX: apparel drop economics](https://eightx.co/blog/apparel-drop-model-economics)
- [The Fashion Law: hype can be manufactured](https://www.thefashionlaw.com/hype-can-be-manufactured-and-consumer-goods-brands-want-in/)

### Payments, ledger, idempotency, regulation
- [Paystack: split payments](https://paystack.com/docs/payments/split-payments)
- [Paystack: multi-split payments](https://paystack.com/docs/payments/multi-split-payments/)
- [Paystack support: transaction splits](https://support.paystack.com/en/articles/2132802)
- [Paystack: webhooks](https://paystack.com/docs/payments/webhooks/)
- [Paystack: refunds](https://paystack.com/docs/payments/refunds/)
- [Paystack: single transfers](https://paystack.com/docs/transfers/single-transfers/)
- [Paystack: bulk transfers](https://paystack.com/docs/transfers/bulk-transfers/)
- [Paystack: manage disputes](https://paystack.com/docs/payments/manage-disputes/)
- [Paystack: card preauthorization](https://paystack.com/docs/payments/card-preauthorization/)
- [Paystack: payment channels (Pay with Transfer expiry)](https://paystack.com/docs/payments/payment-channels/)
- [Paystack: pricing](https://paystack.com/pricing)
- [Paystack support: transaction charges](https://support.paystack.com/hc/en-us/articles/360009881920)
- [Hookdeck: Paystack webhooks guide](https://hookdeck.com/webhooks/platforms/guide-to-paystack-webhooks-features-and-best-practices)
- [Mctaba: delayed settlement patterns (third-party)](https://mctaba.com/learn/paystack/delayed-settlement-patterns-for-marketplaces)
- [Mctaba: escrow-style flows and limits (third-party)](https://mctaba.com/learn/paystack/escrow-style-flows-on-paystack-and-their-limits)
- [Mctaba: transfer vs refund API (third-party)](https://mctaba.com/learn/paystack/refunding-customers-via-transfer-vs-refund-api)
- [Mctaba: reconciling settlements (third-party)](https://mctaba.com/learn/paystack/reconciling-paystack-settlements-against-your-database)
- [Mctaba: every webhook event (third-party)](https://mctaba.com/learn/paystack/every-paystack-webhook-event-explained)
- [skills.sh: Paystack subaccounts (third-party)](https://skills.sh/rexedge/paystack/paystack-subaccounts)
- [skills.sh: Paystack settlements (third-party)](https://skills.sh/rexedge/paystack/paystack-settlements)
- [Flutterwave: docs home](https://developer.flutterwave.com/docs)
- [Flutterwave: split payments](https://developer.flutterwave.com/docs/collecting-payments/split-payments)
- [Flutterwave: preauthorization](https://developer.flutterwave.com/docs/preauthorization)
- [Flutterwave: transfers overview](https://developer.flutterwave.com/docs/making-payments/transfers/overview)
- [Flutterwave: handling error timeouts](https://developer.flutterwave.com/docs/handling-error-timeouts)
- [Flutterwave: introduction (duplicate reference)](https://developer.flutterwave.com/docs/introduction-3)
- [Flutterwave Eng: webhooks (verif-hash)](https://dev.to/flutterwaveeng/what-are-webhooks-and-how-do-you-implement-them-15j4)
- [opsofts/laravel-flutterwave (v4 notes, third-party)](https://packagist.org/packages/opsofts/laravel-flutterwave)
- [Stripe Connect: charge types](https://docs.stripe.com/connect/charges)
- [Stripe: separate charges and transfers](https://docs.stripe.com/connect/separate-charges-and-transfers)
- [Stripe: destination charges](https://stripe.com/docs/connect/destination-charges)
- [Stripe: marketplace refunds and disputes](https://docs.stripe.com/connect/marketplace/tasks/refunds-disputes)
- [Stripe: controller properties](https://docs.stripe.com/connect/migrate-to-controller-properties)
- [Stripe: payout schedule](https://docs.stripe.com/connect/manage-payout-schedule)
- [Stripe: cross-border payouts](https://docs.stripe.com/connect/connect-cross-border-payouts)
- [Stripe: Connect report types](https://docs.stripe.com/reports/report-types/connect)
- [Stripe: payout reconciliation report](https://docs.stripe.com/reports/report-types/payout-reconciliation)
- [Adyen: split payments at authorization](https://docs.adyen.com/platforms/online-payments/split-transactions/split-payments-at-authorization)
- [Adyen: split refunds](https://docs.adyen.com/platforms/online-payments/split-transactions/split-refunds)
- [Modern Treasury: immutability in a double-entry ledger](https://moderntreasury.com/journal/enforcing-immutability-in-your-double-entry-ledger)
- [Modern Treasury: scaling a ledger, part II](https://moderntreasury.com/journal/how-to-scale-a-ledger-part-ii)
- [Modern Treasury: ledger transaction object](https://docs.moderntreasury.com/platform/reference/ledger-transaction-object)
- [Dodo Payments: payment ledger design](https://dodopayments.com/blogs/payment-ledger-design/)
- [Brandur: idempotency keys in Postgres](https://brandur.org/idempotency-keys)
- [brandur/rocket-rides-atomic](https://github.com/brandur/rocket-rides-atomic)
- [FetchSandbox: Stripe webhook replay](https://fetchsandbox.com/blog/stripe-webhook-replay-stale-timestamp)
- [EBA Q&A 2020_5355 (commercial agent exclusion)](https://www.eba.europa.eu/single-rule-book-qa/qna/view/publicId/2020_5355)
- [Letslaw: PSD2 and marketplaces](https://letslaw.es/en/psd2-directive-and-its-implication-on-marketplaces/)
- [Aelex: CBN payment system framework (PDF)](https://www.aelex.com/wp-content/uploads/2021/05/Central-Bank-of-Nigeria-issues-new-framework-for-payment-system-providers.pdf)
- [PressOne: Stripe and Nigeria (third-party)](https://pressone.africa/blog/how-to-open-a-stripe-account-in-nigeria/)
- [DevGenius: missing penny problem (largest remainder)](https://blog.devgenius.io/the-missing-penny-problem-and-the-1792-voting-rule-that-fixes-it-e1e2fa443c50)

### Premium UX and Apple Human Interface Guidelines (fetched and verified)
- [Apple HIG: Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
- [Apple HIG: Color](https://developer.apple.com/design/human-interface-guidelines/color)
- [Apple HIG: Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode)
- [Apple HIG: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- [Apple: Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)