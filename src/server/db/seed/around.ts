import "server-only"
import { and, eq, inArray, isNull, like, or } from "drizzle-orm"
import { areaBySlug } from "@/lib/around/gazetteer"
import type { PlaceHours } from "@/lib/around/hours"
import { shiftDate, zonedTimeToUtc } from "@/lib/data/zones"
import { invalidateMemo } from "../../cache"
import { afterCommit, db } from "../tx"
import { brandLocations, locationEvents, shippingProfiles } from "../schema"
import type { SeedContext, SeedModule } from "./types"

/**
 * Around fixtures (Appendix D; cluster A). Every place is sample data: `sample = true`,
 * `pin_precision = 'area'` and an address that says it isn't real, so shoppers see "Sample
 * place", a dashed pin and no Directions. Times are relative to `seedDay`, so pop-ups are
 * upcoming after a fresh seed and pass in real time; `db:reset` re-anchors them.
 * Reseeding deletes this module's rows by their fixed ids first.
 */

type Spec = {
  id: string
  brandId: string
  kind: "store" | "showroom" | "popup" | "exhibition"
  name: string
  area: string
  hours?: PlaceHours | null
  byAppointment?: boolean
  hoursNote?: string
  /** Local dates and times in the place's zone. */
  starts?: { day: number; time: string }
  ends?: { day: number; time: string }
  images: string[]
  featured?: string[]
  description: string
  visibility?: "draft" | "published" | "hidden"
  moderation?: "approved" | "pending_review" | "rejected" | "removed"
  reason?: string
  reviewedDaysAgo?: number
}

const h = (o: string, c: string): [string, string][] => [[o, c]]
const weekdays = (o: string, c: string, sat: [string, string] | null = [o, c], sun: [string, string] | null = null): PlaceHours => ({
  mon: h(o, c),
  tue: h(o, c),
  wed: h(o, c),
  thu: h(o, c),
  fri: h(o, c),
  sat: sat ? [sat] : null,
  sun: sun ? [sun] : null,
})

/** Days from `day` (YYYY-MM-DD) to the next Saturday after it. */
const toNextSaturday = (day: string) => {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay()
  return (6 - dow + 7) % 7 || 7
}

function specs(seedDay: string): Spec[] {
  const sat = toNextSaturday(seedDay)
  return [
    {
      id: "loc_seed_ls_yaba",
      brandId: "b_lagos_static",
      kind: "store",
      name: "Lagos Static Yaba",
      area: "lagos/yaba",
      hours: weekdays("10:00", "19:00"),
      images: ["fashion/streetwear-editorial/2", "fashion/campaign/1"],
      featured: ["p_danfo_heavyweight_hoodie", "p_third_mainland_tee"],
      description: "The shop floor and print room. Try on the full Drop 07 run and pick up web orders.",
    },
    {
      id: "loc_seed_ls_lekki",
      brandId: "b_lagos_static",
      kind: "popup",
      name: "Static Saturday",
      area: "lagos/lekki",
      starts: { day: sat, time: "12:00" },
      ends: { day: sat + 1, time: "18:00" },
      images: ["fashion/streetwear-editorial/4"],
      featured: ["p_third_mainland_tee"],
      description: "A weekend pop-up with sample sales, screen printing on the spot and the Drop 07 tees.",
      reviewedDaysAgo: 3,
    },
    {
      id: "loc_seed_ls_removed",
      brandId: "b_lagos_static",
      kind: "store",
      name: "Old stockroom",
      area: "lagos/surulere",
      hours: weekdays("09:00", "17:00", null),
      images: ["fashion/campaign/5"],
      description: "Our old stockroom.",
      visibility: "hidden",
      moderation: "removed",
      reason: "The address is a private home, not a shop shoppers can visit",
      reviewedDaysAgo: 6,
    },
    {
      id: "loc_seed_ls_rejected",
      brandId: "b_lagos_static",
      kind: "popup",
      name: "Ikeja night market stall",
      area: "lagos/ikeja",
      starts: { day: 6, time: "17:00" },
      ends: { day: 6, time: "23:00" },
      images: ["fashion/streetwear-editorial/5"],
      description: "One night at the Ikeja night market.",
      visibility: "hidden",
      moderation: "rejected",
      reason: "The dates don't match the market's published schedule",
      reviewedDaysAgo: 2,
    },
    {
      id: "loc_seed_oy_ikoyi",
      brandId: "b_oyin_atelier",
      kind: "showroom",
      name: "Oyin Atelier showroom",
      area: "lagos/ikoyi",
      hours: null,
      byAppointment: true,
      hoursNote: "Fittings by appointment, Tuesday to Saturday.",
      images: ["fashion/campaign/3", "fashion/dresses/1"],
      description: "Fittings for made-to-measure pieces and the Season 04 preview.",
    },
    {
      id: "loc_seed_nf_seongsu",
      brandId: "b_null_form",
      kind: "store",
      name: "Null Form Seongsu",
      area: "seoul/seongsu",
      hours: weekdays("12:00", "21:00", ["12:00", "21:00"], ["12:00", "20:00"]),
      images: ["objects/sneakers/5", "objects/sneakers/7"],
      featured: ["p_nf_04_prism"],
      description: "A concrete-floored shop with every NF runner on the wall.",
    },
    {
      id: "loc_seed_sb_hongdae",
      brandId: "b_signal_bloom",
      kind: "popup",
      name: "3AM Hongdae scent bar",
      area: "seoul/hongdae",
      starts: { day: 2, time: "14:00" },
      ends: { day: 7, time: "22:00" },
      images: ["lifestyle/beauty/2"],
      featured: ["p_3am_hongdae_edp"],
      description: "Five nights of the first Signal Bloom eau de parfum, with refills from the numbered batch.",
    },
    {
      id: "loc_seed_hm_shoreditch",
      brandId: "b_halfmoon_archive",
      kind: "store",
      name: "Halfmoon Archive",
      area: "london/shoreditch",
      hours: weekdays("11:00", "19:00", ["11:00", "19:00"], ["12:00", "17:00"]),
      images: ["fashion/outerwear/2", "fashion/tops/3"],
      description: "Archive tailoring and restored outerwear, one rail per decade.",
    },
    {
      id: "loc_seed_fc_roma",
      brandId: "b_ferro_club",
      kind: "showroom",
      name: "Ferro Club taller",
      area: "mexico-city/roma-norte",
      hours: weekdays("11:00", "18:00", ["11:00", "15:00"]),
      images: ["objects/jewelry/2", "objects/jewelry/5"],
      featured: ["p_halo_no_9"],
      description: "The casting workshop with a small showroom at the front.",
    },
    {
      id: "loc_seed_da_westlands",
      brandId: "b_dune_apothecary",
      kind: "store",
      name: "Dune Apothecary",
      area: "nairobi/westlands",
      hours: weekdays("09:00", "18:00", ["10:00", "16:00"]),
      images: ["lifestyle/beauty/4"],
      description: "Small-batch skin care, mixed and refilled in the shop.",
    },
    {
      id: "loc_seed_mo_nakameguro",
      brandId: "b_mute_objects",
      kind: "store",
      name: "Mute Objects Nakameguro",
      area: "tokyo/nakameguro",
      hours: { mon: null, tue: h("12:00", "20:00"), wed: h("12:00", "20:00"), thu: h("12:00", "20:00"), fri: h("12:00", "20:00"), sat: h("11:00", "20:00"), sun: h("11:00", "19:00") },
      images: ["lifestyle/tech/3", "lifestyle/tech/5"],
      description: "Repairable audio and restored objects by the canal.",
    },
    {
      id: "loc_seed_mo_daikanyama",
      brandId: "b_mute_objects",
      kind: "exhibition",
      name: "Quiet machines",
      area: "tokyo/daikanyama",
      starts: { day: -2, time: "11:00" },
      ends: { day: 12, time: "19:00" },
      images: ["lifestyle/tech/1"],
      description: "An exhibition of restored radios and turntables, all playable.",
    },
    {
      id: "loc_seed_pr_maboneng",
      brandId: "b_paper_riot",
      kind: "popup",
      name: "Poster Series 04 pop-up",
      area: "johannesburg/maboneng",
      starts: { day: 9, time: "10:00" },
      ends: { day: 11, time: "18:00" },
      images: ["lifestyle/art/2"],
      description: "Two days of prints, a risograph on site and the first look at Series 04.",
    },
    {
      id: "loc_seed_vu_marais",
      brandId: "b_velvet_underpass",
      kind: "store",
      name: "Velvet Underpass",
      area: "paris/le-marais",
      hours: weekdays("11:00", "19:30", ["11:00", "19:30"], ["14:00", "19:00"]),
      images: ["objects/bags/2", "objects/eyewear/1"],
      description: "Bags, eyewear and small leather goods in a former bookbinder's.",
    },
    {
      id: "loc_seed_gl_les",
      brandId: "b_gridlock_supply",
      kind: "store",
      name: "Gridlock Supply",
      area: "new-york/lower-east-side",
      hours: weekdays("11:00", "20:00", ["11:00", "20:00"], ["12:00", "18:00"]),
      images: ["fashion/campaign/4", "objects/headwear/2"],
      featured: ["p_laundromat_trucker", "p_gls_court"],
      description: "Truckers, courts and the full Laundromat run.",
    },
    {
      id: "loc_seed_gl_williamsburg",
      brandId: "b_gridlock_supply",
      kind: "popup",
      name: "Gridlock at the flea",
      area: "new-york/williamsburg",
      starts: { day: 5, time: "10:00" },
      ends: { day: 8, time: "18:00" },
      images: ["objects/sneakers/9"],
      description: "Three days at the weekend flea with B-grade courts and samples.",
    },
    {
      id: "loc_seed_kt_osu",
      brandId: "b_kumasi_thread",
      kind: "store",
      name: "Kumasi Thread Osu",
      area: "accra/osu",
      hours: weekdays("09:30", "18:30", ["10:00", "17:00"]),
      images: ["fashion/streetwear-editorial/5", "fashion/outerwear/4"],
      description: "Loom-knit sweaters and kente-lined coats, cut on site.",
    },
    {
      id: "loc_seed_or_surulere",
      brandId: "b_orun_studio",
      kind: "popup",
      name: "Orun Studio open house",
      area: "lagos/surulere",
      starts: { day: 4, time: "11:00" },
      ends: { day: 5, time: "19:00" },
      images: ["objects/jewelry/6"],
      description: "Brass pieces and lamps from the studio, for two days.",
      moderation: "pending_review",
    },
  ]
}

/** Up to 400 m from the neighbourhood centre, deterministic per place. */
function jitter(ctx: SeedContext, id: string, lat: number, lng: number) {
  const r = 400 * Math.sqrt(ctx.rand(`${id}:r`))
  const a = 2 * Math.PI * ctx.rand(`${id}:a`)
  return { lat: lat + (r * Math.cos(a)) / 111_320, lng: lng + (r * Math.sin(a)) / (111_320 * Math.cos((lat * Math.PI) / 180)) }
}

const SEED_PREFIX = "loc_seed_%"

const seed: SeedModule = {
  key: "seed:around",
  version: 1,
  requires: ["brands:b_lagos_static", "users:u_b_tobi"],
  async run(ctx) {
    const d = await db()
    const now = ctx.now
    const ids = specs(ctx.seedDay).map((s) => s.id)

    // Reseed: the pickup link first (its FK isn't deferrable), then events and places by fixed id.
    const linked = await d.select({ brandId: shippingProfiles.brandId, pickup: shippingProfiles.pickupLocationId }).from(shippingProfiles).where(inArray(shippingProfiles.pickupLocationId, ids))
    await d.update(shippingProfiles).set({ pickupLocationId: null }).where(inArray(shippingProfiles.pickupLocationId, ids))
    await d.delete(locationEvents).where(or(like(locationEvents.id, "lev_seed_%"), inArray(locationEvents.locationId, ids)))
    await d.delete(brandLocations).where(like(brandLocations.id, SEED_PREFIX))

    const owners: Record<string, string> = { b_lagos_static: "u_b_tobi", b_null_form: "u_b_minji", b_orun_studio: "u_b_orun", b_kumasi_thread: "u_b_multi", b_signal_bloom: "u_b_multi" }
    for (const s of specs(ctx.seedDay)) {
      const area = areaBySlug(s.area)
      if (!area) throw new Error(`seed:around: unknown area ${s.area}`)
      const tz = area.city.timeZone
      const at = (x: { day: number; time: string }) => new Date(zonedTimeToUtc(shiftDate(ctx.seedDay, x.day), x.time, tz))
      const pos = jitter(ctx, s.id, area.lat, area.lng)
      const visibility = s.visibility ?? "published"
      await d
        .insert(brandLocations)
        .values({
          id: s.id,
          brandId: s.brandId,
          kind: s.kind,
          name: s.name,
          addressLine: `Sample address in ${area.name}`,
          neighbourhood: area.neighbourhood?.name ?? null,
          city: area.city.name,
          citySlug: area.city.slug,
          country: area.city.country,
          inGazetteer: true,
          lat: Math.round(pos.lat * 1e6) / 1e6,
          lng: Math.round(pos.lng * 1e6) / 1e6,
          pinPrecision: "area",
          timeZone: tz,
          hours: s.kind === "store" || s.kind === "showroom" ? (s.hours ?? null) : null,
          byAppointment: s.byAppointment ?? false,
          hoursNote: s.hoursNote ?? null,
          startsAt: s.starts ? at(s.starts) : null,
          endsAt: s.ends ? at(s.ends) : null,
          images: s.images.map((ref, i) => {
            const im = ctx.img(ref)
            return { src: im.src, alt: i === 0 ? `${s.name}, sample photo` : im.alt, width: im.width, height: im.height }
          }),
          featuredProductIds: (s.featured ?? []).filter((id) => ctx.products.some((p) => p.id === id && p.brandId === s.brandId)),
          description: s.description,
          visibility,
          moderationStatus: s.moderation ?? "approved",
          moderationReason: s.reason ?? null,
          reviewedAt: s.reviewedDaysAgo !== undefined ? new Date(now.getTime() - s.reviewedDaysAgo * 86_400_000) : null,
          sample: true,
          createdBy: owners[s.brandId] ?? "u_b_tobi",
          createdAt: now,
          updatedAt: now,
          publishedAt: visibility === "published" ? now : null,
        })
        .onConflictDoNothing()
    }

    // Events (Appendix D).
    const drop = ctx.drops.find((x) => x.id === "d_ls_third_mainland")
    const release = drop?.releaseLocal && "daysOut" in drop.releaseLocal ? drop.releaseLocal : { daysOut: 2, time: "18:00" }
    const lagos = "Africa/Lagos"
    const dropStart = new Date(zonedTimeToUtc(shiftDate(ctx.seedDay, release.daysOut), release.time, lagos))
    const dropEnd = new Date(dropStart.getTime() + (drop?.durationHours ?? 48) * 3_600_000)
    const ny = "America/New_York"
    await d
      .insert(locationEvents)
      .values([
        {
          id: "lev_seed_ls_drop07",
          brandId: "b_lagos_static",
          locationId: "loc_seed_ls_yaba",
          kind: "drop_launch",
          title: "Drop 07: Third Mainland — in store",
          description: "The full Third Mainland run on the shop floor from release, with the long-exposure prints on the walls.",
          startsAt: dropStart,
          endsAt: dropEnd,
          dropId: drop ? drop.id : null,
          productIds: ["p_danfo_heavyweight_hoodie", "p_third_mainland_tee"],
          promoText: null,
          visibility: "published",
          moderationStatus: "approved",
          sample: true,
          createdBy: "u_b_tobi",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "lev_seed_gl_restock",
          brandId: "b_gridlock_supply",
          locationId: "loc_seed_gl_les",
          kind: "promotion",
          title: "Laundromat restock — in store",
          description: "Truckers and courts back in every size, with a free cap clip on in-store orders.",
          startsAt: new Date(zonedTimeToUtc(shiftDate(ctx.seedDay, -1), "11:00", ny)),
          endsAt: new Date(zonedTimeToUtc(shiftDate(ctx.seedDay, 6), "20:00", ny)),
          dropId: "d_gl_restock",
          productIds: ["p_laundromat_trucker", "p_gls_court"],
          promoText: "Free cap clip with every in-store order",
          visibility: "published",
          moderationStatus: "approved",
          sample: true,
          createdBy: "u_b_tobi",
          createdAt: now,
          updatedAt: now,
        },
      ])
      .onConflictDoNothing()

    // Lagos Static's pickup point: whichever of around and shipping seeds second writes the link (§1.5).
    for (const l of linked) await d.update(shippingProfiles).set({ pickupLocationId: l.pickup }).where(eq(shippingProfiles.brandId, l.brandId))
    await d.update(shippingProfiles).set({ pickupLocationId: "loc_seed_ls_yaba" }).where(and(eq(shippingProfiles.brandId, "b_lagos_static"), isNull(shippingProfiles.pickupLocationId)))
    // The public place lists are memoised (server/around/cache.ts): a reseed reaches the next request.
    afterCommit(() => invalidateMemo("around:"))
  },
}

export default seed
