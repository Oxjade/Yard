import "server-only"

/** Reports contract (§5.3): POST /api/reports, and the snapshot builder M's seed shares with live reports. */
export const IMPL: string = "F2-2026-11-06"
export { createReport, type ReportInput } from "./create"
export { buildSnapshot, freezeSubject, type Snapshot, type SnapshotMessage } from "./snapshot"
export const jobs = {}
