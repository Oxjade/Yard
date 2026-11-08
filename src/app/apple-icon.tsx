import { yardIconImage } from "@/components/brand/yard-images"

/** The home-screen icon on iOS: the same square mark as icon.tsx, at Apple's 180px. */
export const size = { width: 180, height: 180 }
export const contentType = "image/png"

export default function AppleIcon() {
  return yardIconImage(size.width)
}
