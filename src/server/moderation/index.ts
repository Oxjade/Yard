import "server-only"
import type { AdminActor } from "../auth/dal"
import { eq, sql } from "drizzle-orm"
import { db, withTx } from "../db"
import { auditLog as auditTable } from "../db/schema"
import { forbidden } from "../http/errors"
import { canAdmin, needsRole, type AdminPermission } from "@/lib/permissions"
import { decisionBodies } from "@/lib/api/contracts/admin"
import * as abuse from "./abuse"
import * as auditLog from "./audit-log"
import * as chartsMod from "./charts"
import * as content from "./content"
import * as delivery from "./delivery"
import * as messagesMod from "./messages"
import * as status from "./status"
import { priorNotes, type DecisionCtx } from "./shared"

/** Moderation (cluster M, §8). Decisions, queues and the audit feed for the Control Center. */
export const IMPL: string = "M-2026-11-06"

/**
 * One spelling (§8.2): kebab-case in URLs, camelCase handlers. An action not in this map is 404.
 * `anyOf` lists the permissions that can take the action at all; the handler then checks the one
 * the subject needs (a brand subject needs brands.restrict; a post report needs content.moderate).
 */
export const decisionActions = {
  "decide-report": { handler: "decideReport", permission: "messages.moderate", anyOf: ["messages.view_reports", "messages.moderate", "content.moderate", "places.moderate"] },
  "remove-message": { handler: "removeMessage", permission: "messages.moderate" },
  "release-held-message": { handler: "releaseHeldMessage", permission: "messages.moderate" },
  "lock-conversation": { handler: "lockConversation", permission: "messages.moderate" },
  "set-post-moderation": { handler: "setPostModeration", permission: "content.moderate" },
  "set-place-moderation": { handler: "setPlaceModeration", permission: "places.moderate" },
  "set-event-moderation": { handler: "setEventModeration", permission: "places.moderate" },
  "retry-social-sync": { handler: "retrySocialSync", permission: "social.manage" },
  "force-disconnect-social": { handler: "forceDisconnectSocial", permission: "social.manage" },
  "set-social-paused": { handler: "setSocialPaused", permission: "social.manage" },
  "decide-chart-flag": { handler: "decideChartFlag", permission: "charts.review" },
  "recompute-charts": { handler: "recomputeCharts", permission: "charts.review" },
  "request-chart-freeze": { handler: "requestChartFreeze", permission: "charts.freeze" },
  "approve-chart-freeze": { handler: "approveChartFreeze", permission: "charts.freeze" },
  "lift-chart-freeze": { handler: "liftChartFreeze", permission: "charts.freeze" },
  "contact-brand-about-delivery": { handler: "contactBrandAboutDelivery", permission: "shipping.resolve" },
  "resolve-delivery-issue": { handler: "resolveDeliveryIssue", permission: "shipping.resolve" },
  "escalate-delivery-issue": { handler: "escalateDeliveryIssue", permission: "shipping.view" },
  "add-holiday": { handler: "addHoliday", permission: "holidays.edit" },
  "remove-holiday": { handler: "removeHoliday", permission: "holidays.edit" },
  "set-user-status": { handler: "setUserStatus", permission: "users.restrict" },
  "add-restriction": { handler: "addRestriction", permission: "users.restrict", anyOf: ["users.restrict", "brands.restrict"] },
  "lift-restriction": { handler: "liftRestriction", permission: "users.restrict", anyOf: ["users.restrict", "brands.restrict"] },
  "set-brand-status": { handler: "setBrandStatus", permission: "brands.restrict" },
  "dismiss-abuse-alert": { handler: "dismissAbuseAlert", permission: "abuse.view" },
  "export-audit": { handler: "exportAudit", permission: "audit.view" },
} as const satisfies Record<string, { handler: string; permission: AdminPermission; anyOf?: readonly AdminPermission[] }>

export type DecisionAction = keyof typeof decisionActions

export const isDecisionAction = (a: string): a is DecisionAction => Object.prototype.hasOwnProperty.call(decisionActions, a)

type Handler = (ctx: DecisionCtx, body: never) => Promise<{ item: unknown; audit: unknown }>

const handlers: Record<(typeof decisionActions)[DecisionAction]["handler"], Handler> = {
  decideReport: messagesMod.decideReport,
  removeMessage: messagesMod.removeMessage,
  releaseHeldMessage: messagesMod.releaseHeld,
  lockConversation: messagesMod.lockConversation,
  setPostModeration: content.setPostModeration,
  setPlaceModeration: content.setPlaceModeration,
  setEventModeration: content.setEventModeration,
  retrySocialSync: content.retrySocialSync,
  forceDisconnectSocial: content.forceDisconnectSocial,
  setSocialPaused: content.setSocialPaused,
  decideChartFlag: chartsMod.decideChartFlag,
  recomputeCharts: chartsMod.recomputeCharts,
  requestChartFreeze: chartsMod.requestChartFreeze,
  approveChartFreeze: chartsMod.approveChartFreeze,
  liftChartFreeze: chartsMod.liftChartFreeze,
  contactBrandAboutDelivery: delivery.contactBrand,
  resolveDeliveryIssue: delivery.resolveIssue,
  escalateDeliveryIssue: delivery.escalateIssue,
  addHoliday: delivery.addHoliday,
  removeHoliday: delivery.removeHoliday,
  setUserStatus: status.setUserStatus,
  addRestriction: abuse.addRestriction,
  liftRestriction: abuse.liftRestriction,
  setBrandStatus: status.setBrandStatus,
  dismissAbuseAlert: abuse.dismissAlert,
  exportAudit: auditLog.exportAudit,
}

/** The permission check that happens before the body is read: 403 when no role path allows it. */
export function assertMayDecide(action: DecisionAction, actor: AdminActor) {
  const def = decisionActions[action]
  const options: readonly AdminPermission[] = "anyOf" in def ? def.anyOf : [def.permission]
  if (!options.some((p) => canAdmin(actor.role, p))) throw forbidden(`${needsRole(def.permission)}.`)
}

/**
 * Runs one decision (§8.2): permission, strict body, then ONE withTx holding the state change, its
 * single audit row and the in-transaction side effects. Publishes and notifications reach their
 * listeners after commit. Returns { item: <DTO>, audit: <AuditEntryDto> }.
 */
export async function runDecision(action: DecisionAction, actor: AdminActor, rawBody: unknown, ipHash: string | null = null, kit = false) {
  assertMayDecide(action, actor)
  const body = decisionBodies[action].parse(rawBody ?? {})
  const handler = handlers[decisionActions[action].handler]
  const ctx = { actor, ipHash, kit }
  if (process.env.NODE_ENV === "production") return withTx(() => handler(ctx, body as never))
  // Development: the notifications this decision overwrites are recorded in its audit meta
  // (`priorNotes`), so the dev cleanup can put them back rather than delete them (shared.ts).
  return priorNotes.run([], () =>
    withTx(async () => {
      const out = await handler(ctx, body as never)
      const notes = priorNotes.getStore() ?? []
      const auditId = (out.audit as { id?: unknown } | null)?.id
      // Always written (even empty), so the cleanup knows this decision's notifications were recorded.
      if (typeof auditId === "string") {
        const d = await db()
        await d
          .update(auditTable)
          .set({ meta: sql`coalesce(${auditTable.meta}, '{}'::jsonb) || ${JSON.stringify({ priorNotes: notes })}::jsonb` })
          .where(eq(auditTable.id, auditId))
      }
      return out
    }),
  )
}

export { queueCountsFor, allQueueCounts, queuePermission } from "./counts"
export { listMessages, messageCase, viewEvidence, viewHeld } from "./messages"
export { listPosts, listPlaces, listIntegrations, contentCounts } from "./content"
export { chartsOverview, listFlags, flagDetail, sponsoredList } from "./charts"
export { listDelivery, listHolidays } from "./delivery"
export { listAbuse, abuseRowFor, listRestrictions } from "./abuse"
export { listAudit } from "./audit-log"
export { statusesFor, reinstateTargets } from "./status"

export const jobs = {}
