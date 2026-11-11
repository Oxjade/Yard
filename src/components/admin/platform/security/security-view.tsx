"use client"

import { useId, useState } from "react"
import { DevicesIcon, FingerprintIcon, ListMagnifyingGlassIcon, UsersThreeIcon } from "@phosphor-icons/react"
import { StatCard } from "@/components/dashboard/insight/stat-card"
import { Reveal, RevealItem } from "@/components/admin/ui/motion"
import { Panel } from "@/components/admin/ui/panel"
import { Segmented, segmentedTabId } from "@/components/admin/ui/segmented"
import { adminTeam } from "@/lib/data/admin"
import { useServerSession } from "@/lib/session/use-server-session"
import { int } from "../format"
import { AdminPageHead, PanelRail, StatRow } from "@/components/admin/marketplace/page-head"
import { useAdminReady } from "../ready"
import { inPageTab, TabParam, writeTabParam } from "../tab-param"
import { AuditLog, useAuditFigures } from "./audit-log"
import { useSecurityState } from "./derive"
import { PolicyTable } from "./policy"
import { useRevoke } from "./revoke"
import { adminSessions, sensitivePolicy } from "./sample"
import { Sessions } from "./sessions"
import { TeamRoles } from "./team-roles"

const TABS = ["audit", "team", "sessions", "policy"] as const
type Tab = (typeof TABS)[number]

const description: Record<Tab, string> = {
  audit: "Every decision in the Control Center: who made it, why, and who approved it.",
  team: "Who is on the admin team, whether they use MFA, and what each role may do.",
  sessions: "Every device signed in to the Control Center right now.",
  policy: "Which actions need a written reason or a second admin, and who can take them.",
}

export function SecurityView() {
  const ready = useAdminReady()
  // Server entries plus this browser's legacy rows, from the log's own request (M2).
  const fig = useAuditFigures()
  const { revoked, mfaRequired } = useSecurityState()
  const { ask: revoke, dialog: revokeDialog } = useRevoke()
  const [chosen, setTab] = useState<Tab>("audit")
  const tid = useId()
  // Team, Sessions and Policy are sample data so far: demo and development only. Production (and
  // the moment before the session answers) shows the audit log alone, which is the server's.
  const sampleData = useServerSession((s) => s.sampleData === true)
  const tab: Tab = sampleData ? chosen : "audit"

  const noMfa = adminTeam.filter((m) => !m.mfa)
  const unaddressed = noMfa.filter((m) => !mfaRequired.has(m.id))
  // A pending revoke still counts as signed in: the device stays signed in until the auth service ends it.
  const signedIn = adminSessions.length
  const flagged = adminSessions.filter((s) => s.flag && !revoked.has(s.id))

  function choose(v: Tab) {
    setTab(v)
    writeTabParam(v)
  }
  const open = (v: Tab) => ({ onClickCapture: inPageTab(choose, v, "security-sections") })

  return (
    <Reveal ssrVisible className="@container grid gap-3">
      <TabParam values={TABS} onChange={setTab} />
      {sampleData ? (
        <AdminPageHead
          title="Security"
          description="Who did what and why, who can do what, who is signed in, and which actions need a reason or a second approver."
          note="Revokes and MFA requirements are recorded now and in the audit log, and take effect once the auth service is connected. Sessions are sample data."
        />
      ) : (
        <AdminPageHead live title="Security" description="Every decision in the Control Center: who made it, why, and who approved it." />
      )}

      <StatRow label="Security figures">
        <RevealItem className="min-w-0" {...open("audit")}>
          <StatCard surface="admin" icon={ListMagnifyingGlassIcon} label="Audit entries" value={fig.entries} format={int} hint={ready && fig.ready ? `${fig.withApprover} with a second approver` : undefined} href="?tab=audit#security-sections" hrefLabel="Open the audit log" ready={ready && fig.ready} className="h-full" />
        </RevealItem>
        {sampleData ? (
        <>
        <RevealItem className="min-w-0" {...open("team")}>
          <StatCard surface="admin" variant={ready && unaddressed.length ? "brand" : "default"} icon={FingerprintIcon} label="Without MFA" value={noMfa.length} format={int} hint={ready ? (mfaRequired.size ? `${mfaRequired.size} required to set it up` : `Of ${adminTeam.length} on the team`) : undefined} href="?tab=team#security-sections" hrefLabel="Open team and roles" ready={ready} className="h-full" />
        </RevealItem>
        <RevealItem className="min-w-0" {...open("sessions")}>
          <StatCard surface="admin" icon={DevicesIcon} label="Active sessions" value={signedIn} format={int} hint={ready ? [flagged.length ? `${flagged.length} to check` : revoked.size ? null : "None flagged", revoked.size ? `${revoked.size} ${revoked.size === 1 ? "revoke" : "revokes"} pending` : null].filter(Boolean).join(", ") : undefined} href="?tab=sessions#security-sections" hrefLabel="Open sessions" ready={ready} className="h-full" />
        </RevealItem>
        <RevealItem className="min-w-0" {...open("policy")}>
          <StatCard surface="admin" icon={UsersThreeIcon} label="Second approver" value={sensitivePolicy.filter((p) => p.approver).length} format={int} hint={`Of ${sensitivePolicy.length} sensitive actions`} href="?tab=policy#security-sections" hrefLabel="Open the sensitive-action policy" ready={ready} className="h-full" />
        </RevealItem>
        </>
        ) : null}
      </StatRow>

      <Panel id="security-sections" title={sampleData ? "Audit, team, sessions and policy" : "Audit log"} description={description[tab]} className="scroll-mt-24 rounded-[20px]" bodyClassName="px-0 pb-0 md:px-0 md:pb-0">
        {sampleData ? (
        <PanelRail value={tab}>
          <Segmented
            label="Security sections"
            size="sm"
            value={tab}
            onChange={choose}
            loading={!ready}
            idBase={tid}
            panelId={`${tid}-panel`}
            options={[
              { value: "audit", label: "Audit log" },
              { value: "team", label: "Team", ...(unaddressed.length ? { count: unaddressed.length } : {}) },
              { value: "sessions", label: "Sessions", ...(flagged.length ? { count: flagged.length } : {}) },
              { value: "policy", label: "Policy" },
            ]}
          />
        </PanelRail>
        ) : null}
        <div id={`${tid}-panel`} role={sampleData ? "tabpanel" : undefined} aria-labelledby={sampleData ? segmentedTabId(tid, tab) : undefined} className="border-t border-[var(--admin-hairline)] px-4 pt-4 pb-4 md:px-5 md:pb-5">
          {tab === "audit" ? (
            <AuditLog ready={ready} />
          ) : tab === "team" ? (
            <TeamRoles ready={ready} revoked={revoked} mfaRequired={mfaRequired} onRevoke={(s, o) => revoke(s, o)} />
          ) : tab === "sessions" ? (
            <Sessions ready={ready} revoked={revoked} onRevoke={(s) => revoke(s)} />
          ) : (
            <PolicyTable />
          )}
        </div>
      </Panel>
      {revokeDialog}
    </Reveal>
  )
}
