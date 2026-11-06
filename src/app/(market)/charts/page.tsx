import type { Metadata } from "next"
import { connection } from "next/server"
import { Suspense } from "react"
import { ChartsApp } from "@/components/charts/charts-app"
import { ControlsSkeleton, LeaderboardSkeleton } from "@/components/charts/skeleton"
import { parseBoardState } from "@/components/charts/state"
import { SampleChip } from "@/components/ui/sample-chip"
import { boardPath } from "@/lib/api/charts"
import { getBoard, getScopes } from "@/server/charts"
import { log } from "@/server/log"

export const metadata: Metadata = {
  title: "Charts",
  description: "What's moving on Yard right now: Top brands, Trending, Emerging, Most followed, Most wishlisted, Top drops and City charts, daily, weekly and monthly.",
}

/**
 * /charts (§6.3). The static shell holds the heading and skeletons; the first board is rendered on
 * the server inside Suspense (after connection(), so nothing reads the database at build time),
 * then the client keeps it live over /api/charts.
 */
type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default function ChartsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mx-auto max-w-page px-4 pt-28 pb-24 md:px-8 md:pt-32">
      <header className="grid gap-4 lg:grid-cols-[1fr_minmax(0,26rem)] lg:items-end lg:gap-12">
        <h1 className="font-display text-display-lg text-ink">Charts</h1>
        <div className="grid gap-3 lg:justify-items-start lg:pb-1">
          <p className="max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2">What&apos;s moving on Yard right now.</p>
          <SampleChip label="Includes sample activity" title="Rankings include sample activity in this build." className="justify-self-start" />
        </div>
      </header>

      <Suspense
        fallback={
          <div className="mt-6 grid gap-6 md:mt-8">
            <div className="h-7" />
            <ControlsSkeleton />
            <LeaderboardSkeleton />
          </div>
        }
      >
        <BoardLoader searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function BoardLoader({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams
  await connection()
  const state = parseBoardState({ get: (k) => (typeof sp[k] === "string" ? (sp[k] as string) : null) })
  let initial, scopes
  try {
    scopes = await getScopes()
    initial = await getBoard(state)
  } catch (e) {
    // The client shows the loading state and its own error state with Retry.
    log.error("[yard] /charts first render failed", e)
  }
  return <ChartsApp initial={initial} initialPath={boardPath(state)} initialScopes={scopes} />
}
