import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { DevGallery } from "./gallery"

export const metadata: Metadata = { title: "Shared components (dev)", robots: { index: false, follow: false } }

/** Development-only gallery of F1's shared v2 components (§9.1). 404 in production. */
export default function DevComponentsPage() {
  if (process.env.NODE_ENV === "production") notFound()
  return <DevGallery />
}
