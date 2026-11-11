import type { Drop } from "@/lib/data/types"

export type DropAccessDto = "first_come" | "early_access" | "draw"
export type DropPhaseDto = "upcoming" | "entries_open" | "early_access" | "live" | "ended"

export type PublicDropDto = {
  id: string
  slug: string
  brand: { id: string; handle: string | null; name: string | null }
  name: string
  description: string
  image: string | null
  access: DropAccessDto
  status: string
  phase: DropPhaseDto
  startsAt: string
  endsAt: string
  earlyAccessAt: string | null
  entryOpensAt: string | null
  entryClosesAt: string | null
  drawnAt: string | null
  purchaseWindowMinutes: number | null
  winners: number | null
  limitPerCustomer: number
  totalUnits: number
  productIds: string[]
  entries: number | null
  sponsored: boolean
  version: number
}

export type StudioDropDto = PublicDropDto & {
  reminders: number
  drawSeedHash: string | null
}

export type DropMeDto = {
  reminder: boolean
  following: boolean
  earlyAccess: boolean
  entry: { status: string; rank: number | null; windowOpensAt: string | null; windowEndsAt: string | null; enteredAt: string } | null
  canBuy: boolean
  reason: string | null
  claimed: number
  remainingAllowance: number
}

export type PublicDropDetailDto = {
  drop: PublicDropDto & { variantIds: string[]; unitsAvailable: number | null }
  me: DropMeDto | null
}

export type PublicDrawInfoDto = {
  dropId: string
  algorithm: string
  seedHash: string | null
  seed: string | null
  drawnAt: string | null
  entryClosesAt: string
  winners: number
  counts: { entries: number; won: number; purchased: number; waitlisted: number }
  me: { status: string; rank: number | null; windowOpensAt: string | null; windowEndsAt: string | null } | null
}

export function dropAccessForButton(access: DropAccessDto): Drop["access"] {
  return access === "draw" ? "draw" : access === "early_access" ? "early-access" : "first-come"
}

export function dropImageSrc(image: string | null, as: "shopper" | "brand" = "shopper") {
  if (!image) return "/media/missing.svg"
  return image.startsWith("/") ? image : `/api/media/${encodeURIComponent(image)}?as=${as}`
}

export function dropPhaseAt(drop: PublicDropDto, now: number | null): DropPhaseDto {
  if (now === null) return drop.phase
  if (drop.status === "ended" || now >= Date.parse(drop.endsAt)) return "ended"
  if (drop.access === "draw" && !drop.drawnAt) {
    const opens = drop.entryOpensAt ? Date.parse(drop.entryOpensAt) : Number.NEGATIVE_INFINITY
    const closes = drop.entryClosesAt ? Date.parse(drop.entryClosesAt) : Date.parse(drop.startsAt)
    if (now >= opens && now < closes) return "entries_open"
  }
  if (drop.access === "early_access" && drop.earlyAccessAt && now >= Date.parse(drop.earlyAccessAt) && now < Date.parse(drop.startsAt)) return "early_access"
  if (now >= Date.parse(drop.startsAt)) return "live"
  return "upcoming"
}