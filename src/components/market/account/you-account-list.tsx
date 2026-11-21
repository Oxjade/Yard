"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import {
  BellRingingIcon,
  CaretRightIcon,
  ChatsCircleIcon,
  HeartIcon,
  LifebuoyIcon,
  PackageIcon,
  SignOutIcon,
  SlidersHorizontalIcon,
  SparkleIcon,
  StorefrontIcon,
  UsersThreeIcon,
  type Icon,
} from "@phosphor-icons/react"
import { toast } from "sonner"
import { PhotoOrInitials } from "@/components/media/person-photo"
import { useHydrated } from "@/hooks/use-hydrated"
import { api } from "@/lib/api/client"
import type { BrandMembershipDto } from "@/lib/api/contracts/studio-app"
import { errorMessage } from "@/lib/api/errors"
import { afterIdentityChange } from "@/lib/session/identity"
import { useServerSession } from "@/lib/session/use-server-session"
import { useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"
import { firstName } from "./format"
import { useYouCounts } from "./you-nav"

/**
 * The top of Your World (/you): who you are, then every place in your account as one grouped
 * list (the settings-list pattern of the apps), with the real counts and badges each place has
 * today. Replaces the row of empty boxes the page used to open with; the content sections below
 * it only show once there's something in them.
 */

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`

function Badge({ children, tone = "acid" }: { children: React.ReactNode; tone?: "acid" | "violet" | "muted" }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-xs font-medium tabular",
        tone === "acid" && "bg-acid text-black",
        tone === "violet" && "bg-purple/20 text-violet",
        tone === "muted" && "bg-elevated text-ink-2",
      )}
    >
      {children}
    </span>
  )
}

type RowProps = {
  icon: Icon
  label: string
  /** The quiet value on the right ("3", "All read"). */
  value?: React.ReactNode
  badge?: React.ReactNode
  href?: string
  onClick?: () => void
  pending?: boolean
  tone?: "default" | "danger"
  /** A brand logo or initials instead of the icon. */
  lead?: React.ReactNode
  srExtra?: string
}

function Row({ icon: I, label, value, badge, href, onClick, pending, tone = "default", lead, srExtra }: RowProps) {
  const inner = (
    <>
      <span className={cn("inline-flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full", tone === "danger" ? "bg-danger/10 text-danger" : "bg-elevated text-ink")}>
        {lead ?? <I className="size-[18px]" weight="bold" aria-hidden />}
      </span>
      <span className={cn("min-w-0 flex-1 truncate text-[0.9375rem]", tone === "danger" ? "text-danger" : "text-ink")}>
        {label}
        {srExtra ? <span className="sr-only">, {srExtra}</span> : null}
      </span>
      {badge}
      {value !== undefined && value !== null ? <span className="shrink-0 text-sm text-ink-2 tabular">{value}</span> : null}
      {tone === "danger" ? null : <CaretRightIcon className="size-4 shrink-0 text-ink-3" weight="bold" aria-hidden />}
    </>
  )
  const cls = cn(
    "flex min-h-14 w-full items-center gap-3.5 px-4 py-2.5 text-left transition-colors hover:bg-elevated/60 focus-visible:bg-elevated/60 focus-visible:outline-none",
    pending && "pointer-events-none opacity-60",
  )
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls} aria-busy={pending || undefined}>
      {inner}
    </button>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="px-1 text-base font-semibold text-ink">{title}</h2>
      <ul className="mt-3 divide-y divide-line-soft overflow-hidden rounded-[22px] border border-line-soft bg-card">{children}</ul>
    </section>
  )
}

const statusWords: Record<BrandMembershipDto["status"], { text: string; tone: "acid" | "violet" | "muted" } | null> = {
  pending_review: { text: "In review", tone: "violet" },
  approved: null,
  claimed: null,
  restricted: { text: "Restricted", tone: "muted" },
  suspended: { text: "Suspended", tone: "muted" },
}

export function YouAccountList({ onTheWay }: { onTheWay: number | null }) {
  const router = useRouter()
  const hydrated = useHydrated()
  const user = useSession((s) => s.user)!
  const onboarded = useSession((s) => s.onboarded)
  const signOut = useSession((s) => s.signOut)
  const shopper = useServerSession((s) => (s.shopper && s.shopper.id === user.id ? s.shopper : null))
  const { counts, ordersLoading } = useYouCounts()
  const [opening, setOpening] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const brands = shopper?.brands ?? []
  const email = shopper?.email ?? user.email
  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")

  const count = (n: number | null | undefined) => (hydrated && n ? n.toLocaleString("en-GB") : hydrated && n === 0 ? "0" : null)

  // Studio opens in this browser with the shop session you already have (no second sign-in).
  const openStudio = async (b: BrandMembershipDto) => {
    setOpening(b.id)
    try {
      await api("/api/studio/session/switch", { body: { brandId: b.id } })
      await afterIdentityChange("studio")
      router.push("/studio")
    } catch (e) {
      toast.error(errorMessage(e))
      setOpening(null)
    }
  }

  return (
    <div className="grid gap-8">
      <header className="relative overflow-hidden rounded-[28px] border border-line-soft bg-card p-5 md:p-6">
        <span aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-56 rounded-full bg-purple/30 blur-3xl" />
        <div className="relative flex items-center gap-4">
          <Link href="/you/settings" aria-label="Your photo and details" className="inline-flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-purple text-lg font-semibold text-ink ring-2 ring-black/40">
            <PhotoOrInitials src={shopper?.photoSrc ?? null}>
              <span aria-hidden>{initials}</span>
            </PhotoOrInitials>
          </Link>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-violet">Hello, {firstName(user.name)}</p>
            <h1 className="mt-1 truncate font-display text-display-sm text-ink uppercase">{user.name}</h1>
            {email ? <p className="mt-1 truncate text-sm text-ink-2">{email}</p> : null}
          </div>
          <Link href="/you/settings" className="press hidden h-9 shrink-0 items-center rounded-full bg-elevated px-4 text-sm text-ink transition-colors hover:bg-line sm:inline-flex">
            Edit
          </Link>
        </div>
        <Link href="/you/settings" className="press relative mt-4 flex h-10 items-center justify-center rounded-full bg-elevated text-sm text-ink sm:hidden">
          Edit profile
        </Link>
      </header>

      <Group title="Shopping">
        <li>
          <Row
            icon={PackageIcon}
            label="Orders"
            href="/you/orders"
            badge={hydrated && onTheWay ? <Badge>{plural(onTheWay, "on the way", "on the way")}</Badge> : null}
            value={ordersLoading ? <span className="inline-block h-3 w-4 rounded-sm skeleton align-middle" aria-hidden /> : count(counts.orders)}
          />
        </li>
        <li>
          <Row icon={HeartIcon} label="Saved" href="/wishlist" value={count(counts.wishlist)} />
        </li>
        <li>
          <Row icon={UsersThreeIcon} label="Following" href="/following" value={count(counts.following)} />
        </li>
        <li>
          <Row icon={BellRingingIcon} label="Drop reminders" href="/you/drops" value={count(counts.drops)} />
        </li>
        <li>
          <Row
            icon={ChatsCircleIcon}
            label="Inbox"
            href="/inbox"
            badge={hydrated && counts.inbox ? <Badge>{`${counts.inbox} new`}</Badge> : null}
            value={hydrated && !counts.inbox ? "All read" : undefined}
            srExtra={hydrated && counts.inbox ? plural(counts.inbox, "unread conversation", "unread conversations") : undefined}
          />
        </li>
      </Group>

      <Group title="Selling">
        {brands.length ? (
          brands.map((b) => {
            const s = statusWords[b.status]
            return (
              <li key={b.id}>
                <Row
                  icon={StorefrontIcon}
                  label={b.name}
                  lead={
                    b.logoSrc && !b.logoSrc.includes("as=brand") ? (
                      <PhotoOrInitials src={b.logoSrc}>
                        <span className="text-xs font-semibold">{b.initials}</span>
                      </PhotoOrInitials>
                    ) : (
                      <span className="text-xs font-semibold">{b.initials}</span>
                    )
                  }
                  badge={s ? <Badge tone={s.tone}>{s.text}</Badge> : null}
                  value={b.canOpenStudio ? "Studio" : undefined}
                  pending={opening === b.id}
                  onClick={b.canOpenStudio ? () => void openStudio(b) : undefined}
                  href={b.canOpenStudio ? undefined : "/support"}
                  srExtra={b.canOpenStudio ? "open Studio" : undefined}
                />
              </li>
            )
          })
        ) : (
          <li>
            <Row icon={StorefrontIcon} label="Sell on Yard" href="/sell" value="Open a shop" />
          </li>
        )}
      </Group>

      <Group title="Account">
        {!onboarded ? (
          <li>
            <Row icon={SparkleIcon} label="Tell us what you're into" href="/welcome?next=/you" badge={<Badge tone="violet">1 min</Badge>} />
          </li>
        ) : null}
        <li>
          <Row icon={SlidersHorizontalIcon} label="Settings" href="/you/settings" />
        </li>
        <li>
          <Row icon={LifebuoyIcon} label="Help and support" href="/support" />
        </li>
        <li>
          <Row
            icon={SignOutIcon}
            label="Sign out"
            tone="danger"
            pending={leaving}
            onClick={async () => {
              setLeaving(true)
              // The server confirms first; on failure the store keeps the account and shows why.
              if (!(await signOut())) return setLeaving(false)
              toast("Signed out", { description: "Sign in again any time to see your brands and orders." })
              router.push("/")
            }}
          />
        </li>
      </Group>
    </div>
  )
}
