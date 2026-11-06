"use client"

import Image from "next/image"
import { usePathname, useRouter } from "next/navigation"
import { BellIcon as Bell, HeartIcon as Heart, PackageIcon as Package } from "@phosphor-icons/react"
import { AuthForm } from "@/components/market/auth-prompt"
import { useHydrated } from "@/hooks/use-hydrated"
import { useSession } from "@/lib/stores/session"
import type { ImageAsset } from "@/lib/data/types"
import { safeNext } from "./format"
import { AccountSkeleton, type AccountSkeletonVariant } from "./skeletons"

export type Invite = { title: string; body: string; image: ImageAsset; caption?: string }

const benefits = [
  { icon: Heart, text: "Save pieces from any brand. Once accounts are connected, they follow you to every device." },
  { icon: Bell, text: "Get drop reminders and new pieces from the brands you follow." },
  { icon: Package, text: "Check out once and track each brand's order separately." },
]

/**
 * After signing in: a new account goes through onboarding first; otherwise the shopper
 * continues to `next`, or stays on the page they signed in from.
 */
export function useAfterSignIn(next?: string) {
  const router = useRouter()
  const pathname = usePathname()
  return () => {
    if (pathname === "/welcome") return // the onboarding page itself appears once signed in
    const target = safeNext(next ?? pathname)
    if (!useSession.getState().onboarded) router.push(`/welcome?next=${encodeURIComponent(target)}`)
    else if (next) router.push(target)
  }
}

/** Full-page sign-in: editorial photograph on one side, the shared AuthForm on the other. */
export function AuthPanel({
  title,
  body,
  image,
  caption,
  next,
  eyebrow,
  joinNote = true,
  children,
}: Invite & { next?: string; eyebrow?: string; /** The "continuing creates your account" note; off once signed in. */ joinNote?: boolean; children?: React.ReactNode }) {
  const afterSignIn = useAfterSignIn(next)

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-14">
      <figure className="relative aspect-[16/10] overflow-hidden rounded-lg bg-card sm:aspect-[16/9] lg:aspect-auto lg:min-h-[640px]">
        <Image src={image.src} alt={image.alt} fill loading="eager" fetchPriority="high" sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" />
        <span className="scrim-b absolute inset-0" aria-hidden />
        {caption ? <figcaption className="absolute bottom-4 left-4 text-xs text-ink-2">{caption}</figcaption> : null}
      </figure>
      <div className="flex flex-col justify-center lg:py-10">
        {eyebrow ? <p className="text-sm text-violet">{eyebrow}</p> : null}
        <h1 className="mt-2 font-display text-display-lg text-ink">{title}</h1>
        <p className="mt-4 max-w-md text-pretty text-[0.9375rem] leading-relaxed text-ink-2">{body}</p>
        <div className="mt-8 max-w-md">
          {children ?? <AuthForm onDone={afterSignIn} />}
        </div>
        {joinNote ? (
          <p className="mt-4 max-w-md text-xs leading-relaxed text-ink-3">
            New here? Continuing creates your account. You choose which updates reach you, and how, in Settings.
          </p>
        ) : null}
        <ul className="mt-10 grid max-w-md gap-3 border-t border-line-soft pt-6">
          {benefits.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3 text-sm text-ink-2">
              <Icon className="mt-0.5 size-4 shrink-0 text-violet" aria-hidden />
              {text}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/**
 * Your World pages need an account. Until the saved session has loaded the page shows
 * skeletons; guests get a sign-in invitation in place of the page.
 */
export function AccountGate({ invite, skeleton = "grid", children }: { invite: Invite; skeleton?: AccountSkeletonVariant; children: React.ReactNode }) {
  const hydrated = useHydrated()
  const user = useSession((s) => s.user)
  if (!hydrated) return <AccountSkeleton variant={skeleton} />
  if (!user) return <AuthPanel {...invite} />
  return <>{children}</>
}
