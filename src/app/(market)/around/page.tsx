import { Suspense } from "react"
import type { Metadata } from "next"
import { AroundApp } from "@/components/around/around-app"

export const metadata: Metadata = {
  title: "Around",
  description: "Stores, showrooms, pop-ups and exhibitions from independent brands near you, on a map and as a list.",
  alternates: { canonical: "/around" },
}

export default function AroundPage() {
  // The page's one h1, for crawlers and screen readers: the map has no visible title, and the
  // list's "Around {city}" heading (an h2) only shows in list mode.
  return (
    <>
      <h1 className="sr-only">Around: independent brand stores, showrooms and pop-ups near you</h1>
      <Suspense fallback={<div className="h-dvh bg-[#050505]" />}>
        <AroundApp />
      </Suspense>
    </>
  )
}
