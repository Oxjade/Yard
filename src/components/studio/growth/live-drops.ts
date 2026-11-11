import { api } from "@/lib/api/client"
import type { StudioDropDto } from "@/lib/api/drops"

type StudioDropPage = { items: StudioDropDto[]; nextCursor: string | null }

export const studioDropsKey = (brandId: string) => `studio.drops:${brandId}`

export async function loadStudioDrops() {
  const items: StudioDropDto[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await api<StudioDropPage>("/api/drops/studio", { query: { status: "all", limit: 50, cursor } })
    items.push(...page.items)
    if (!page.nextCursor || (cursor && page.nextCursor === cursor)) return items
    cursor = page.nextCursor
  }
}