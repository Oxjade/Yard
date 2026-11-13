"use client"

import { UserCircleIcon } from "@phosphor-icons/react"
import { api } from "@/lib/api/client"
import type { SocialButton } from "@/lib/auth/auth0"

/* Social sign-in pieces shared by the market sign-in, Brand Studio sign-in and Studio onboarding. */

export function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="currentColor" d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.66 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.96S8.78 6.26 12 6.26c1.84 0 3.07.78 3.77 1.45l2.57-2.47C16.73 3.74 14.6 2.8 12 2.8 6.98 2.8 2.9 6.88 2.9 11.9S6.98 21 12 21c5.25 0 8.73-3.69 8.73-8.88 0-.6-.07-1.05-.15-1.5z" />
    </svg>
  )
}

export function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="currentColor" d="M16.37 12.6c-.02-2.24 1.83-3.31 1.91-3.37-1.04-1.52-2.66-1.73-3.24-1.75-1.38-.14-2.69.81-3.39.81-.7 0-1.78-.79-2.92-.77-1.5.02-2.89.87-3.66 2.21-1.56 2.71-.4 6.72 1.12 8.92.74 1.08 1.63 2.29 2.79 2.24 1.12-.04 1.54-.72 2.89-.72 1.35 0 1.73.72 2.91.7 1.2-.02 1.96-1.1 2.7-2.18.85-1.25 1.2-2.46 1.22-2.52-.03-.01-2.33-.9-2.33-3.57zM14.14 6.04c.62-.75 1.03-1.78.92-2.82-.89.04-1.96.59-2.6 1.34-.57.66-1.07 1.71-.94 2.73.99.08 2-.5 2.62-1.25z" />
    </svg>
  )
}

/** The mark on a social sign-in button: Google and Apple have their own, anything else a person. */
export function SocialMark({ mark }: { mark: SocialButton["mark"] }) {
  if (mark === "google") return <GoogleMark />
  if (mark === "apple") return <AppleMark />
  return <UserCircleIcon className="size-4" aria-hidden />
}

/** POST /api/auth/oauth/{provider}/start for a social button; resolves to the provider URL. */
export async function startSocialSignIn(button: SocialButton, actor: "shopper" | "brand" = "shopper") {
  const body: Record<string, string> = { mode: "signin", actor }
  if (button.connection) body.connection = button.connection
  const { url } = await api<{ url: string }>(`/api/auth/oauth/${button.provider}/start`, { body })
  return url
}
