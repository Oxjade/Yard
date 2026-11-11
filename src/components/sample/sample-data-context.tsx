"use client"

import { createContext, useContext } from "react"
import { useServerSession } from "@/lib/session/use-server-session"

/**
 * The demo switch as the page's server render read it (request time, after connection()), so a
 * page that branches on it renders the right version straight away instead of waiting for
 * /api/session. Pages without the provider fall back to the session's flag (off until it answers).
 */
const SampleDataContext = createContext<boolean | null>(null)

export function SampleDataProvider({ value, children }: { value: boolean; children: React.ReactNode }) {
  return <SampleDataContext.Provider value={value}>{children}</SampleDataContext.Provider>
}

/** True when sample-data screens are on: the request-time flag when a page provides it, else /api/session's. */
export function usePageSampleData(): boolean {
  const fromServer = useContext(SampleDataContext)
  const fromSession = useServerSession((s) => s.sampleData === true)
  return fromServer ?? fromSession
}
