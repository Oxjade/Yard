"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { BellRing, LogOut } from "lucide-react"
import { toast } from "sonner"
import { Notice } from "@/components/market/checkout/fields"
import { LocaleSelect } from "@/components/market/locale-select"
import { SectionHeader } from "@/components/market/section-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { countries, currencies } from "@/config/markets"
import { site } from "@/config/site"
import { useSaved } from "@/lib/stores/saved"
import { useSession, type NotificationPrefs } from "@/lib/stores/session"
import { InterestEditor } from "./interest-editor"
import { YouNav } from "./you-nav"

const topics: { key: keyof NotificationPrefs; label: string; body: string }[] = [
  { key: "newProducts", label: "New products", body: "When a brand you follow adds new pieces." },
  { key: "drops", label: "Drops", body: "Announcements from brands you follow, and the reminders you set with Notify me." },
  { key: "collections", label: "Collections", body: "New collections from brands you follow." },
  { key: "promotions", label: "Promotions", body: "Sales and offers from brands you follow. Never from brands you don't." },
]

const channels: { key: keyof NotificationPrefs; label: string; body: string }[] = [
  { key: "email", label: "Email", body: "Sent to the address on your account." },
  { key: "push", label: "Push", body: "On this device, when the app or site is allowed to notify you." },
]

const providerName = { google: "Google", apple: "Apple", email: "email and password" } as const

function Row({ id, label, body, checked, onChange }: { id: string; label: string; body: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm text-ink">{label}</Label>
        <p className="mt-1 text-sm text-ink-2">{body}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} className="mt-0.5" />
    </div>
  )
}

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-24 grid gap-6 md:mt-32 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:gap-16">
      <div id={id}>
        <SectionHeader title={title} description={description} className="mb-0 md:mb-0" />
      </div>
      <div className="rounded-lg border border-line-soft bg-card p-5 md:p-6">{children}</div>
    </section>
  )
}

function AccountForm() {
  const user = useSession((s) => s.user)!
  const updateProfile = useSession((s) => s.updateProfile)
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({})
  const managed = user.provider !== "email"
  const dirty = name.trim() !== user.name || email.trim() !== user.email

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const next: typeof errors = {}
    const n = name.trim()
    if (n.length < 2) next.name = "Enter the name you'd like on orders, at least 2 characters."
    else if (n.length > 60) next.name = "Keep your name under 60 characters."
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) next.email = "Enter a valid email address."
    setErrors(next)
    if (Object.keys(next).length) return
    updateProfile({ name: n, email: email.trim() })
    toast("Account updated", { description: "New orders and receipts will use these details." })
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-5">
      <div className="grid gap-1.5">
        <Label htmlFor="acc-name">Name</Label>
        <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" aria-invalid={!!errors.name} aria-describedby={errors.name ? "acc-name-error" : undefined} className="h-11" />
        {errors.name ? <p id="acc-name-error" className="text-xs text-danger">{errors.name}</p> : null}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="acc-email">Email</Label>
        <Input
          id="acc-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          disabled={managed}
          aria-invalid={!!errors.email}
          aria-describedby={managed ? "acc-email-note" : errors.email ? "acc-email-error" : undefined}
          className="h-11"
        />
        {errors.email ? <p id="acc-email-error" className="text-xs text-danger">{errors.email}</p> : null}
        {managed ? <p id="acc-email-note" className="text-xs text-ink-3">Signed in with {providerName[user.provider]}. Change this email in your {providerName[user.provider]} account.</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={!dirty}>Save changes</Button>
        {dirty ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setName(user.name)
              setEmail(user.email)
              setErrors({})
            }}
          >
            Discard
          </Button>
        ) : !managed ? (
          <span className="text-xs text-ink-3">Signed in with {providerName[user.provider]}</span>
        ) : null}
      </div>
    </form>
  )
}

/** Account, notifications, region, interests and sign-out. */
export function SettingsView() {
  const router = useRouter()
  const prefs = useSession((s) => s.notifications)
  const setNotifications = useSession((s) => s.setNotifications)
  const signOut = useSession((s) => s.signOut)
  const shipTo = useSession((s) => s.shipTo)
  const currency = useSession((s) => s.currency)
  const following = useSaved((s) => s.following.length)
  const reminders = useSaved((s) => s.notify.length)
  const anyChannel = prefs.email || prefs.push

  function change(key: keyof NotificationPrefs, label: string, value: boolean) {
    setNotifications({ [key]: value })
    toast(`${label} ${value ? "on" : "off"}`, { description: "Saved. Every alert we send follows these settings." })
  }

  return (
    <>
      <header>
        <p className="text-sm text-violet">Your World</p>
        <h1 className="mt-2 font-display text-display-lg text-ink">Settings</h1>
        <p className="mt-4 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2">Your details, what we tell you about, where you shop from and what you&apos;re into.</p>
      </header>
      <YouNav className="mt-8" />

      <Section id="set-account" title="Account" description="Your name goes on orders and receipts. Receipts and shipping updates go to your email.">
        <AccountForm />
      </Section>

      <Section id="set-notify" title="Notifications" description="Choose what you hear about and how. Brands only ever reach you through these settings.">
        <Notice icon={BellRing}>
          <p className="text-ink">
            Notifications respect these settings. Updates from brands you follow and the drop reminders you set only reach you for the topics switched on below, through the channels switched on below.
          </p>
          {following || reminders ? (
            <p className="mt-1">
              Right now that covers {following === 1 ? "1 brand" : `${following} brands`} and {reminders === 1 ? "1 drop reminder" : `${reminders} drop reminders`}.
            </p>
          ) : null}
        </Notice>
        <h3 className="mt-6 text-xs text-ink-3">Tell me about</h3>
        <div className="mt-3 divide-y divide-line-soft">
          {topics.map((t) => (
            <Row key={t.key} id={`n-${t.key}`} label={t.label} body={t.body} checked={prefs[t.key]} onChange={(v) => change(t.key, t.label, v)} />
          ))}
        </div>
        <h3 className="mt-8 text-xs text-ink-3">Send them by</h3>
        <div className="mt-3 divide-y divide-line-soft">
          {channels.map((c) => (
            <Row key={c.key} id={`n-${c.key}`} label={c.label} body={c.body} checked={prefs[c.key]} onChange={(v) => change(c.key, `${c.label} notifications`, v)} />
          ))}
        </div>
        {!anyChannel ? <p className="mt-5 text-xs text-acid">Email and push are both off. Updates still appear in your Following feed, but nothing is sent to you.</p> : null}
      </Section>

      <Section id="set-region" title="Region and currency" description="Where you ship to sets delivery times and shipping costs. Prices show in your currency as an estimate; checkout confirms the rate.">
        <LocaleSelect />
        <p className="mt-4 text-sm text-ink-2">
          Shipping to {countries[shipTo].name}, prices in {currency} ({currencies[currency].symbol}). Choosing a country also switches to its currency; you can change the currency separately.
        </p>
      </Section>

      <Section id="set-interests" title="Interests" description="Pick the categories and looks you shop for. They shape Picked for you and the brands we suggest.">
        <InterestEditor />
      </Section>

      <Section id="set-signout" title="Sign out" description={`Sign out of ${site.name} on this device. Your bag stays here for next time.`}>
        <Button
          variant="secondary"
          onClick={() => {
            signOut()
            toast("Signed out", { description: "Sign in again any time to see your brands and orders." })
            router.push("/")
          }}
        >
          <LogOut /> Sign out
        </Button>
      </Section>
    </>
  )
}
