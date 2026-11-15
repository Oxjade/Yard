# Newsletter (Admin › Newsletter)

Yard's own emails to its people, written by an admin: drop roundups, picks and offers (Marketing) or
notices about terms, privacy and how Yard works (Service notice). The admin writes the words; the
email is Yard's existing branded layout (`src/server/email/layout.ts`). Everything goes through the
existing email outbox (`src/server/email`): retries, backoff, bounce/complaint suppression, the stub
transport when no provider is configured, and the List-Unsubscribe headers. There is no second email
system.

- Rules and words: `src/lib/newsletter.ts` (pure; `src/lib/newsletter.test.ts`).
- Server: `src/server/newsletter/` — `index.ts` (service + job), `audience.ts` (who, one SQL predicate
  for the count and the frozen list), `batch.ts` (hand-over to the outbox), `content.ts` (what the
  outbox renders). Tests against PGlite with the real migrations: `audience.test.ts`, `batch.test.ts`.
- Templates: `newsletter` (category `marketing`), `service_notice` (category `service`, transactional)
  and `newsletter_test` (category `account`) in `src/server/email/templates.ts`.
- UI: `/admin/newsletter` (list) and `/admin/newsletter/compose?id=` (composer),
  `src/components/admin/newsletter/`.
- Data: migration `drizzle/0021_newsletter.sql` — tables `newsletter_campaigns` and
  `newsletter_recipients`; `notification_preferences.email_marketing` (default **false**); categories
  `marketing` and `service` on `email_outbox` / `email_suppressions`; media purpose `newsletter_image`.

## Permission

`comms.newsletter` ("write and send newsletters"): **Owner** and **Ads operations** (Yard's marketing
role: it already reviews ad campaigns). Every route checks it; the sidebar item and the command
palette entry show only to admins who hold it.

## Consent

| Type | Who gets it | Unsubscribe |
|---|---|---|
| Marketing | People in the audience who switched on **News and offers from Yard** and have no marketing (or "all") unsubscribe. | Every email: an Unsubscribe link (signed token, no sign-in) plus `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. |
| Service notice | Everyone in the audience, whatever their marketing choice. Composer warns: not for promotions, and flags promotional words. | None (service mail), like order and account emails. |

Both always skip: suspended accounts, erased accounts (`deleted+…@deleted.invalid`) and accounts
waiting to be erased, addresses that bounced or complained, and (outside the demo) demo accounts.

**The preference.** There was no marketing preference before this; the existing topics (drops,
price drops, back in stock, brand news) are about brands a person follows. The privacy policy says
"With your consent, to send you marketing emails", so `email_marketing` **defaults off for everyone,
existing accounts included** (no row = off): nobody is assumed opted in. People switch it on in:

- Settings › Notifications › From Yard › **News and offers from Yard** (shoppers, `/you/settings`);
- Studio › Settings › Emails from Yard › **News and offers from Yard** (brand people, for themselves).

Turning Email off in shopper Settings also turns marketing off; turning Email back on does not turn it
back on. Turning marketing on lifts an earlier marketing unsubscribe (as with every topic).

**Unsubscribing** (the `/unsubscribe` page or the one-click POST) records the suppression, switches the
account's `email_marketing` off, and, when the link came from a campaign (the token names it), marks
that recipient `unsubscribed_at` so the campaign's stats count it. The next marketing campaign skips
them (verified end to end, below). Tokens minted before campaigns existed still work.

## Audiences

| Audience | Who |
|---|---|
| All shoppers | Accounts of kind `shopper`. |
| All brands | Active **owners and admins** of any brand (Yard setup and other team roles are left out). One email per person. |
| Followers of a brand | Shoppers following the chosen brand (`shopper_follows`). |
| Shoppers in a country | Shoppers whose ship-to country is the chosen ISO code: the country of their newest order (`order_refs.ship_to_country`) or newest checkout (`checkouts.ship_to.country`, paid or not), whichever is later; failing both, the account's `users.country` (only seeded accounts have one: sign-up doesn't set it, and the Settings ship-to choice lives in the browser). A shopper who has never checked out is in no country audience. |

The composer shows the live count ("2. Audience · N people"); the confirm step says **"This will send
to N people."** Send now refuses (409) if the audience changed since that count; the admin sees the new
number and confirms again. A scheduled campaign freezes its audience when it starts, so people who
opt in or out before then are respected.

## Composer

One page, four sections, with the real email beside it (desktop or phone width), rendered by the server
with the template the outbox sends (`POST …/preview`, a moment after you stop typing):

1. **Type**: Marketing or Service notice.
2. **Audience**: the four above, with a brand picker (follower counts) or a country.
3. **Message**: campaign name (admins only), subject, preview text, heading, "Hey {first name}," (on by
   default; left out without a name), the message, an optional wide image (uploaded through the media
   pipeline; public only while a campaign uses it, purged 7 days after nothing does) with its
   description, and an optional button (label + link). Placeholders are on-brand ideas; the admin
   writes the words.
4. **Send**: what's still missing, **Send test to me** (to the admin's own address, subject marked
   `[Test]`, 10 an hour, never swallowed by their own marketing setting), **Review and send** → the
   confirm step (count, Now or a date and time 5 minutes to 60 days out) → Send / Schedule. Changing
   the type or audience while the confirm step is open closes it. Send carries the confirmed count and
   the confirmed type and audience; the server refuses (409) both Send now and Schedule when either no
   longer matches.

The message is a small Markdown: a blank line starts a paragraph, `**bold**`, `[words](link)`,
lines starting with `- ` make bullets; the toolbar inserts them. Links and the button may be Yard
paths (`/shop`) or full `https://` addresses; anything else (`javascript:`, `mailto:`, plain `http` off
Yard) is refused before sending. Nothing else is interpreted and every character is escaped.

Drafts autosave 0.8 s after the last change (and when leaving the page). Each save carries the
draft's revision; a save from a stale tab is refused ("changed in another tab… Reload"). Only drafts
can be edited or deleted.

## Sending

`POST …/send` puts the campaign in `scheduled` (Send now: `sending` at once, audience frozen in the
same transaction). The job **`newsletter.run`** (every minute, `src/server/schedulers.ts`, also kicked
right after Send now):

1. starts due scheduled campaigns: freezes the audience into `newsletter_recipients` (one row per
   account, `pending`);
2. hands the outbox at most **`YARD_NEWSLETTER_PER_MINUTE`** recipients a minute (default 100) across
   campaigns, and nothing while 300 or more campaign emails still wait in the outbox (backpressure);
3. copies the outbox's outcome onto each recipient (`sent`, `failed`, `suppressed`, `stub`), so stats
   survive the outbox's 90-day purge;
4. marks a campaign `sent` (and writes `newsletter.finished`) only once nobody is left to hand over
   **and** the outbox has finished with every one of its emails (no recipient left `queued`). Until
   then it stays `sending`, so **Stop sending** can still drop the tail waiting in the outbox; the panel
   reads "Everyone handed over: N still leaving the outbox". Outcomes keep updating for 3 days.

The outbox claims campaign emails **after** every other due email (a password reset never waits behind
a campaign) and sends at most one every **`YARD_NEWSLETTER_GAP_MS`** (default 600 ms, under Resend's
default 2 a second) to a live provider. Campaign rows store only `{ campaignId, name }`; the content is
read from the (frozen) campaign when rendered: the content is cached for 30 s per process, but the
campaign's status is read fresh for every email, so an email rendered after Stop commits is dropped. Campaign emails left as `stub` are never re-queued later,
so a campaign that ran without a provider doesn't go out days afterwards.

**No double sends.** A batch claims pending recipients `FOR UPDATE SKIP LOCKED`, inserts each outbox
row with the dedupe key `newsletter:{campaign}:{user}` (unique) and marks them `queued` in **one**
transaction: a run that dies rolls all of it back, a second run (or two at once, or a restart) finds
nobody pending, and a recipient whose outbox row already exists is a no-op. The campaign panel shows
"Emails in the outbox: N (one per person)".

**Cancel.** A scheduled campaign: **Cancel schedule** → back to draft (nothing was sent). A sending one:
**Stop sending** → recipients not yet handed over become `cancelled`, its emails still waiting in the
outbox are dropped, emails already sent stay sent; the status reads "Stopped". Send now stores no
`scheduledFor`, so its panel shows Started, not "Scheduled for".

**Cost.** One indexed query a minute when nothing is sending. While sending: one small transaction per
batch plus the outbox's own work per email; cost scales with recipients, not page views.

## List and stats

`/admin/newsletter`: All / Drafts / Scheduled / Sending / Sent with counts; each row shows type,
audience, status, the relevant date and "N sent · F failed · U unsubscribed" (and "not sent (no email
provider)" under the stub). A draft opens the composer; anything else opens the panel: Sent,
Unsubscribed, Failed, Skipped tiles, a progress bar while sending, facts, per-recipient status
(filterable, 50 a page), the activity log, and Cancel schedule / Stop sending.

## Audit

`newsletter.created`, `newsletter.deleted`, `newsletter.test_sent`, `newsletter.scheduled`,
`newsletter.sent_now`, `newsletter.started` (system or admin; recipients), `newsletter.finished`
(system; counts), `newsletter.unscheduled`, `newsletter.stopped`. Meta holds the kind, subject, audience
and counts, never the body. Autosaves aren't audited (the draft records who edited it last).

## API (comms.newsletter)

| Route | |
|---|---|
| `GET/POST /api/admin/newsletters` | list / new draft |
| `GET/PATCH/DELETE /api/admin/newsletters/{id}` | read / autosave (with `revision`) / delete a draft |
| `POST …/{id}/preview` | the real email of unsaved composer fields |
| `POST …/{id}/test` `{ idempotencyKey }` | test to me (10/h) |
| `POST …/{id}/send` `{ when, at?, expectedCount, confirmed: { kind, audience, brandId, country }, idempotencyKey }` | send now or schedule (20/h) |
| `POST …/{id}/cancel` | cancel schedule / stop sending |
| `GET …/{id}/recipients?status=&offset=` | per-recipient status |
| `GET /api/admin/newsletters/audience?kind=&type=&brandId=&country=` | the live count |
| `GET /api/admin/newsletters/brands?q=` | brands with follower counts |

Uploads: `POST /api/uploads?purpose=newsletter_image&as=admin`.

## Template copy

The email is the admin's words in Yard's layout: eyebrow "News from Yard" (or "Service notice"), the
heading, "Hey {first name},", the message, the image, the button, and the footer: "You're getting this
because you said yes to news and offers from Yard." + Unsubscribe / manage notifications (marketing),
or "You're getting this service notice because you have a Yard account. We only send these for
important changes to Yard, even when marketing emails are off." (service).
