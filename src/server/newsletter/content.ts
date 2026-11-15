import "server-only"
import { eq } from "drizzle-orm"
import type { Executor } from "../db"
import { newsletterCampaigns } from "../db/schema/newsletter"
import { mediaSrc } from "../media/dto"

/**
 * A campaign's email variables (subject, heading, body, image, button), read by the email outbox
 * when it renders a bulk `newsletter` / `service_notice` row (which carries only campaignId and
 * name). A campaign's content is frozen once it leaves draft, so the content is cached briefly per
 * process; its status is always read fresh (one small indexed read per email), so an email
 * rendered after Stop is never sent on a stale 'sending'. A draft's content is never cached.
 */
export type CampaignVars = { status: string; vars: Record<string, string | number> }

const TTL_MS = 30_000
const cache = new Map<string, { at: number; vars: Record<string, string | number> }>()

export type CampaignRow = typeof newsletterCampaigns.$inferSelect

/** The template variables of a campaign row (also used by preview and test send). */
export function campaignEmailVars(c: Pick<CampaignRow, "subject" | "preheader" | "heading" | "body" | "greet" | "heroMediaId" | "heroAlt" | "buttonLabel" | "buttonUrl">): Record<string, string | number> {
  const vars: Record<string, string | number> = { subject: c.subject, preheader: c.preheader, heading: c.heading, body: c.body, greet: c.greet ? 1 : 0 }
  if (c.heroMediaId) {
    vars.image = mediaSrc(c.heroMediaId)
    vars.imageAlt = c.heroAlt
  }
  if (c.buttonLabel.trim() && c.buttonUrl.trim()) {
    vars.buttonLabel = c.buttonLabel
    vars.buttonUrl = c.buttonUrl
  }
  return vars
}

export async function campaignVars(ex: Executor, campaignId: string): Promise<CampaignVars | null> {
  const hit = cache.get(campaignId)
  if (hit && Date.now() - hit.at < TTL_MS) {
    const [s] = await ex.select({ status: newsletterCampaigns.status }).from(newsletterCampaigns).where(eq(newsletterCampaigns.id, campaignId)).limit(1)
    if (!s) return null
    if (s.status !== "draft") return { status: s.status, vars: hit.vars }
  }
  const [c] = await ex.select().from(newsletterCampaigns).where(eq(newsletterCampaigns.id, campaignId)).limit(1)
  if (!c) return null
  const vars = campaignEmailVars(c)
  if (cache.size > 200) cache.clear()
  if (c.status !== "draft") cache.set(campaignId, { at: Date.now(), vars })
  else cache.delete(campaignId)
  return { status: c.status, vars }
}

/** Forgets a campaign's cached content (after a cancel commits). */
export function forgetCampaign(campaignId: string) {
  cache.delete(campaignId)
}
