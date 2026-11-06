"use client"

import { useState } from "react"

/**
 * The last non-empty value: a detail sheet keeps showing its record while it animates
 * closed, after the URL (or the selection) has already let go of it.
 */
export function useLast<T>(value: T | null | undefined): T | null {
  const [last, setLast] = useState<T | null>(value ?? null)
  if (value != null && value !== last) setLast(value)
  return value ?? last
}
