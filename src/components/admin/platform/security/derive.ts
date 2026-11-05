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
 * Security state is derived from the audit log, so a revoked session or an MFA requirement
 * survives a reload exactly as the audit entry does.
 */
export function useSecurityState() {
  const audit = useAdmin((s) => s.audit)
  return useMemo(() => {
    const revoked = new Set(adminSessions.filter((s) => audit.some((a) => a.action === REVOKE_ACTION && a.target.includes(`(${s.id})`))).map((s) => s.id))
    const mfaRequired = new Set(adminTeam.filter((m) => !m.mfa && audit.some((a) => a.action === MFA_ACTION && a.target.startsWith(m.name))).map((m) => m.id))
    return { revoked, mfaRequired }
  }, [audit])
}
