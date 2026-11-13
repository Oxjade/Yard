"use client"

import { useMemo } from "react"
import { usePageSampleDataState } from "@/components/sample/sample-data-context"
import { auditLog, type AuditEntry } from "@/lib/data/admin"
import { useServerSession } from "@/lib/session/use-server-session"
import { useAdmin } from "@/lib/stores/admin"

/**
 * The demo switch for Control Center pages that keep sample rows in the browser's admin store
 * (sample brands, accounts, moderation cases, payouts, refunds). `on` is true only once the
 * switch is known to be on, so production (switch off) never shows a sample row, not even for a
 * moment while GET /api/session answers. `known` says whether that answer is in (a failed session
 * check counts as known and off), so a page can hold its skeleton until then instead of flashing
 * an empty state in the demo.
 */
export function useAdminSampleData(): { known: boolean; on: boolean } {
  const state = usePageSampleDataState()
  const failed = useServerSession((s) => s.status === "error")
  return { known: state !== null || failed, on: state === true }
}

/** `rows` while sample data is on, else one stable empty list. */
export function sampleOnly<T>(on: boolean, rows: T[]): T[] {
  return on ? rows : (NONE as T[])
}
const NONE: unknown[] = []

const SEEDED_AUDIT = new Set(auditLog.map((e) => e.id))

/**
 * This browser's audit entries for a detail sheet: with sample data on, all of them; off, only the
 * ones recorded here (notes and decisions taken in this browser), never the made-up sample entries
 * the store starts with, which could otherwise match a real brand or account by name.
 */
export function useAdminBrowserAudit(): AuditEntry[] {
  const { on } = useAdminSampleData()
  const audit = useAdmin((s) => s.audit)
  return useMemo(() => (on ? audit : audit.filter((e) => !SEEDED_AUDIT.has(e.id))), [on, audit])
}
