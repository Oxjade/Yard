# Brand emails from Yard

Every email Yard sends a brand about its shop: automatic reminders, decision emails and the
admin's one-tap emails. All of them go through the existing email outbox (`src/server/email`):
queued inside the transaction that caused them, sent after commit by the delivery worker (every
minute, retried with backoff, stopped by a bounce or complaint), with the shared branded layout.
Without `EMAIL_PROVIDER`/`EMAIL_API_KEY`/`EMAIL_FROM` the stub transport sends nothing and, in
development, prints each email to the server log.

- Copy and rules: `src/lib/brand-emails.ts` (pure, unit-tested in `src/lib/brand-emails.test.ts`).
- Templates: `src/server/email/templates.ts` (`brand_draft_nudge`, `brand_storefront_nudge`,
  `brand_rejected`, `listing_held`, `listing_back`, `brand_message`).
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
| Still in drafts (`brand_draft_nudge`) | A product has been a draft for 12 hours: never published, not hidden by moderation, created in the last 30 days; brand not restricted or suspended, no application under review, not an unclaimed founding brand. One email per brand per run covers all its due drafts (first named, the rest counted). | product (`catalog_products.draft_nudged_at`) |
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
| Listing paused (`listing_held`) | Admin › Products › Restrict listing (`setProductModeration`, hidden), with the admin's reason. |
| Listing back (`listing_back`) | Lift restriction on a listing (un-hidden). |

Brand restriction and suspension keep their Studio notification (no email). Products are not
reviewed before publishing, so lifting a restriction is the "listing approved" moment.

**Application: changes needed**
- Subject: `A few tweaks and {brand} is good to go`
- Heading: Almost there
- Thanks for applying to sell {brand} on Yard. We went through everything and we can't approve it just
  yet. Here's what the team said: "{reason}". Make those changes in Studio and resubmit whenever you're
  ready. Everything you entered is saved, so it's a quick fix, not a fresh start. Questions? Message
  @support from Yard Support in Studio and a real person on the team gets back to you.
- Button: Update my application → `/studio/onboarding`

**Listing paused**
- Subject: `{product} is taking a quick break from Yard`
- Heading: Listing on pause
- We've paused {product}, so it isn't showing on Yard for now. It's safe in Studio and nothing else in
  your shop has changed. Why: "{reason}". Sort it out in Studio, then message @support when it's ready.
  We'll take another look and get it back out there.
- Button: Fix it in Studio → `/studio/products/{id}`

**Listing back**
- Subject: `{product} is back on Yard 🎉`
- Heading: Back in rotation
- Good news: {product} is back on Yard. Shoppers can find it, save it and buy it again. Thanks for
  sorting it out. Keep the heat coming.
- Button: View in Studio → `/studio/products/{id}`

## One-tap emails from Admin

Admin › Brands › a brand (and the founding-brand tray once claimed) › **Email the brand**: pick a
template, edit the prefilled subject and message, **Preview** (the real email) and **Send**. Inline in
the tray like the claim link. Permission `brands.email` (Owner, Trust & safety, Support).
`GET/POST /api/admin/brand-emails/{brandId}`, `POST …/preview`. Limits: 5 per brand per 24 hours
across all admins, 30 an hour and 120 a day per admin; a retried send (same idempotency key) sends
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

Migration `drizzle/0020_brand_emails.sql`: `brands.nudge_emails` (default on), `brands.last_nudged_at`,
`brands.storefront_nudged_at`, `catalog_products.draft_nudged_at` and the partial index
`catalog_products_draft_nudge_ix`. Existing drafts older than 12 hours (and younger than 30 days) get
their one reminder on the first run after deploy.
