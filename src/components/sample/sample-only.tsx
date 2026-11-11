"use client"

import { useSampleData } from "@/lib/session/use-server-session"

/**
 * Renders its children only when sample-data screens are on (the demo switch, from /api/session).
 * Production, and the moment before the session answers, render nothing, so a link to a sample
 * screen never flashes in production.
 */
export function SampleOnly({ children }: { children: React.ReactNode }) {
  return useSampleData() ? children : null
}
