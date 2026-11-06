import "server-only"

/**
 * Inbox contract (§1.8). Cluster I's implementation: the bodies live in service.ts. Other
 * modules (M's decisions) call these inside their own withTx; both join it through db().
 */
export const IMPL: string = "I-2026-11-06"

export { publishSystemNotice, releaseHeldMessage } from "./service"

export const jobs = {}
