import fashion from "../../../public/media/fashion/manifest.json"
import objects from "../../../public/media/objects/manifest.json"
import lifestyle from "../../../public/media/lifestyle/manifest.json"
import type { ImageAsset } from "./types"

/**
 * Placeholder photography (Unsplash licence), curated into /public/media/<group>/.
 * Data refers to images by "group/category/index" so the catalogue does not depend on
 * file names; indexes wrap around when a category has fewer photos than requested.
 */

type Entry = {
  file: string
  unsplashId?: string
  subject: string
  category: string
  orientation: string
  width: number
  height: number
  tone?: string
  use?: string
}

const groups: Record<string, Entry[]> = {
  fashion: fashion as Entry[],
  objects: objects as Entry[],
  lifestyle: lifestyle as Entry[],
}

const byCategory = new Map<string, { group: string; entry: Entry }[]>()
for (const [group, entries] of Object.entries(groups)) {
  for (const entry of entries) {
    const key = `${group}/${entry.category}`
    const list = byCategory.get(key) ?? []
    list.push({ group, entry })
    byCategory.set(key, list)
  }
}

function sentence(s: string) {
  const t = s.trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** img("objects/sneakers/2") → ImageAsset. Falls back across the group if a category is empty. */
export function img(ref: string, alt?: string): ImageAsset {
  const [group, category, indexRaw] = ref.split("/")
  const index = Number(indexRaw ?? 0)
  let list = byCategory.get(`${group}/${category}`)
  if (!list || list.length === 0) {
    list = (groups[group] ?? []).map((entry) => ({ group, entry }))
  }
  if (list.length === 0) {
    return { src: "/media/missing.svg", alt: alt ?? "", width: 1200, height: 1500 }
  }
  const { entry } = list[index % list.length]
  return {
    src: `/media/${group}/${entry.file}`,
    alt: alt ?? sentence(entry.subject),
    width: entry.width,
    height: entry.height,
  }
}

export function countIn(group: string, category: string) {
  return byCategory.get(`${group}/${category}`)?.length ?? 0
}
