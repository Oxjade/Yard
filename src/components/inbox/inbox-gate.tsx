"use client"

import { AuthPanel, type Invite } from "@/components/market/account/auth-panel"
import { useHydrated } from "@/hooks/use-hydrated"
import { useSession } from "@/lib/stores/session"
import { InboxSkeleton } from "./inbox-app"

/**
 * AccountGate for the Inbox: the same rules (skeleton until the saved session loads, a sign-in
 * invitation for guests), but its loading shape is the inbox's own (the 360 px list beside the
 * thread), so the first load shows one skeleton instead of an orders-style one replaced by ours.
 */
export function InboxGate({ invite, children }: { invite: Invite; children: React.ReactNode }) {
  const hydrated = useHydrated()
  const user = useSession((s) => s.user)
  if (!hydrated) return <InboxSkeleton />
  if (!user) return <AuthPanel {...invite} />
  return <>{children}</>
}
