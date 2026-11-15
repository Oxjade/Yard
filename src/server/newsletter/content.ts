import "server-only"
import { eq } from "drizzle-orm"
import type { Executor } from "../db"
import { newsletterCampaigns } from "../db/schema/newsletter"
import { mediaSrc } from "../media/dto"

/**
 * A campaign's email variables (subject, heading, body, image, button), read by the email outbox
 * when it renders a bulk `newsletter` / `service_notice` row (which carries only campaignId and
 * name). A campaign's content is frozen once it leaves draft, so this caches it briefly per
 * process; a draft is never cached (test sends carry their own content anyway).
 */
export type CampaignVars = { status: string; vars: Record<string, string | number> }

const TTL_MS = 30_000
const cache = new Map<string, { at: number; value: CampaignVars | null }>()

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
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  const [c] = await ex.select().from(newsletterCampaigns).where(eq(newsletterCampaigns.id, campaignId)).limit(1)
  const value = c ? { status: c.status, vars: campaignEmailVars(c) } : null
  if (cache.size > 200) cache.clear()
  if (value && value.status !== "draft") cache.set(campaignId, { at: Date.now(), value })
  return value
}

/** Forgets a campaign (cancel), so the next render sees its new status at once. */
export function forgetCampaign(campaignId: string) {
  cache.delete(campaignId)
}
