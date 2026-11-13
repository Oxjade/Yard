"use client"

import { useCallback, useEffect, useRef, useState } from "react"
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
import { safeAdminNext } from "./next-path"

/** Full width on phones and free to wrap, so a long account name never forces a sideways scroll. */
const wrapButton = "h-auto min-h-10 w-full whitespace-normal py-2 text-center"

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="grid w-full max-w-[420px] gap-6">
        <header className="grid justify-items-center gap-3 text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-[13px] border border-white/12 bg-obsidian">
            <YardLogo decorative className="h-auto w-[36px]" />
          </span>
          <div className="grid justify-items-center gap-1.5">
            <h1 className="text-xl font-medium tracking-tight text-ink">Control Center</h1>
            <span className="rounded-[4px] border border-white/15 px-1.5 py-px text-[11px] leading-snug font-medium text-ink-2">Internal</span>
          </div>
        </header>
        {children}
      </div>
    </main>
  )
}

export function AdminSignInSkeleton() {
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
 * Signs an admin in (password, then authenticator enrol or verify, or a recovery code) and goes
 * to ?next= when it is a Control Center path on this origin, else /admin. Someone already signed
 * in goes straight there. In development (demoAuth.admin) the demo accounts are offered too.
 */
export function AdminSignIn() {
  const router = useRouter()
  const next = safeAdminNext(useSearchParams().get("next"))
  const s = useServerSession()
  const [picker, setPicker] = useState(false)
  // While the recovery codes are on screen the session is already signed in: stay until "Continue".
  const [hold, setHold] = useState(false)
  const leaving = useRef(false)

  const go = useCallback(() => {
    if (leaving.current) return
    leaving.current = true
    router.replace(next)
  }, [router, next])

  useEffect(() => {
    if (s.status === "ready" && s.admin && !hold) go()
  }, [s.status, s.admin, hold, go])

  const continueAsDemo = useAsyncAction(
    async () => {
      await api<DemoSignInResult>("/api/auth/demo", { body: { actor: "admin", account: "adm_1" } })
      await afterIdentityChange("admin")
    },
    { error: "Couldn't sign in to the demo account. Try again." },
  )

  if (s.status === "loading" || (s.status === "ready" && s.admin && !hold)) return <AdminSignInSkeleton />

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

  const demoOn = !!s.demoAuth?.admin
  return (
    <Frame>
      <p className="-mt-2 text-center text-sm leading-relaxed text-ink-2">Sign in with the account invited to Yard&apos;s Control Center.</p>
      <ServerActorSignIn surface="admin" onSignedIn={go} onHold={setHold} />
      {demoOn ? (
        <section aria-labelledby="admin-demo-title" className="grid gap-3 rounded-lg border border-line-soft bg-card p-5">
          <div>
            <h2 id="admin-demo-title" className="text-base font-medium text-ink">Demo accounts</h2>
            <p className="mt-1 text-sm text-ink-2">This build has demo sign-in on: continue without a password.</p>
          </div>
          <Button variant="secondary" className={wrapButton} loading={continueAsDemo.pending} success={continueAsDemo.succeeded} onClick={() => void continueAsDemo.run()}>
            Continue as Kemi Ajayi (demo owner)
          </Button>
          <Button variant="ghost" className={wrapButton} onClick={() => setPicker(true)}>
            <UserSwitchIcon aria-hidden /> Choose another demo account
          </Button>
          <DemoAccountPicker surface="admin" open={picker} onOpenChange={setPicker} />
        </section>
      ) : null}
    </Frame>
  )
}
