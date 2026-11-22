import { api } from "./client"
import type { AdminProposalContextDto, ProposalListDto, ProposalProductInput, ProposalResult, ProposalStatus } from "./contracts/proposals"

/**
 * Typed wrappers over the Suggestions from Yard routes: /api/admin/proposals (catalog.propose) and
 * /api/studio/proposals (the active brand; deciding needs content.publish).
 */

const one = (base: string, id: string) => `${base}/${encodeURIComponent(id)}`
const ADMIN = "/api/admin/proposals"
const STUDIO = "/api/studio/proposals"

export type ProposalBrandOption = { id: string; name: string; handle: string; city: string; reviewStatus: string }

export const listAdminProposals = (q: { status?: ProposalStatus | "all"; brandId?: string; q?: string; offset?: number } = {}) =>
  api<ProposalListDto>(ADMIN, { query: { status: q.status, brandId: q.brandId, q: q.q || undefined, offset: q.offset } })
export const getAdminProposal = (id: string) => api<ProposalResult>(one(ADMIN, id))
export const createAdminProposal = (body: { kind: "new"; brandId: string; product: ProposalProductInput; note?: string } | { kind: "edit"; productId: string; product: ProposalProductInput; note?: string }) => api<ProposalResult>(ADMIN, { body })
export const reviseAdminProposal = (id: string, body: { product: ProposalProductInput; note?: string }) => api<ProposalResult>(`${one(ADMIN, id)}/revise`, { body })
export const withdrawAdminProposal = (id: string) => api<ProposalResult>(`${one(ADMIN, id)}/withdraw`, { method: "POST" })
export const getProposalContext = (q: { brandId?: string; productId?: string }) => api<AdminProposalContextDto>(`${ADMIN}/context`, { query: q })
export const searchProposalBrands = (q: string) => api<{ brands: ProposalBrandOption[] }>(`${ADMIN}/brands`, { query: { q: q || undefined } })

export const listStudioProposals = (status: "pending" | "all" = "pending") => api<ProposalListDto>(STUDIO, { query: { status } })
export const getStudioProposal = (id: string) => api<ProposalResult>(one(STUDIO, id))
export const acceptStudioProposal = (id: string, product?: ProposalProductInput) => api<ProposalResult & { productId: string; published: boolean }>(`${one(STUDIO, id)}/accept`, { body: product ? { product } : {} })
export const declineStudioProposal = (id: string, reason?: string) => api<ProposalResult>(`${one(STUDIO, id)}/decline`, { body: reason ? { reason } : {} })

export type ProposalBatchResult = { accepted: string[]; skipped: { id: string; reason: string }[]; replayed?: boolean }
/** Accept all (no ids) or the selected suggestions in one tap; the same `idempotencyKey` answers with the first result. */
export const acceptAllStudioProposals = (body: { ids?: string[]; idempotencyKey: string }) => api<ProposalBatchResult>(`${STUDIO}/accept-all`, { body })
/** Decline all (no ids) or the selected suggestions; `accepted` lists the declined ones. */
export const declineAllStudioProposals = (body: { ids?: string[]; reason?: string; idempotencyKey: string }) => api<ProposalBatchResult>(`${STUDIO}/decline-all`, { body })

export const STUDIO_PROPOSALS_KEY = "studio.proposals"
export const ADMIN_PROPOSALS_KEY = "admin.proposals"
