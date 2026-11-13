import { Suspense } from "react"
import type { Metadata } from "next"
import { AdminSignIn, AdminSignInSkeleton } from "./admin-sign-in"

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } }

/**
 * The Control Center's own sign-in page: bare and centred, without the admin navigation (the
 * admin shell renders this path without itself). The search params (next) are read on the
 * client, inside Suspense, so the page prerenders as its skeleton.
 */
export default function AdminSignInPage() {
  return (
    <Suspense fallback={<AdminSignInSkeleton />}>
      <AdminSignIn />
    </Suspense>
  )
}
