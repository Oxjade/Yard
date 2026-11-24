"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { UserSwitchIcon } from "@phosphor-icons/react"
import { YardLogo } from "@/components/brand/yard-logo"
import { Bone } from "@/components/feedback/skeletons"
import { DemoAccountPicker } from "@/components/session/demo-account-picker"
import { ServerActorSignIn } from "@/components/session/server-actor-sign-in"
import { Button } from "@/components/ui/button"
import { useAsyncAction } from "@/hooks/use-async-action"
import { api } from "@/lib/api/client"
import type { DemoSignInResult } from "@/lib/api/contracts/session"
import { afterIdentityChange } from "@/lib/session/identity"
import { refreshServerSession, useServerSession } from "@/lib/session/use-server-session"
import { STUDIO_ONBOARDING_PATH, safeStudioNext } from "@/lib/studio-gate"

/** Full width on phones and free to wrap, so a long account name never forces a sideways scroll. */
const wrapButton = "h-auto min-h-10 w-full whitespace-normal py-2 text-center"

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div data-surface="studio" className="min-h-dvh bg-obsidian text-sm">
      <main id="main" className="grid min-h-dvh place-items-center px-4 py-10">
        <div className="grid w-full max-w-[420px] gap-6">
          <header className="grid justify-items-center gap-3 text-center">
            <span className="inline-flex size-12 items-center justify-center rounded-[13px] border border-white/12 bg-obsidian">
              <YardLogo decorative className="h-auto w-[36px]" />
            </span>
            <h1 className="text-xl font-medium tracking-tight text-ink">Brand Studio</h1>
          </header>
          {children}
        </div>
      </main>
    </div>
  )
}

export function StudioSignInSkeleton() {
  return (
    <Frame>
      <div aria-busy role="status" className="grid gap-3 rounded-lg border border-line-soft bg-card p-5">
        <span className="sr-only">Checking your session</span>
        <Bone className="h-5 w-48" />
        <Bone className="h-10 w-full" />
        <Bone className="h-10 w-full" />
        <Bone className="h-10 w-full" />
      </div>
    </Frame>
  )
}

/**
 * Signs a brand member in and goes to ?next= when it is a Studio page on this origin, else
 * /studio. Someone already signed in to Studio goes straight there. Someone signed in to the shop
 * whose account runs no brand goes to apply (the onboarding wizard). In the demo the demo accounts
 * are offered too.
 */
export function StudioSignIn() {
  const router = useRouter()
  const nextParam = safeStudioNext(useSearchParams().get("next"))
  const s = useServerSession()
  const [picker, setPicker] = useState(false)
  const leaving = useRef(false)

  const go = useCallback(() => {
    if (leaving.current) return
    leaving.current = true
    // The proxy's redirect keeps the page's #fragment on this address (e.g. #payouts): carry it on.
    const hash = typeof window !== "undefined" && !nextParam.includes("#") ? window.location.hash : ""
    router.replace(`${nextParam}${hash}`)
  }, [router, nextParam])

  // Signed in to the shop, but this account isn't a member of any brand: applying is the way in.
  const noBrand = s.status === "ready" && !s.brand && !!s.shopper && !s.shopper.demo && (s.shopper.brands?.length ?? 0) === 0 && s.sampleData === false

  useEffect(() => {
    if (s.status !== "ready") return
    if (s.brand) go()
    else if (noBrand && !leaving.current) {
      leaving.current = true
      router.replace(STUDIO_ONBOARDING_PATH)
    }
  }, [s.status, s.brand, noBrand, go, router])

  const continueAsDemo = useAsyncAction(
    async () => {
      await api<DemoSignInResult>("/api/auth/demo", { body: { actor: "brand", account: "u_b_tobi" } })
      await afterIdentityChange("studio")
    },
    { error: "Couldn't sign in to the demo account. Try again." },
  )

  if (s.status === "loading" || (s.status === "ready" && (s.brand || noBrand))) return <StudioSignInSkeleton />

  if (s.status === "error") {
    return (
      <Frame>
        <div role="alert" className="grid gap-3 rounded-lg border border-line-soft bg-card p-5 text-center">
          <p className="text-base font-medium text-ink">Couldn&apos;t check your session</p>
          <p className="text-sm leading-relaxed text-ink-2">Yard&apos;s server didn&apos;t answer. Check your connection, then try again.</p>
          <Button variant="secondary" className="justify-self-center" onClick={() => void refreshServerSession()}>
            Try again
          </Button>
        </div>
      </Frame>
    )
  }

  const demoOn = !!s.demoAuth?.brand
  return (
    <Frame>
      <p className="-mt-2 text-center text-sm leading-relaxed text-ink-2">Sign in with the account that runs your brand on Yard.</p>
      <ServerActorSignIn surface="studio" onSignedIn={go} />
      <p className="text-center text-sm text-ink-2">
        New to selling on Yard?{" "}
        <Link href={STUDIO_ONBOARDING_PATH} className="text-violet underline-offset-2 hover:underline">
          Apply for a brand workspace
        </Link>
      </p>
      {demoOn ? (
        <section aria-labelledby="studio-demo-title" className="grid gap-3 rounded-lg border border-line-soft bg-card p-5">
          <div>
            <h2 id="studio-demo-title" className="text-base font-medium text-ink">Demo accounts</h2>
            <p className="mt-1 text-sm text-ink-2">This build has demo sign-in on: continue without a password.</p>
          </div>
          <Button variant="secondary" className={wrapButton} loading={continueAsDemo.pending} success={continueAsDemo.succeeded} onClick={() => void continueAsDemo.run()}>
            Continue as Tobi Adeyemi (demo owner)
          </Button>
          <Button variant="ghost" className={wrapButton} onClick={() => setPicker(true)}>
            <UserSwitchIcon aria-hidden /> Choose another demo account
          </Button>
          <DemoAccountPicker surface="studio" open={picker} onOpenChange={setPicker} />
        </section>
      ) : null}
    </Frame>
  )
}
