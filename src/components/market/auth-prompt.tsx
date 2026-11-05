"use client"

import { useState } from "react"
import Link from "next/link"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useSession, type AuthIntent, type SessionUser } from "@/lib/stores/session"
import { site } from "@/config/site"

const copy: Record<AuthIntent, { title: string; body: string }> = {
  follow: { title: "Sign in to follow brands", body: "Following puts their new products, drops and stories in your Following feed." },
  save: { title: "Sign in to save pieces", body: "Your wishlist is kept on your account, on every device." },
  notify: { title: "Sign in to get drop alerts", body: "We'll let you know the moment it goes live — by email or push, your choice." },
  checkout: { title: "Sign in to check out", body: "One account for every brand, so your orders and tracking live in one place." },
  account: { title: `Sign in to ${site.name}`, body: "Follow brands, save pieces and track every order in one place." },
}

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

/** Signs in with the frontend session. Better Auth replaces this in the backend phase. */
export function useDemoSignIn() {
  const signIn = useSession((s) => s.signIn)
  return (provider: SessionUser["provider"], name = "Ada Nwosu", email = "ada@example.com") =>
    signIn({ id: "u_ada", name, email, provider })
}

export function AuthForm({ onDone }: { onDone?: () => void }) {
  const demoSignIn = useDemoSignIn()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError("Enter a valid email address.")
    if (password.length < 8) return setError("Use at least 8 characters for your password.")
    setError(null)
    demoSignIn("email", email.split("@")[0].replace(/\W/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), email)
    onDone?.()
  }

  return (
    <div className="grid gap-3">
      <Button variant="secondary" size="lg" className="w-full" onClick={() => { demoSignIn("google"); onDone?.() }}>
        <GoogleMark /> Continue with Google
      </Button>
      <Button variant="secondary" size="lg" className="w-full" onClick={() => { demoSignIn("apple"); onDone?.() }}>
        <AppleMark /> Continue with Apple
      </Button>
      <div className="my-1 flex items-center gap-3 text-xs text-ink-3">
        <span className="h-px flex-1 bg-white/10" /> or with email <span className="h-px flex-1 bg-white/10" />
      </div>
      <form onSubmit={submit} className="grid gap-3" noValidate>
        <div className="grid gap-1.5">
          <Label htmlFor="auth-email">Email</Label>
          <Input id="auth-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!error && !/^\S+@\S+\.\S+$/.test(email)} className="h-11" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="auth-password">Password</Label>
          <Input id="auth-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!error && password.length < 8} className="h-11" />
        </div>
        {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
        <Button type="submit" variant="primary" size="lg" className="w-full">Continue</Button>
      </form>
    </div>
  )
}

/** Opens whenever a guest tries something that needs an account; finishes that action after sign-in. */
export function AuthPrompt() {
  const prompt = useSession((s) => s.authPrompt)
  const dismiss = useSession((s) => s.dismissAuthPrompt)
  const intent = prompt?.intent ?? "account"

  return (
    <Dialog open={!!prompt} onOpenChange={(o) => !o && dismiss()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="font-display text-display-sm">{copy[intent].title}</DialogTitle>
          <DialogDescription className="text-ink-2">{copy[intent].body}</DialogDescription>
        </DialogHeader>
        <AuthForm />
        <p className="text-center text-xs text-ink-3">
          New here? Continuing creates your account. <Link href="/sign-in" onClick={dismiss} className="text-violet hover:underline">More options</Link>
        </p>
      </DialogContent>
    </Dialog>
  )
}
