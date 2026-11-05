"use client"

import { useEffect } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"

/** Route-level error boundary: say what happened and offer the way out. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 text-center">
      <h1 className="font-display text-display-lg text-ink">Something broke</h1>
      <p className="mt-4 max-w-md text-ink-2">
        This page hit an error while loading. Try again — if it keeps happening, the problem is on our side, not yours.
      </p>
      {error.digest ? <p className="mt-2 text-xs text-ink-3 tabular">Reference {error.digest}</p> : null}
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button variant="primary" size="lg" onClick={reset}>Try again</Button>
        <Button asChild variant="secondary" size="lg">
          <Link href="/">Back to Discover</Link>
        </Button>
      </div>
    </main>
  )
}
