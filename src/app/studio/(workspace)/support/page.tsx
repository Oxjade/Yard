import type { Metadata } from "next"
import { StudioSupport } from "@/components/studio/support/studio-support"

export const metadata: Metadata = { title: "Yard Support" }

/** Studio › Yard Support: the brand's conversation with the Yard team. */
export default function StudioSupportPage() {
  return <StudioSupport />
}
