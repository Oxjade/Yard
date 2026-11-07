import { adminUser } from "@/lib/data/admin"
import type { AdminPermission } from "@/lib/permissions"
import { secondApproverLabel } from "../advertising/placements"

/**
 * Security sample data the data layer doesn't model yet: active admin sessions and the
 * sensitive-action policy. Sessions are labelled as sample data on screen; revoking one
 * writes a real audit entry through useAdmin.
 */

export type AdminSession = {
  id: string
  memberId: string
  device: string
  browser: string
  location: string
  ip: string
  signedInAt: string
  lastActiveAt: string
  /** Something the owner should look at: a new location, an old browser. */
  flag?: string
}

export const CURRENT_SESSION_ID = "ses_k1"

export const adminSessions: AdminSession[] = [
  { id: CURRENT_SESSION_ID, memberId: adminUser.id, device: "MacBook Pro", browser: "Safari 18", location: "Lagos, Nigeria", ip: "102.89.x.x", signedInAt: "2026-11-05T08:12:00Z", lastActiveAt: "2026-11-05T12:00:00Z" },
  { id: "ses_d4", memberId: "adm_2", device: "Windows PC", browser: "Chrome 131", location: "Lagos, Nigeria", ip: "102.89.x.x", signedInAt: "2026-11-05T07:40:00Z", lastActiveAt: "2026-11-05T11:46:00Z" },
  { id: "ses_a2", memberId: "adm_3", device: "iPhone 15", browser: "Safari", location: "Abuja, Nigeria", ip: "105.112.x.x", signedInAt: "2026-11-04T18:05:00Z", lastActiveAt: "2026-11-05T10:02:00Z" },
  { id: "ses_s1", memberId: "adm_4", device: "MacBook Air", browser: "Chrome 131", location: "London, United Kingdom", ip: "84.12.x.x", signedInAt: "2026-11-05T09:15:00Z", lastActiveAt: "2026-11-05T09:58:00Z" },
  { id: "ses_s2", memberId: "adm_4", device: "Linux desktop", browser: "Firefox 115", location: "Bucharest, Romania", ip: "185.53.x.x", signedInAt: "2026-11-05T03:21:00Z", lastActiveAt: "2026-11-05T03:47:00Z", flag: "New country, no MFA on this account" },
  { id: "ses_l1", memberId: "adm_6", device: "ThinkPad X1", browser: "Firefox 132", location: "Berlin, Germany", ip: "91.64.x.x", signedInAt: "2026-11-05T06:30:00Z", lastActiveAt: "2026-11-05T11:35:00Z" },
  { id: "ses_n1", memberId: "adm_5", device: "Pixel 8", browser: "Chrome 131", location: "Lagos, Nigeria", ip: "102.89.x.x", signedInAt: "2026-11-04T08:55:00Z", lastActiveAt: "2026-11-04T17:20:00Z" },
]

export type Policy = {
  action: string
  /** The permission in adminRoles that grants it; owners can always act. Null means owners only. */
  permission: string | null
  reason: boolean
  /** When a second admin has to approve, in words; null when nobody else needs to. */
  approver: string | null
  note?: string
  /**
   * The v2 server permission behind the action (§2.4), when Yard's server enforces it. The table's
   * "Who can do it" still reads `permission` from the legacy role list, so v2 rows name the legacy
   * permission held by the same roles.
   */
  serverPermission?: AdminPermission
}

export const sensitivePolicy: Policy[] = [
  { action: "Verify or reject a brand", permission: "review brands", reason: true, approver: null },
  { action: "Remove a listing", permission: "moderate products", reason: true, approver: null },
  { action: "Approve a payout", permission: "approve payouts", reason: true, approver: "Over $5,000, or after a bank change" },
  { action: "Issue a refund", permission: "issue refunds", reason: true, approver: "Over $1,000", note: "Support can request a refund; finance issues it." },
  { action: "Adjust a brand's ledger", permission: "approve adjustments", reason: true, approver: "Always; the approver can't be the requester", note: "Balances are never edited. An adjustment is a new ledger entry." },
  { action: "Approve or reject a campaign", permission: "review campaigns", reason: true, approver: secondApproverLabel, note: "Under that, one admin decides." },
  { action: "Change ad pricing", permission: "edit pricing", reason: true, approver: null, note: "Applies to new bookings only." },
  { action: "Replay a payment webhook", permission: "replay webhooks", reason: true, approver: null, note: "Only events with a verified signature." },
  { action: "Retry a background job", permission: "retry jobs", reason: false, approver: null },
  { action: "Revoke a session", permission: null, reason: true, approver: null },
  { action: "Require MFA for a member", permission: null, reason: true, approver: null },
  // v2: enforced by Yard's server (§8), each with one audit row.
  { action: "Remove a message", permission: "moderate products", reason: true, approver: null, note: "Both people in the conversation see “Message removed by Yard”; the sender sees your reason.", serverPermission: "messages.moderate" },
  { action: "Lock a conversation", permission: "moderate products", reason: true, approver: null, note: "Nobody can send in it any more; both sides keep reading it.", serverPermission: "messages.moderate" },
  { action: "Remove a post", permission: "moderate products", reason: true, approver: null, note: "The post is locked: the brand can delete it but not show it again.", serverPermission: "content.moderate" },
  { action: "Remove a place or event", permission: "moderate products", reason: true, approver: null, note: "It leaves Yard Around and is locked for the brand.", serverPermission: "places.moderate" },
  { action: "Pause a brand's social feed", permission: "moderate products", reason: true, approver: null, note: "Engineering can pause it too. The brand sees your reason.", serverPermission: "social.manage" },
  { action: "Freeze a brand on Charts", permission: "moderate products", reason: true, approver: "Always; the approver can't be the requester", note: "The brand is told it's paused because of unusual activity, never the reason.", serverPermission: "charts.freeze" },
  { action: "Restrict messaging, uploads or reports", permission: "restrict accounts", reason: true, approver: null, note: "For 24 hours, 7 days or 30 days. The account sees your reason.", serverPermission: "users.restrict" },
  // One row for account and brand status (it replaces the legacy "Suspend a brand" and "Restrict or
  // suspend an account" rows): both are server decisions now, and no second approval is enforced.
  { action: "Restrict or suspend an account or brand", permission: "restrict accounts", reason: true, approver: null, note: "Suspension signs every session out at once and blocks sign-in. No second admin is asked yet, for a brand either; brands need the Trust & safety role.", serverPermission: "users.restrict" },
  { action: "Edit holidays", permission: "retry jobs", reason: true, approver: null, note: "Delivery estimates for that country change from their next calculation.", serverPermission: "holidays.edit" },
]
