import { shareImageAlt, shareImageSize, yardShareImage } from "@/components/brand/yard-images"

/** The default share image: the acid Yard logo on obsidian. Pages with their own image keep it. */
export const alt = shareImageAlt
export const size = shareImageSize
export const contentType = "image/png"

export default function OpengraphImage() {
  return yardShareImage()
}
