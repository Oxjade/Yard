import { shareImageAlt, shareImageSize, yardShareImage } from "@/components/brand/yard-images"

/** The default X/Twitter card image: the same as the Open Graph image. */
export const alt = shareImageAlt
export const size = shareImageSize
export const contentType = "image/png"

export default function TwitterImage() {
  return yardShareImage()
}
