"use client"

import { useMemo } from "react"
import { adminTeam } from "@/lib/data/admin"
import { useAdmin } from "@/lib/stores/admin"
import { adminSessions } from "./sample"

export const REVOKE_ACTION = "Revoked session"
export const MFA_ACTION = "Required MFA"

export type TeamMember = (typeof adminTeam)[number]
export const memberById = new Map<string, TeamMember>(adminTeam.map((m) => [m.id, m]))

/**
 * Revoked sessions and MFA requirements recorded in this browser: the store's own record,
 * plus audit entries written before it kept one, so a reload shows exactly what was recorded.
 */
export function useSecurityState() {
  const audit = useAdmin((s) => s.audit)
  const ops = useAdmin((s) => s.ops)
  return useMemo(() => {
    const revoked = new Set(adminSessions.filter((s) => ops.revokedSessions.includes(s.id) || audit.some((a) => a.action === REVOKE_ACTION && (a.subjectId === s.id || a.target.includes(`(${s.id})`)))).map((s) => s.id))
    const mfaRequired = new Set(adminTeam.filter((m) => !m.mfa && (ops.mfaRequired.includes(m.id) || audit.some((a) => a.action === MFA_ACTION && (a.subjectId === m.id || a.target.startsWith(m.name))))).map((m) => m.id))
    return { revoked, mfaRequired }
  }, [audit, ops])
}
