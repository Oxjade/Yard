import "server-only"
import type { AdminActor } from "../auth/dal"
import { NotImplemented } from "../http/errors"
import type { AdminPermission } from "@/lib/permissions"

/** Moderation contract (F1 draft; cluster M replaces the bodies and IMPL in wave 2). */
export const IMPL: string = "stub"

/**
 * One spelling (§8.2): kebab-case in URLs, camelCase handlers. An action not in this map is 404.
 * Brand subjects of the account actions need brands.restrict instead (checked by M).
 */
export const decisionActions = {
  "decide-report": { handler: "decideReport", permission: "messages.moderate" },
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
  "add-restriction": { handler: "addRestriction", permission: "users.restrict" },
  "lift-restriction": { handler: "liftRestriction", permission: "users.restrict" },
  "set-brand-status": { handler: "setBrandStatus", permission: "brands.restrict" },
  "dismiss-abuse-alert": { handler: "dismissAbuseAlert", permission: "abuse.view" },
  "export-audit": { handler: "exportAudit", permission: "audit.view" },
} as const satisfies Record<string, { handler: string; permission: AdminPermission }>

export type DecisionAction = keyof typeof decisionActions

/** Runs one decision in one withTx: state change + writeAudit + in-transaction side effects (§8.2). */
export async function runDecision(action: DecisionAction, actor: AdminActor, body: unknown): Promise<{ item: unknown; audit: unknown }> {
  void actor
  void body
  throw new NotImplemented(`moderation.${decisionActions[action].handler}`)
}

export const jobs = {}
