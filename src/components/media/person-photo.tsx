"use client"

import { useState, type ReactNode } from "react"

/**
 * A person's profile photo filling the initials circle it sits in (the parent keeps its size,
 * shape and border, and adds overflow-hidden). Without a photo, or once it fails to load
 * (removed, no longer shared with this viewer, offline), the initials show instead. `alt` names the
 * photo ("Ada Obi"); leave it empty only where the person's name is already written beside it.
 */
export function PhotoOrInitials({ src, alt = "", children }: { src?: string | null; alt?: string; children: ReactNode }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src) return <>{children}</>
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} loading="lazy" decoding="async" draggable={false} onError={() => setFailed(src)} className="size-full rounded-[inherit] object-cover" />
}
