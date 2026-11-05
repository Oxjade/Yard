"use client"

import { useState } from "react"
import { MetricTile } from "@/components/dashboard/metric-tile"
import { PageHeader, SampleDataNote } from "@/components/dashboard/page-header"
import { adminTeam } from "@/lib/data/admin"
import { useAdmin } from "@/lib/stores/admin"
import { int } from "../format"
import { SectionTabs } from "../section-tabs"
import { AuditLog } from "./audit-log"
import { useSecurityState } from "./derive"
import { PolicyTable } from "./policy"
import { adminSessions, sensitivePolicy } from "./sample"
import { Sessions } from "./sessions"
import { TeamRoles } from "./team-roles"

type Tab = "audit" | "team" | "sessions" | "policy"

export function SecurityView() {
  const audit = useAdmin((s) => s.audit)
  const { revoked, mfaRequired } = useSecurityState()
  const [tab, setTab] = useState<Tab>("audit")

  const noMfa = adminTeam.filter((m) => !m.mfa).length
  const unaddressed = adminTeam.filter((m) => !m.mfa && !mfaRequired.has(m.id)).length
  const active = adminSessions.filter((s) => !revoked.has(s.id))
  const flagged = active.filter((s) => s.flag).length
  const approvals = audit.filter((a) => a.approvedBy).length

  return (
    <div className="grid gap-5">
      <PageHeader title="Security" description="Who did what and why, who can do what, who is signed in, and which actions need a reason or a second approver.">
        <SampleDataNote className="mt-2" />
      </PageHeader>

      <section aria-label="Security figures" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <MetricTile density="dense" label="Audit entries" value={audit.length} format={int} hint={`${approvals} with a second approver`} />
        <MetricTile density="dense" label="Admins without MFA" value={noMfa} format={int} highlight={unaddressed > 0} hint={mfaRequired.size ? `${mfaRequired.size} asked to set it up` : `of ${adminTeam.length} on the team`} />
        <MetricTile density="dense" label="Active sessions" value={active.length} format={int} highlight={flagged > 0} hint={flagged ? `${flagged} to check` : "none flagged"} />
        <MetricTile density="dense" label="Need a second approver" value={sensitivePolicy.filter((p) => p.approver).length} format={int} hint={`of ${sensitivePolicy.length} sensitive actions`} />
      </section>

      <section aria-labelledby="security-sections-title" className="overflow-hidden rounded-lg border border-line-soft bg-card">
        <h2 id="security-sections-title" className="sr-only">Audit log, team, sessions and policy</h2>
        <SectionTabs
          label="Security sections"
          value={tab}
          onValueChange={setTab}
          tabs={[
            { value: "audit", label: "Audit log", short: "Audit", count: audit.length },
            { value: "team", label: "Team and roles", short: "Team", count: adminTeam.length, urgent: unaddressed > 0 },
            { value: "sessions", label: "Sessions", count: active.length, urgent: flagged > 0 },
            { value: "policy", label: "Sensitive actions", short: "Policy", count: sensitivePolicy.length },
          ]}
        >
          {tab === "audit" ? <AuditLog /> : tab === "team" ? <TeamRoles /> : tab === "sessions" ? <Sessions /> : <PolicyTable />}
        </SectionTabs>
      </section>
    </div>
  )
}
