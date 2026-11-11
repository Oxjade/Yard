import type { Metadata } from "next"
import { connection } from "next/server"
import { LiveDropDetail } from "@/components/market/live-drop-detail"
import { loadDrop } from "@/server/drops/service"

export const instant = false

export async function generateMetadata({ params }: PageProps<"/drops/[slug]">): Promise<Metadata> {
  await connection()
  const { slug } = await params
  const drop = await loadDrop(slug)
  if (!drop) return { title: "Drop not found" }
  return { title: `${drop.name}, drop`, description: drop.description }
}

export default async function DropPage({ params }: PageProps<"/drops/[slug]">) {
  const { slug } = await params
  return <LiveDropDetail slug={slug} />
}
