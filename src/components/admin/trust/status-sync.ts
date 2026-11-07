"use client"

import { useEffect } from "react"
import { adminKeys, getStatuses } from "@/lib/api/admin"
import { useApi } from "@/lib/api/use-api"
import type { BrandReviewStatus, PlatformUser } from "@/lib/data/admin"
import { useServerSession } from "@/lib/session/use-server-session"
import { useAdmin } from "@/lib/stores/admin"

/**
 * Account and brand status live on the server (§1.11). The Users and Brands pages read this
 * browser's store, so on load they mirror the server's statuses into it (status only, no browser
 * audit entry), and a decision taken anywhere else (another admin, curl) shows here too.
 */
export function useMirrorServerStatuses(kind: "user" | "brand", ids: string[]) {
  const admin = useServerSession((s) => s.admin)
  const key = ids.join(",")
  const q = useApi(admin && ids.length ? adminKeys.statuses(kind, key) : null, () => getStatuses(kind, key.split(",")), { refreshInterval: 60_000 })
  const statuses = q.data?.statuses
  useEffect(() => {
    if (!statuses) return
    if (kind === "user")
      useAdmin.setState((s) => {
        const changed = s.users.some((u) => statuses[u.id] && statuses[u.id] !== u.status)
        return changed ? { users: s.users.map((u) => (statuses[u.id] && statuses[u.id] !== u.status ? { ...u, status: statuses[u.id] as PlatformUser["status"] } : u)) } : s
      })
    else
      useAdmin.setState((s) => {
        const changed = s.applications.some((a) => a.brandId && statuses[a.brandId] && statuses[a.brandId] !== a.status)
        return changed ? { applications: s.applications.map((a) => (a.brandId && statuses[a.brandId] && statuses[a.brandId] !== a.status ? { ...a, status: statuses[a.brandId] as BrandReviewStatus } : a)) } : s
      })
  }, [statuses, kind])
  // For brands: what Reinstate would restore for each restricted or suspended one (the server reads it).
  return { synced: !!statuses, error: q.error, reinstateTo: q.data?.reinstateTo ?? {} }
}
