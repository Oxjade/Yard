import { sql, type SQL } from "drizzle-orm"
import type { NewsletterAudience, NewsletterKind } from "../../lib/newsletter"

/**
 * Who a Newsletter campaign reaches. Plain Node (no "server-only"): `tsx --test` runs it against
 * PGlite with the real migrations (audience.test.ts). One SQL predicate serves the count the admin
 * confirms ("This will send to N people") and the frozen recipient list, so the two can't disagree.
 *
 * Everyone: an account that isn't suspended, not erased (deleted+…@deleted.invalid) or waiting to be
 * erased, whose address never bounced or complained, and (outside the demo) not a demo account.
 * Marketing adds consent: notification_preferences.email_marketing is on (it defaults off; no row =
 * off) and the address has no marketing or 'all' unsubscribe. A service notice ignores marketing
 * consent and unsubscribes (it is service mail), but never bounced addresses.
 *
 * Audiences: shoppers (kind shopper); brands (an active owner or admin of any brand, so Yard setup
 * and other team roles are left out); followers of one brand; shoppers in one country (ISO code on
 * the account).
 */
export type Exec = { execute: (q: SQL) => Promise<unknown> }
export type AudienceOptions = { includeDemo: boolean }

const rows = <T>(r: unknown) => ((r as { rows?: T[] }).rows ?? (r as T[])) as T[]

export function audiencePredicate(audience: NewsletterAudience, kind: NewsletterKind, opts: AudienceOptions): SQL {
  const parts: SQL[] = [
    sql`u.status <> 'suspended'`,
    sql`u.email not like '%@deleted.invalid'`,
    sql`not exists (select 1 from account_deletions ad where ad.user_id = u.id and ad.status in ('pending', 'processing'))`,
    sql`not exists (select 1 from email_suppressions s where s.email_lower = lower(u.email) and s.reason in ('bounce', 'complaint'))`,
  ]
  if (!opts.includeDemo) parts.push(sql`u.demo = false`)
  if (kind === "marketing") {
    parts.push(sql`exists (select 1 from notification_preferences np where np.user_id = u.id and np.email_marketing = true)`)
    parts.push(sql`not exists (select 1 from email_suppressions s where s.email_lower = lower(u.email) and s.reason = 'unsubscribe' and s.category in ('marketing', 'all'))`)
  }
  if (audience.type === "shoppers") parts.push(sql`u.kind = 'shopper'`)
  else if (audience.type === "brands") parts.push(sql`exists (select 1 from brand_members bm where bm.user_id = u.id and bm.status = 'active' and bm.role in ('owner', 'admin'))`)
  else if (audience.type === "followers") parts.push(sql`exists (select 1 from shopper_follows f where f.user_id = u.id and f.brand_id = ${audience.brandId})`)
  else parts.push(sql`u.kind = 'shopper'`, sql`upper(u.country) = ${audience.country.toUpperCase()}`)
  return sql.join(parts, sql` and `)
}

/** How many people the campaign would reach right now. */
export async function countAudience(ex: Exec, audience: NewsletterAudience, kind: NewsletterKind, opts: AudienceOptions): Promise<number> {
  const r = rows<{ n: number | string }>(await ex.execute(sql`select count(*)::int as n from users u where ${audiencePredicate(audience, kind, opts)}`))
  return Number(r[0]?.n ?? 0)
}

/** The outbox dedupe key of one campaign email: the same person never gets the same campaign twice. */
export const recipientKey = (campaignId: string, userId: string) => `newsletter:${campaignId}:${userId}`.slice(0, 200)

/**
 * Freezes the audience into newsletter_recipients (status pending). Idempotent: a second call adds
 * nobody who is already there. Returns how many rows the campaign has.
 */
export async function freezeAudience(ex: Exec, campaignId: string, audience: NewsletterAudience, kind: NewsletterKind, opts: AudienceOptions): Promise<number> {
  await ex.execute(sql`
    insert into newsletter_recipients (campaign_id, user_id, email, name, status, dedupe_key)
    select ${campaignId}, u.id, u.email, u.name, 'pending', 'newsletter:' || ${campaignId} || ':' || u.id
    from users u where ${audiencePredicate(audience, kind, opts)}
    on conflict do nothing`)
  const r = rows<{ n: number | string }>(await ex.execute(sql`select count(*)::int as n from newsletter_recipients where campaign_id = ${campaignId}`))
  return Number(r[0]?.n ?? 0)
}
