import type { Metadata } from "next"
import type { ReactNode } from "react"

/** Private to the signed-in person: never indexed (the X-Robots-Tag header in next.config.ts says the same). */
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default function Layout({ children }: { children: ReactNode }) {
  return children
}
