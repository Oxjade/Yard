import { and, eq, lt, or, sql } from "drizzle-orm"
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import { catalogSitePieces } from "../../db/schema/imports"

/**
 * "First wins" for a New from your website piece (docs/IMPORTER.md › Watching a website). No
 * server-only, so the tests run these exact statements on PGlite.
 *
 * Approving is two steps: claimPiece takes a waiting piece for one side (one conditional UPDATE:
 * only one caller can move it from waiting), then, once the photos are copied, the caller creates
 * the suggestion or product and calls finishPiece IN THE SAME TRANSACTION. finishPiece only
 * succeeds while that side still holds the piece, so if a lease ran out and the other side took it
 * meanwhile, the creation rolls back: a piece can never be created twice. Skipping is one
 * conditional UPDATE from waiting. An expired claim (a crash mid-approval) can be taken by either side.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- any drizzle Postgres database or transaction (PGlite, node-postgres)
type Db = PgDatabase<PgQueryResultHKT, any>
export type Side = "admin" | "brand"
type Who = { side: Side; userId: string; userName: string | null }

export const CLAIM_MS = 3 * 60_000

const takeable = (now: Date) => or(eq(catalogSitePieces.status, "waiting"), and(eq(catalogSitePieces.status, "approving"), lt(catalogSitePieces.leaseUntil, now)))

export async function claimPiece(d: Db, q: { id: string; brandId: string; now: Date; leaseMs?: number } & Who) {
  const [row] = await d
    .update(catalogSitePieces)
    .set({ status: "approving", decidedKind: q.side, decidedBy: q.userId, decidedByName: q.userName, decidedAt: q.now, leaseUntil: new Date(q.now.getTime() + (q.leaseMs ?? CLAIM_MS)), updatedAt: q.now })
    .where(and(eq(catalogSitePieces.id, q.id), eq(catalogSitePieces.brandId, q.brandId), takeable(q.now)))
    .returning()
  return row ?? null
}

/** Many at once (admin's Approve all): every waiting piece of the brand, for one side. */
export async function claimAllPieces(d: Db, q: { brandId: string; now: Date; leaseMs?: number; max?: number } & Who) {
  const ids = await d
    .select({ id: catalogSitePieces.id })
    .from(catalogSitePieces)
    .where(and(eq(catalogSitePieces.brandId, q.brandId), eq(catalogSitePieces.status, "waiting")))
    .orderBy(catalogSitePieces.firstSeenAt, catalogSitePieces.id)
    .limit(q.max ?? 50)
  const out: (typeof catalogSitePieces.$inferSelect)[] = []
  for (const { id } of ids) {
    const r = await claimPiece(d, { ...q, id })
    if (r) out.push(r)
  }
  return out
}

/** Keeps the claim alive while photos copy. */
export async function renewClaim(d: Db, q: { id: string; side: Side; now: Date; leaseMs?: number }) {
  await d
    .update(catalogSitePieces)
    .set({ leaseUntil: new Date(q.now.getTime() + (q.leaseMs ?? CLAIM_MS)) })
    .where(and(eq(catalogSitePieces.id, q.id), eq(catalogSitePieces.status, "approving"), eq(catalogSitePieces.decidedKind, q.side)))
}

/** Records the photos copied so far (a retried approval reuses them). */
export async function savePieceMedia(d: Db, q: { id: string; mediaIds: string[] }) {
  await d.update(catalogSitePieces).set({ mediaIds: q.mediaIds }).where(eq(catalogSitePieces.id, q.id))
}

/** Marks the piece approved; null when this side no longer holds it (the caller's transaction must roll back). */
export async function finishPiece(d: Db, q: { id: string; side: Side; now: Date; proposalId?: string | null; productId?: string | null; baseline?: Record<string, unknown> | null }) {
  const [row] = await d
    .update(catalogSitePieces)
    .set({ status: "approved", leaseUntil: null, reason: null, proposalId: q.proposalId ?? null, productId: q.productId ?? null, ...(q.baseline ? { baseline: q.baseline } : {}), updatedAt: q.now })
    .where(and(eq(catalogSitePieces.id, q.id), eq(catalogSitePieces.status, "approving"), eq(catalogSitePieces.decidedKind, q.side)))
    .returning()
  return row ?? null
}

/** Gives a claimed piece back (the approval failed): waiting again, with why. */
export async function releasePiece(d: Db, q: { id: string; side: Side; now: Date; error: string }) {
  await d
    .update(catalogSitePieces)
    .set({ status: "waiting", leaseUntil: null, decidedKind: null, decidedBy: null, decidedByName: null, decidedAt: null, reason: q.error.slice(0, 500), updatedAt: q.now })
    .where(and(eq(catalogSitePieces.id, q.id), eq(catalogSitePieces.status, "approving"), eq(catalogSitePieces.decidedKind, q.side)))
}

/** "Skip" / "Not this one": waiting → skipped, for good. Null when the other side got there first. */
export async function skipPiece(d: Db, q: { id: string; brandId: string; now: Date } & Who) {
  const [row] = await d
    .update(catalogSitePieces)
    .set({ status: "skipped", decidedKind: q.side, decidedBy: q.userId, decidedByName: q.userName, decidedAt: q.now, leaseUntil: null, reason: q.side === "brand" ? "The brand said not this one." : "Yard skipped it.", updatedAt: q.now })
    .where(and(eq(catalogSitePieces.id, q.id), eq(catalogSitePieces.brandId, q.brandId), takeable(q.now)))
    .returning()
  return row ?? null
}

/** Approvals a crash left behind (lease run out). */
export async function staleClaims(d: Db, now: Date, limit = 20) {
  return d
    .select()
    .from(catalogSitePieces)
    .where(and(eq(catalogSitePieces.status, "approving"), lt(catalogSitePieces.leaseUntil, now)))
    .orderBy(catalogSitePieces.leaseUntil)
    .limit(limit)
}

/** Waiting pieces per brand (the count badges). */
export async function waitingCount(d: Db, brandId: string) {
  const [r] = await d
    .select({ n: sql<number>`count(*)::int` })
    .from(catalogSitePieces)
    .where(and(eq(catalogSitePieces.brandId, brandId), eq(catalogSitePieces.status, "waiting")))
  return Number(r?.n ?? 0)
}
