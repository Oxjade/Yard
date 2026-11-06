"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { AuthForm } from "@/components/market/auth-prompt"
import { Button } from "@/components/ui/button"
import { useHydrated } from "@/hooks/use-hydrated"
import { useSession } from "@/lib/stores/session"
import type { ImageAsset } from "@/lib/data/types"
import { AuthPanel } from "./auth-panel"
import { safeNext } from "./format"
import { AccountSkeleton } from "./skeletons"

/**
 * The full sign-in and create-account page. A new account is taken through onboarding;
 * a returning one goes back to `?next=` (or Your World).
 */
export function SignInView({ image, caption }: { image: ImageAsset; caption?: string }) {
  const router = useRouter()
  const params = useSearchParams()
  const hydrated = useHydrated()
  const user = useSession((s) => s.user)
  const signOut = useSession((s) => s.signOut)
  const [leaving, setLeaving] = useState(false)
  const nextParam = params.get("next")
  const target = safeNext(nextParam)

  function afterSignIn() {
    setLeaving(true)
    if (!useSession.getState().onboarded) router.push(nextParam ? `/welcome?next=${encodeURIComponent(target)}` : "/welcome")
    else router.push(target)
  }

  if (!hydrated) return <AccountSkeleton variant="split" />

  if (user && !leaving) {
    return (
      <AuthPanel title="You're signed in" body={`Signed in as ${user.name}, ${user.email}.`} image={image} caption={caption} joinNote={false}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button variant="primary" size="lg" onClick={() => router.push(target)}>Continue</Button>
          <Button variant="secondary" size="lg" onClick={() => signOut()}>Use another account</Button>
        </div>
      </AuthPanel>
    )
  }

  return (
    <AuthPanel
      title="Sign in or join"
      body="One account for every brand: follow studios, save pieces, get drop alerts and track each brand's order from one place."
      image={image}
      caption={caption}
    >
      {leaving ? (
        <p role="status" className="rounded-md border border-line-soft bg-card px-4 py-3 text-sm text-ink-2">Signed in. Taking you there now.</p>
      ) : (
        <AuthForm onDone={afterSignIn} />
      )}
    </AuthPanel>
  )
}
