import type { Metadata } from "next"
import { DropsIndex } from "@/components/studio/growth/drops-index"

export const metadata: Metadata = { title: "Drops" }

export default function StudioDropsPage() {
  return <DropsIndex />
}
