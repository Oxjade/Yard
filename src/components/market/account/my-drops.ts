import { api } from "@/lib/api/client"
import type { PublicDropDto } from "@/lib/api/drops"

export type MyDropsResponse = {
  entries: { drop: PublicDropDto; status: string; rank: number | null; windowOpensAt: string | null; windowEndsAt: string | null; enteredAt: string }[]
  reminders: { dropId: string; setAt: string; drop: PublicDropDto | null }[]
}

export const myDropsKey = (shopperId: string) => `market.drops:${shopperId}`
export const loadMyDrops = () => api<MyDropsResponse>("/api/drops/me")