import { z } from "zod"
import type { ProductView, ProposalField } from "@/lib/proposals"
import type { StudioCollectionDto, StudioProductCreateBody, StudioProductDto } from "./catalog"

/**
 * Suggestions from Yard (product proposals). Request bodies (zod) are in
 * src/server/catalog/contracts.ts next to the product bodies they extend. An admin with catalog.propose suggests a new product
 * for a brand, or changes to one of its products, using the Studio product form. Nothing goes live
 * until a brand member with content.publish accepts. Admin routes: /api/admin/proposals; Studio:
 * /api/studio/proposals (the active brand's only). The pure diff rules are in src/lib/proposals.ts.
 */

export const PROPOSAL_STATUSES = ["pending", "accepted", "declined", "withdrawn", "superseded"] as const
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]
export type ProposalKind = "new" | "edit"

/** What a client sends: the Studio product form's body (the server checks badges and every other field). */
export type ProposalProductInput = Omit<StudioProductCreateBody, "dropId" | "slug"> & { stock?: Record<string, number> }

/* ---------- DTOs ---------- */

export type ProposalImageDto = { key: string; src: string; alt: string; width: number | null; height: number | null }
export type ProposalChangeDto = {
  field: ProposalField
  label: string
  /** The value when the proposal was made. */
  before: unknown
  after: unknown
  /** The value now, when the brand changed it since. */
  now?: unknown
  changedSince: boolean
}

export type ProposalSummaryDto = {
  id: string
  kind: ProposalKind
  status: ProposalStatus
  brand: { id: string; name: string; handle: string }
  productId: string | null
  /** The proposed name (new) or the product's name (edit). */
  title: string
  cover: string | null
  note: string | null
  fields: ProposalField[]
  createdAt: string
  updatedAt: string
  decidedAt: string | null
  declineReason: string | null
  /** Admin views only. */
  createdBy?: { id: string; name: string } | null
  decidedBy?: { name: string } | null
  supersedesId?: string | null
}

export type ProposalDetailDto = ProposalSummaryDto & {
  currency: string
  /** The product as it would be after accepting. */
  proposed: ProductView
  /** Edit proposals: the product now. */
  current: ProductView | null
  currentVersion: number | null
  changes: ProposalChangeDto[]
  conflicts: ProposalField[]
  /** Photo sources by image key (an image id or a media id). */
  images: Record<string, ProposalImageDto>
  /** Names for the ids the form uses. */
  names: { collections: Record<string, string>; variants: Record<string, string> }
}

export type ProposalListDto = { items: ProposalSummaryDto[]; total: number; counts: Record<ProposalStatus, number>; nextOffset: number | null }
export type ProposalResult = { proposal: ProposalDetailDto }

export const proposalRealtimeEvents = {
  "proposal.updated": z.object({ proposalId: z.string(), status: z.enum(PROPOSAL_STATUSES) }),
}


/** The admin form's context: the brand as the product form needs it, its catalogue (SKUs, photo library) and collections. */
export type AdminProposalContextDto = {
  brand: { id: string; name: string; handle: string; currency: string; country: string; city: string; processingDays: [number, number] }
  products: StudioProductDto[]
  collections: StudioCollectionDto[]
  /** ?productId: the product to suggest changes to, and its pending suggestion if there is one. */
  product: StudioProductDto | null
  pendingId: string | null
}
