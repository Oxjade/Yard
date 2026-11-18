# Brand emails from Yard

Every email Yard sends a brand about its shop: automatic reminders, decision emails and the
admin's one-tap emails. All of them go through the existing email outbox (`src/server/email`):
queued inside the transaction that caused them, sent after commit by the delivery worker (every
minute, retried with backoff, stopped by a bounce or complaint), with the shared branded layout.
Without `EMAIL_PROVIDER`/`EMAIL_API_KEY`/`EMAIL_FROM` the stub transport sends nothing and, in
development, prints each email to the server log.

- Copy and rules: `src/lib/brand-emails.ts` (pure, unit-tested in `src/lib/brand-emails.test.ts`).
- Templates: `src/server/email/templates.ts` (`brand_draft_nudge`, `brand_storefront_nudge`,
  `brand_rejected`, `listing_held`, `listing_back`, `brand_message`, `brand_shop_live`).
- Recipients: the brand's active **owners and admins** (`brandLeads` in
  `src/server/orders/brand-email.ts`); Yard setup is never a recipient. An application email goes to
  the applicant.
- Every email is audited; Admin › Brands › a brand › **Email the brand › Sent lately** lists the last
  12 (reminders, decisions and one-tap emails).

Tone: warm, playful, short, streetwear energy. At most one emoji, in the heading. Never sarcastic,
never fake urgency. Decisions stay kind and say exactly what to do next.

## Automatic reminders (opt-out-able)

Job `catalog.nudgeBrands` (`src/server/catalog/nudges.ts`), every 30 minutes (first run 9 minutes
after boot). Cost scales with time, not traffic: one bounded query per reminder kind per run (a
partial index on drafts), more work only when a reminder is due. A brand gets **at most one reminder
a day** (`brands.last_nudged_at`) and none when an owner or admin switched them off in
**Studio › Settings › Emails from Yard** (`brands.nudge_emails`, `PUT /api/studio/settings/emails`).
Every reminder's footer links there ("Not into reminders? Switch them off in Studio settings").

| Email | Trigger | Once per |
|---|---|---|
| Still in drafts (`brand_draft_nudge`) | A product has been a draft for 12 hours **since the brand could first publish it**: the latest of its creation, the founding brand's claim (`claimed_at`) and the application's approval (`reviewed_at` of the approved onboarding), so a first product saved with an application, or drafts Yard prepared before a claim, aren't reminded about right after approval or claim. Never published, not hidden by moderation, that clock started in the last 30 days; brand not restricted or suspended, no application under review, not an unclaimed founding brand. One email per brand per run covers all its due drafts (first named, the rest counted). | product (`catalog_products.draft_nudged_at`) |
| Publish your storefront (`brand_storefront_nudge`) | A claimed founding brand with at least one published or scheduled product, 24 hours after claiming, whose storefront was never published (`launched_at` empty), so its products are still hidden. | brand (`brands.storefront_nudged_at`) |

**Still in drafts**
- Subject: `Your {product} is chilling in drafts` (several: `Your {product} (and {n} more) are chilling in drafts`)
- Preview: One tap and it's live. Shoppers can't cop what they can't see.
- Heading: Still in drafts 👀
- Hey {brand}, {product} is saved in Studio, but it's still a draft, so nobody on Yard can see it yet.
  If it's ready, give it one last look (photos, sizes, price) and hit Publish. That's the whole move.
  *(Founding brand not launched:)* One more thing: your storefront isn't published yet either. Publish it
  from Storefront in Studio so the whole Yard can find you. Still cooking? No stress, it'll wait for you.
- Button: Publish {product} → `/studio/products/{id}`

**Publish your storefront**
- Subject: `{brand}, your storefront is ready for its moment`
- Preview: Your pieces are set. Publish the storefront and the doors open.
- Heading: Open the doors ✨
- {n} pieces are ready in Studio, but your storefront hasn't been published yet, so shoppers can't find
  {brand} on Yard. Open Storefront in Studio, check your banner and story, and hit Publish. Everything
  shows up the moment it's live. Want a second pair of eyes first? Message @support in Studio and we'll
  take a look.
- Button: Publish my storefront → `/studio/storefront`

## Decision emails (always sent, not opt-out-able)

Queued in the same transaction as the decision and its audit row (audit `meta.emailed`).

| Email | Trigger |
|---|---|
| Application: changes needed (`brand_rejected`) | Admin › Brands › Reject on a submitted application (`reviewOnboarding`), to the applicant, with the admin's reason. |
| You're approved (`brand_approved`, existing) | Approve on a submitted application. |
| Listing paused / on hold (`listing_held`) | Admin › Products › Restrict listing (`setProductsModeration`, hidden), with the admin's reason. |
| Listing back / hold lifted (`listing_back`) | Lift restriction on a listing (un-hidden). |

| You're live (`brand_shop_live`, variant `yard`) | Admin › Brands (or the founding tray) › **Publish storefront for {brand}** (`POST /api/admin/brand-storefronts/{brandId}`), audited `brand.storefront_published_by_yard` with `meta.emailed`. Once per brand (dedupe key `brand_shop_live:yard:{brandId}`); pressing again when the shop is already live is a no-op. An unclaimed founding brand has no owner yet, so nobody is emailed; it gets the claim variant when it's claimed. |
| You're live (`brand_shop_live`, variant `claim`) | The owner claims a founding brand and its shop is live right after (it went live on claim with **Go live when they claim**, or Yard had already published it). Audited `founding.claim_went_live` with `meta.emailed`. Once per brand (`brand_shop_live:claim:{brandId}`). |

Moderation emails are **one per brand per decision**: a bulk Restrict or Lift of 10 listings from one
brand sends that brand one email naming the first, counting the rest (`POST
/api/admin/catalog/products/moderation`, up to 100 listings, all or nothing). The wording follows where
each listing stands with shoppers (`listingState`, the same rules as the public catalogue):
`listing_held` says "paused" only for a listing shoppers could see, and `listing_back` says "back on
Yard" only for one that is live again. A draft or unpublished scheduled product, a restricted or
suspended brand, or an unlaunched founding storefront gets "the hold is lifted" and what's left before
it shows. A brand whose listings are in different states gets one email per state.

Brand restriction and suspension keep their Studio notification (no email). Products are not
reviewed before publishing, so lifting a restriction is the "listing approved" moment.

**You're live** (Yard published it)
- Subject: `{brand}, your shop is live on Yard 🎉`
- Preview: We put your shop live for you. Shoppers can find you now.
- Heading: You're live 🎉
- Hey {brand}, We put your shop live for you, so shoppers can find you now.
  Your shop: **yardstore.space/brands/{handle}** (a link; the host is `YARD_PUBLIC_URL`'s).
  Change anything in Studio anytime. ("Studio" links to `/studio`.)
  *(No payout account yet:)* One thing left: add your payout account so shoppers can buy. Takes about 2
  minutes. **Add my payout account** → `/studio/settings#payouts`
- Button: See my shop → `/brands/{handle}`

**You're live** (on claim)
- Subject: `You claimed {brand} and you're live 🎉`
- Preview: Your shop went live the moment you claimed it. Shoppers can find you now.
- Heading: You're live 🎉
- Hey {brand}, Your shop went live the moment you claimed it, so shoppers can find you now. (Then the
  same shop link, Studio line, payout line and button as above.)

**Application: changes needed**
- Subject: `A few tweaks and {brand} is good to go`
- Heading: Almost there
- Thanks for applying to sell {brand} on Yard. We went through everything and we can't approve it just
  yet. Here's what the team said: "{reason}". Make those changes in Studio and resubmit whenever you're
  ready. Everything you entered is saved, so it's a quick fix, not a fresh start. Questions? Message
  @support from Yard Support in Studio and a real person on the team gets back to you.
- Button: Update my application → `/studio/onboarding`

**Listing paused** (shoppers could see it)
- Subject: `{product} is taking a quick break from Yard` (several: `{product} and {n} more are taking a quick break from Yard`)
- Heading: Listing on pause (several: Listings on pause)
- We've paused {product}, so it isn't showing on Yard for now. It's safe in Studio and nothing else in
  your shop has changed. Why: "{reason}". Sort it out in Studio, then message @support when it's ready.
  We'll take another look and lift the hold.
- Button: Fix it in Studio → `/studio/products/{id}` (several: `/studio/products`)

**Listing on hold** (a draft, or otherwise not live)
- Subject: `{product} is on hold for now`
- Heading: On hold for now
- We've put a hold on {product}, so it can't go live for now. It's safe in Studio and nothing else in
  your shop has changed. Why: "{reason}". (Same ending and button as above.)

**Listing back** (live again)
- Subject: `{product} is back on Yard 🎉` (several: `{product} and {n} more are back on Yard 🎉`)
- Heading: Back in rotation
- Good news: {product} is back on Yard. Shoppers can find it, save it and buy it again. Thanks for
  sorting it out. Keep the heat coming.
- Button: View in Studio → `/studio/products/{id}`

**Hold lifted** (not live yet)
- Subject: `The hold on {product} is lifted`
- Heading: All clear
- Good news: we've lifted the hold on {product}. Then one of: *(not published)* It isn't published yet,
  so publish it in Studio whenever it's ready and it shows up on Yard. / *(founding storefront not
  published)* It shows up on Yard as soon as your storefront is published. / *(brand restricted or
  suspended)* It shows up on Yard once your shop is fully back. Message @support if you're not sure
  what's left. Thanks for sorting it out.
- Button: Open in Studio → `/studio/products/{id}` (storefront case: Open my storefront → `/studio/storefront`)

## One-tap emails from Admin

Admin › Brands › a brand (and the founding-brand tray once claimed) › **Email the brand**: pick a
template, edit the prefilled subject and message, **Preview** (the real email) and **Send**. Inline in
the tray like the claim link. Permission `brands.email` (Owner, Trust & safety, Support).
`GET/POST /api/admin/brand-emails/{brandId}`, `POST …/preview`. Limits: 5 per brand in any 24 hours
(a rolling window, not the calendar day: the composer shows "{n} of 5 in 24h" and, at the cap, the
time a slot opens again) across all admins, 30 an hour and 120 a day per admin; a retried send (same idempotency key) sends
nothing new. Audited as `brand_email.sent` with the template and subject (never the body). The
message is signed with the admin's first name and points replies to @support in Studio.

| Template | Subject | Heading | Button |
|---|---|---|---|
| Finish your listing | `{brand}, your drafts are so close` | So close 👀 | Open my products → `/studio/products` |
| Publish your storefront | `{brand}, let's open the doors` | Open the doors ✨ | Open my storefront → `/studio/storefront` |
| Add a payout account | `Let's get {brand} paid` | Where should the money go? 💸 | Add my payout account → `/studio/settings#payouts` |
| Photos need love | `Your pieces deserve better photos` | Give your photos some love 📸 | Update my photos → `/studio/products` |
| Custom message | `A quick note from Yard` | Hey from Yard 👋 | Open Studio → `/studio` |

Prefilled bodies (editable):
- **Finish your listing**: Your products are saved in Studio but still sitting in drafts, which means
  shoppers can't see them yet. / Give them one last look (photos, sizes, price) and hit Publish. That's
  it, you're live. / Need a hand with anything? We're right here.
- **Publish your storefront**: Your storefront is set up but not published yet, so Yard shoppers can't
  find you. / Head to Storefront in Studio, check your banner and story, and hit Publish. Your pieces
  show up the moment it's live.
- **Add a payout account**: You're nearly ready to sell, but there's no payout account on file yet, so
  we've got nowhere to send your earnings. / It takes about two minutes: Studio, then Settings, then
  Payouts. Only the last four digits ever show in Studio.
- **Photos need love**: Your pieces look great, but a few of the photos aren't doing them justice yet.
  / Quick wins: natural light, a clean background, the whole piece in frame and a close-up of the
  details. Shoppers buy what they can see. / Swap them in Studio whenever you're ready.
- **Custom message**: empty, the admin writes it.

## Data

Migration `drizzle/0022_go_live_on_claim.sql`: `brands.go_live_on_claim` (default off, so existing
founding brands keep their behaviour; new founding brands are created with it on).

Migration `drizzle/0020_brand_emails.sql`: `brands.nudge_emails` (default on), `brands.last_nudged_at`,
`brands.storefront_nudged_at`, `catalog_products.draft_nudged_at` and the partial index
`catalog_products_draft_nudge_ix`. Existing drafts whose clock started 12 hours to 30 days ago get
their one reminder on the first run after deploy.
