import { z } from "zod"

/**
 * GET /api/studio/setup (§7.4): which of the new features the active brand has set up, from server
 * state only. A plain module (no "use client", no server imports), shared by the route and the card.
 */
export const SETUP_ITEMS = ["shipping", "social", "locations", "quick_replies"] as const
export type SetupItemKey = (typeof SETUP_ITEMS)[number]

export const setupStatusDto = z.object({
  brandId: z.string(),
  items: z.array(z.object({ key: z.enum(SETUP_ITEMS), done: z.boolean() })),
  done: z.number(),
  total: z.number(),
})
export type SetupStatusDto = z.infer<typeof setupStatusDto>

/** Each item's words and where it leads. */
export const setupItemCopy: Record<SetupItemKey, { title: string; body: string; href: string; action: string }> = {
  shipping: {
    title: "Review shipping & fulfilment",
    body: "Your handling time, zones and rates drive the delivery estimates shoppers see.",
    href: "/studio/shipping",
    action: "Review shipping",
  },
  social: {
    title: "Connect Instagram or TikTok, or upload posts",
    body: "Posts you choose show in your storefront's Social feed.",
    href: "/studio/social",
    action: "Open Social",
  },
  locations: {
    title: "Add a location",
    body: "Stores, showrooms and pop-ups show on Yard Around.",
    href: "/studio/locations/new",
    action: "Add a location",
  },
  quick_replies: {
    title: "Save quick replies",
    body: "Answer sizing and delivery questions in your Inbox in one tap.",
    href: "/studio/inbox?sheet=quick-replies",
    action: "Add quick replies",
  },
}
