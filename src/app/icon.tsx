import { yardIconImage } from "@/components/brand/yard-images"

/** The app icon: the acid Yard logo on an obsidian square (see yard-images). */
const sizes = [32, 192, 512]

export function generateImageMetadata() {
  return sizes.map((s) => ({ id: String(s), contentType: "image/png", size: { width: s, height: s } }))
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const s = Number(await id)
  return yardIconImage(sizes.includes(s) ? s : 32)
}
