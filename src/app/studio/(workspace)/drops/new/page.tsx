import type { Metadata } from "next"
import { DropBuilder } from "@/components/studio/growth/drop-builder"

export const metadata: Metadata = { title: "Schedule a drop" }

export default function NewDropPage() {
  return <DropBuilder id={null} />
}
