import Link from "next/link"
import { Button } from "@/components/ui/button"
import { wordmarkType } from "@/components/market/wordmark-type"
import { site } from "@/config/site"

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <p className={`${wordmarkType} text-base`}>{site.name}</p>
      <h1 className="mt-8 font-display text-display-xl text-ink">Not found</h1>
      <p className="mt-4 max-w-md text-ink-2">
        This page moved, sold out or never existed. The brands are still here.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild variant="primary" size="lg">
          <Link href="/">Back to Discover</Link>
        </Button>
        <Button asChild variant="secondary" size="lg">
          <Link href="/brands">Browse brands</Link>
        </Button>
      </div>
    </main>
  )
}
