import type { LOCATION_EVENT_KINDS, LOCATION_KINDS } from "@/lib/api/contracts/enums"
import { categoryBySlug } from "@/lib/data/catalog"
import type { Brand } from "@/lib/data/types"
import { dayIn, openLine, openState, timeIn, timedStatus, type PlaceHours } from "./hours"

export type LocationKind = (typeof LOCATION_KINDS)[number]
export type LocationEventKind = (typeof LOCATION_EVENT_KINDS)[number]

export const kindLabel: Record<LocationKind, string> = { store: "Store", showroom: "Showroom", popup: "Pop-up", exhibition: "Exhibition" }
export const kindPlural: Record<LocationKind, string> = { store: "Stores", showroom: "Showrooms", popup: "Pop-ups", exhibition: "Exhibitions" }

export const eventKindLabel: Record<LocationEventKind, string> = {
  drop_launch: "Drop launch",
  promotion: "Promotion",
  exhibition: "Exhibition",
  talk: "Talk",
  sale: "Sale",
  popup_day: "Pop-up day",
}

export const isDatedKind = (k: LocationKind) => k === "popup" || k === "exhibition"

/** The brand's main category name ("Streetwear"). */
export function brandCategoryName(brand: Pick<Brand, "categories">) {
  const slug = brand.categories[0]
  return (slug && categoryBySlug.get(slug)?.name) || "Independent brand"
}

/**
 * Only two kinds of image src ever render on Around (§6 intro, §2.6): `/api/media/<id>` (with an
 * optional `as=`) built by the server from a media id, or a seed `/media/…` path. Anything else
 * renders the fallback instead, never a remote URL.
 */
export function safePlaceSrc(src: string | null | undefined): string | null {
  if (!src) return null
  if (/^\/api\/media\/[A-Za-z0-9_-]{1,80}(\?as=(shopper|brand|admin))?$/.test(src)) return src
  if (/^\/media\/[A-Za-z0-9_./-]{1,200}$/.test(src) && !src.includes("..")) return src
  return null
}

type Timed = { kind: LocationKind; startsAt: string | null; endsAt: string | null; hours: PlaceHours | null; byAppointment: boolean; timeZone: string }

/**
 * The status line of a card (§6.4): "Open, closes 19:00"; "Sat 9 – Sun 10 Nov" for a pop-up;
 * "Starts Sat 9 Nov" when upcoming; "Live now" (with the acid dot) while it runs.
 */
export function statusLine(p: Timed, at: number): { text: string; live?: boolean } | null {
  if (isDatedKind(p.kind)) {
    const s = timedStatus(p.startsAt, p.endsAt, at)
    if (!s || !p.startsAt || !p.endsAt) return null
    if (s === "live") return { text: `Live now, until ${endsLabel(p.endsAt, p.timeZone, at)}`, live: true }
    if (s === "ended") return { text: "Ended" }
    return { text: `Starts ${dayIn(p.startsAt, p.timeZone)}, ${timeIn(p.startsAt, p.timeZone)}` }
  }
  if (p.byAppointment && !p.hours) return { text: "By appointment" }
  const line = openLine(openState(p.hours, p.timeZone, at))
  if (!line) return p.byAppointment ? { text: "By appointment" } : null
  return { text: p.byAppointment ? `${line}, by appointment` : line }
}

function endsLabel(endsAt: string, tz: string, at: number) {
  const sameDay = dayIn(endsAt, tz) === dayIn(at, tz)
  return sameDay ? timeIn(endsAt, tz) : `${dayIn(endsAt, tz)}, ${timeIn(endsAt, tz)}`
}

/** Whether a place is open (or a dated place live) at `at`. */
export function isOpenNow(p: Timed, at: number) {
  if (isDatedKind(p.kind)) return timedStatus(p.startsAt, p.endsAt, at) === "live"
  return openState(p.hours, p.timeZone, at)?.open === true
}

/** The canonical link to a place (§5.6): what Share copies and badges link to. No area, view or filters. */
export const canonicalPlacePath = (id: string) => `/around?place=${encodeURIComponent(id)}`
