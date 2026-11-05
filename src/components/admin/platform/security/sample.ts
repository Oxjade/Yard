import { adminUser } from "@/lib/data/admin"
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
}

export const sensitivePolicy: Policy[] = [
  { action: "Verify or reject a brand", permission: "review brands", reason: true, approver: null },
  { action: "Suspend a brand", permission: "suspend brands", reason: true, approver: "Always, by an owner", note: "Restricting a brand only needs a reason." },
  { action: "Restrict or suspend an account", permission: "restrict accounts", reason: true, approver: null },
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
]
