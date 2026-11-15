"use client"

import { useState, type ReactNode } from "react"

/**
 * A person's profile photo filling the initials circle it sits in (the parent keeps its size,
 * shape and border, and adds overflow-hidden). Without a photo, or once it fails to load
 * (removed, no longer shared with this viewer, offline), the initials show instead.
 */
export function PhotoOrInitials({ src, children }: { src?: string | null; children: ReactNode }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src) return <>{children}</>
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(src)} className="size-full rounded-[inherit] object-cover" />
}
