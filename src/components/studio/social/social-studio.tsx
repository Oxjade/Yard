"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { PageHeader } from "@/components/dashboard/page-header"
import { TabParam, writeTabParam } from "@/components/admin/platform/tab-param"
import { StatusTabs } from "@/components/studio/catalog/status-tabs"
import { SessionGate } from "@/components/session/session-gate"
import { CONNECT_RESULTS, FEED_SOURCES, providerLabels, STUDIO_POST_STATUSES, type ConnectResult, type FeedSource, type SocialAccountsResult, type SocialProviderId, type StudioPostStatus } from "@/lib/api/contracts/social"
import { errorMessage } from "@/lib/api/errors"
import { revalidatePrefix, useApi } from "@/lib/api/use-api"
import { accountsKey, getAccounts, getStudioPosts, studioPostsKey } from "@/lib/api/social"
import { useRealtimeEvent } from "@/lib/realtime/use-realtime"
import { useServerSession } from "@/lib/session/use-server-session"
import { Button } from "@/components/ui/button"
import { ConnectionCard, ConnectionSkeleton } from "./connections"
import { ContentStudio } from "./content-studio"

type Tab = "connections" | "content"
const TABS: readonly Tab[] = ["connections", "content"]

/** What ?result= says once the OAuth callback (or the sandbox) brings the brand back here. */
function resultToast(result: ConnectResult, provider: SocialProviderId, accounts: SocialAccountsResult | undefined, onChoose: (p: SocialProviderId) => void) {
  const label = providerLabels[provider]
  const handle = accounts?.accounts.find((a) => a.provider === provider)?.handle
  switch (result) {
    case "connected":
      return toast.success(`${label} connected${handle ? ` as @${handle}` : ""}. Choose posts in Content Studio.`, { id: "social-result", action: { label: "Choose posts", onClick: () => onChoose(provider) } })
    case "denied":
      return toast(`${label} connection cancelled. Nothing changed.`, { id: "social-result" })
    case "already_connected":
      return toast.error(`Another ${label} account is connected`, { id: "social-result", description: `Disconnect it first to connect a different ${label} account.` })
    case "invalid_state":
      return toast.error(`${label} connection didn't complete`, { id: "social-result", description: "The link expired or was opened in another session. Start again from this page." })
    default:
      return toast.error(`${label} connection didn't complete`, { id: "social-result", description: `${label} or Yard had a problem. Nothing changed. Try again later.` })
  }
}

/** Reads ?result=&provider= once, toasts when the accounts are known, then drops them from the URL. */
function ResultFromUrl({ accounts, ready, onChoose }: { accounts: SocialAccountsResult | undefined; ready: boolean; onChoose: (p: SocialProviderId) => void }) {
  const params = useSearchParams()
  const result = params.get("result")
  const provider = params.get("provider")
  const done = useRef(false)
  const chooseRef = useRef(onChoose)
  useEffect(() => {
    chooseRef.current = onChoose
  })
  useEffect(() => {
    if (done.current || !ready || !result) return
    done.current = true
    const r = ((CONNECT_RESULTS as readonly string[]).includes(result) ? result : "error") as ConnectResult
    const p = (provider === "tiktok" ? "tiktok" : "instagram") as SocialProviderId
    resultToast(r, p, accounts, (x) => chooseRef.current(x))
    const url = new URL(window.location.href)
    url.searchParams.delete("result")
    url.searchParams.delete("provider")
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`)
  }, [ready, result, provider, accounts])
  return null
}

function Body() {
  const brand = useServerSession((s) => s.brand)
  const [tab, setTab] = useState<Tab>("connections")
  // Content Studio's filters live in the URL (?source=&status=), so a reload or a tab switch keeps them.
  const [source, setSource] = useState<FeedSource>("all")
  const [status, setStatus] = useState<StudioPostStatus>("published")
  const [uploadOpen, setUploadOpen] = useState(false)
  // The status "Choose posts" picked, until the brand picks another one itself.
  const chosen = useRef<StudioPostStatus | null>(null)
  // A sync runs after the response: poll while one is running, then stop.
  const [polling, setPolling] = useState(false)
  const { data, error, isLoading, revalidate } = useApi(accountsKey, getAccounts, { refreshInterval: polling ? 2000 : undefined })
  const syncing = !!data?.accounts.some((a) => a.status === "connected" && (a.syncing || !a.lastSyncAt))
  if (syncing !== polling) setPolling(syncing)
  // When a sync finishes, the post lists change too.
  const wasSyncing = useRef(false)
  useEffect(() => {
    if (wasSyncing.current && !syncing) revalidatePrefix("/api/studio/social/posts")
    wasSyncing.current = syncing
  }, [syncing])
  useRealtimeEvent("social.status", () => {
    void revalidate()
    revalidatePrefix("/api/studio/social/posts")
  })

  const choose = (t: Tab) => {
    setTab(t)
    writeTabParam(t)
  }
  const chooseSource = (s: FeedSource) => {
    setSource(s)
    writeTabParam(s, "source")
  }
  const chooseStatus = (s: StudioPostStatus) => {
    chosen.current = null
    setStatus(s)
    writeTabParam(s, "status")
  }
  /**
   * "Choose posts" (and the toast after connecting): Content Studio filtered to that network, on
   * Hidden, where new imports arrive. When the network has no hidden posts, it opens On storefront.
   */
  const choosePosts = (p: SocialProviderId) => {
    chooseSource(p)
    chooseStatus("hidden")
    chosen.current = "hidden"
    choose("content")
    getStudioPosts(studioPostsKey(p, "all"))
      .then((r) => {
        if (chosen.current === "hidden" && r.counts.hidden === 0) chooseStatus("published")
      })
      .catch(() => {})
  }
  const refreshAll = () => {
    void revalidate()
    revalidatePrefix("/api/studio/social/posts")
  }
  if (!brand) return null
  const anyConnected = !!data?.accounts.some((a) => a.status === "connected")

  return (
    <div className="grid gap-5">
      <TabParam values={TABS} onChange={setTab} />
      <TabParam param="source" values={FEED_SOURCES} onChange={setSource} />
      <TabParam param="status" values={STUDIO_POST_STATUSES} onChange={setStatus} />
      <Suspense fallback={null}>
        <ResultFromUrl accounts={data} ready={!!data || !!error} onChoose={choosePosts} />
      </Suspense>
      <StatusTabs
        id="social-tab"
        label="Social"
        value={tab}
        onChange={choose}
        controls="social-panel"
        tabs={[
          { value: "connections", label: "Social connections" },
          { value: "content", label: "Content Studio" },
        ]}
      />
      <div id="social-panel" role="tabpanel" aria-labelledby={`social-tab-${tab}`}>
        {tab === "connections" ? (
          isLoading ? (
            <div role="status" className="grid gap-4 lg:grid-cols-2">
              <span className="sr-only">Loading your connections</span>
              <ConnectionSkeleton />
              <ConnectionSkeleton />
            </div>
          ) : error || !data ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-line-soft px-6 py-10 text-center">
              <p className="text-sm text-ink">Couldn&apos;t load your connections.</p>
              <p className="text-xs text-ink-2">{errorMessage(error, "Check your connection, then try again.")}</p>
              <Button variant="secondary" onClick={() => void revalidate()}>
                Retry
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {data.accounts.map((a) => (
                <ConnectionCard
                  key={a.provider}
                  account={a}
                  brand={brand}
                  paused={data.paused}
                  onChanged={refreshAll}
                  onUpload={() => {
                    choose("content")
                    setUploadOpen(true)
                  }}
                  onChoosePosts={choosePosts}
                />
              ))}
            </div>
          )
        ) : (
          <ContentStudio
            brand={brand}
            source={source}
            onSourceChange={chooseSource}
            status={status}
            onStatusChange={chooseStatus}
            uploadOpen={uploadOpen}
            onUploadOpenChange={setUploadOpen}
            anyConnected={anyConnected}
            onChanged={() => void revalidate()}
          />
        )}
      </div>
    </div>
  )
}

/** Studio › Social: Social connections and Content Studio (§6.1). Any member can view; each action checks its own permission. */
export function SocialStudio() {
  return (
    <div className="grid gap-6">
      <PageHeader title="Social" description="Connect Instagram and TikTok, choose what shows on your storefront, or upload posts to Yard." />
      <SessionGate surface="studio" permission="inbox.read" feature="Social">
        <Body />
      </SessionGate>
    </div>
  )
}
