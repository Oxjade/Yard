import type { Metadata } from "next"
import { SocialStudio } from "@/components/studio/social/social-studio"

export const metadata: Metadata = { title: "Social" }

/** Studio › Social (§6.1): a static shell; everything loads over the API behind the session gate. */
export default function StudioSocialPage() {
  return <SocialStudio />
}
