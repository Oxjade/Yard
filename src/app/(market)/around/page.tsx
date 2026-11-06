import { Suspense } from "react"
import type { Metadata } from "next"
import { AroundApp } from "@/components/around/around-app"

export const metadata: Metadata = {
  title: "Around",
  description: "Stores, showrooms, pop-ups and exhibitions from independent brands near you, on a map and as a list.",
}

export default function AroundPage() {
  return (
    <Suspense fallback={<div className="h-dvh bg-[#050505]" />}>
      <AroundApp />
    </Suspense>
  )
}
