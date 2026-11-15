"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { BellRingingIcon as BellRing, CheckIcon as Check, SignOutIcon as LogOut } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Notice } from "@/components/market/checkout/fields"
import { LocaleSelect } from "@/components/market/locale-select"
import { SectionHeader } from "@/components/market/section-header"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { countries, currencies } from "@/config/markets"
import { api } from "@/lib/api/client"
import { site } from "@/config/site"
import { useSaved } from "@/lib/stores/saved"
import { useSession, type NotificationPrefs } from "@/lib/stores/session"
import { useServerSession } from "@/lib/session/use-server-session"
import { ReadReceiptsSetting } from "@/components/inbox/read-receipts-setting"
import { MessageSupportButton } from "@/components/inbox/entry"
import { AccountDetails } from "./account-details"
import { InterestEditor } from "./interest-editor"
import { YouNav } from "./you-nav"

const topics: { key: keyof NotificationPrefs; label: string; body: string }[] = [
  { key: "newProducts", label: "New products", body: "When a brand you follow adds new pieces." },
  { key: "drops", label: "Drops", body: "Announcements from brands you follow, and the reminders you set with Notify me." },
  { key: "collections", label: "Collections", body: "New collections from brands you follow." },
  { key: "promotions", label: "Promotions", body: "Sales and offers from brands you follow. Never from brands you don't." },
]

const channels: { key: keyof NotificationPrefs; label: string; body: string }[] = [
  { key: "email", label: "Email", body: "Sent to the address on your account. Not connected in this development build." },
  { key: "push", label: "Push", body: "On this device, once you allow it. Not connected in this development build." },
]

function Row({ id, label, body, checked, onChange }: { id: string; label: string; body: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm text-ink">
          {label}
        </Label>
        <p id={`${id}-desc`} className="mt-1 text-sm text-ink-2">
          {body}
        </p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={`${id}-desc`} className="mt-0.5" />
    </div>
  )
}

/** A quiet "Saved" that confirms a change in place and fades back to the resting hint. */
function SavedNote({ message, idle }: { message: string | null; idle: string }) {
  return (
    <p aria-live="polite" className="flex min-h-5 items-center gap-1.5 text-xs text-ink-3">
      {message ? (
        <>
          <Check className="size-3.5 text-violet" aria-hidden />
          <span className="text-ink-2">{message}</span>
        </>
      ) : (
        idle
      )}
    </p>
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

/** Account, notifications, region, interests and sign-out. */
export function SettingsView() {
  const router = useRouter()
  const shopperId = useServerSession((s) => s.shopper?.id ?? null)
  const prefs = useSession((s) => s.notifications)
  const setNotifications = useSession((s) => s.setNotifications)
  const signOut = useSession((s) => s.signOut)
  const shipTo = useSession((s) => s.shipTo)
  const currency = useSession((s) => s.currency)
  const following = useSaved((s) => s.following.length)
  const reminders = useSaved((s) => s.notify.length)
  const anyChannel = prefs.email || prefs.push
  const [lastChange, setLastChange] = useState<string | null>(null)

  useEffect(() => {
    if (!shopperId) return
    let active = true
    void api<{ preferences: { email: Record<string, boolean>; inApp: Record<string, boolean> } }>("/api/notifications/preferences?as=shopper")
      .then(({ preferences }) => {
        if (!active) return
        setNotifications({
          newProducts: preferences.inApp.brand_news,
          drops: preferences.inApp.drops,
          collections: preferences.inApp.brand_news,
          promotions: preferences.inApp.price_drops,
          // Email reads on while any topic still sends email; a topic switched off doesn't turn the whole channel off.
          email: Object.values(preferences.email).some(Boolean),
        })
      })
      .catch(() => {
        if (active) toast.error("Notification settings couldn’t be loaded.")
      })
    return () => {
      active = false
    }
  }, [shopperId, setNotifications])

  // Each switch saves at once (the session store persists); the note under the list says so.
  function change(key: keyof NotificationPrefs, label: string, value: boolean) {
    // Signed in, New products and Collections are one server topic (brand_news), so they switch together.
    const shared = !!shopperId && (key === "newProducts" || key === "collections")
    setNotifications(shared ? { newProducts: value, collections: value } : { [key]: value })
    setLastChange(shared ? `New products and collections ${value ? "on" : "off"}. Saved.` : `${label} ${value ? "on" : "off"}. Saved.`)
    if (!shopperId) return

    const category = key === "drops" ? "drops" : key === "promotions" ? "price_drops" : key === "newProducts" || key === "collections" ? "brand_news" : null
    // A topic writes its email flag only while Email is on: switching a topic on must not restart
    // email (or lift an unsubscribe) the shopper turned off.
    const topicPatch = category ? { inApp: { [category]: value }, ...(prefs.email ? { email: { [category]: value } } : {}) } : null
    // Email on sends the topics that are on; off stops them all.
    const emailPatch =
      key === "email"
        ? { email: value ? { drops: prefs.drops, price_drops: prefs.promotions, back_in_stock: true, brand_news: prefs.newProducts || prefs.collections } : { drops: false, price_drops: false, back_in_stock: false, brand_news: false } }
        : null
    const patch = topicPatch ?? emailPatch
    if (patch) void api("/api/notifications/preferences?as=shopper", { method: "PATCH", body: patch }).catch(() => toast.error("Notification settings weren’t saved. Try again."))
  }

  return (
    <>
      <header>
        <p className="text-sm text-violet">Your World</p>
        <h1 className="mt-2 font-display text-display-lg text-ink">Settings</h1>
        <p className="mt-4 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2">Your details, what we tell you about, where you shop from and what you&apos;re into.</p>
      </header>
      <YouNav className="mt-8" />

      <Section id="set-account" title="Account" description="Your name goes on your orders. Changing your email sends a link to the new address first.">
        {shopperId ? <AccountDetails as="shopper" /> : null}
      </Section>

      <Section id="set-notify" title="Notifications" description="Choose what you hear about and how. Brands only ever reach you through these settings.">
        <Notice icon={BellRing}>
          <p className="text-ink">Brands you follow and the drop reminders you set only reach you for the topics, and through the channels, switched on below.</p>
          {following || reminders ? (
            <p className="mt-1">
              Right now that covers {following === 1 ? "1 brand" : `${following} brands`} and {reminders === 1 ? "1 drop reminder" : `${reminders} drop reminders`}.
            </p>
          ) : null}
          <p className="mt-1">
            Email and push aren&apos;t connected in this development build, so nothing is sent yet. Your choices are saved and apply once they are. Every update also appears in{" "}
            <Link href="/notifications" className="text-violet underline-offset-4 hover:underline">
              Notifications
            </Link>
            .
          </p>
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
        {!anyChannel ? <p className="mt-5 text-xs text-acid">Email and push are both off. Updates still appear in Notifications and your Following feed, but nothing will be sent to you.</p> : null}
        <div className="mt-5 border-t border-line-soft pt-4">
          <SavedNote message={lastChange} idle="Changes save as you switch." />
        </div>
      </Section>

      <Section id="set-messages" title="Messages" description="How your conversations with brands work. Refunds, returns and delivery problems stay on each order page.">
        <ReadReceiptsSetting />
      </Section>

      <Section id="set-help" title="Help" description="Questions about an order, a payment or your account. A person on the Yard team replies in your inbox.">
        <div className="flex flex-wrap items-center gap-3">
          <MessageSupportButton variant="primary" />
          <Link href="/support" className="text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline">
            Support and answers
          </Link>
        </div>
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

      <Section id="set-signout" title="Sign out" description={`Sign out of ${site.name} on this device. Your cart stays here for next time.`}>
        <Button
          variant="secondary"
          onClick={async () => {
            // The server confirms first; on failure the store keeps the account and shows why.
            if (!(await signOut())) return
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
