"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import {
  PulseIcon,
  SealCheckIcon,
  MoneyIcon,
  FlagIcon,
  SquaresFourIcon,
  SignOutIcon,
  MegaphoneIcon,
  ShieldCheckIcon,
  ShoppingCartIcon,
  UsersIcon,
  BellIcon,
  ListChecksIcon,
  ReceiptIcon,
  UserIcon,
  WalletIcon,
  HeartbeatIcon,
  UserSwitchIcon,
  ChatsCircleIcon,
  CircleNotchIcon,
  ImagesSquareIcon,
  RankingIcon,
  TruckIcon,
  HandPalmIcon,
  MapPinAreaIcon,
  PlugsConnectedIcon,
  ShieldWarningIcon,
  CalendarXIcon,
  ProhibitIcon,
} from "@phosphor-icons/react"
import { AppShell, type ShellNavGroup, type ShellSearch } from "@/components/dashboard/app-shell"
import { useLiveMoney } from "@/components/admin/finance/live-counts"
import { DemoAccountMenuBridge, SIGN_OUT_HREF, SWITCH_ACCOUNT_HREF } from "@/components/session/demo-account-menu"
import { WorkspaceNote } from "@/components/session/workspace-note"
import { PaletteGroup, PaletteItem, matches, queryTerms, topMatches } from "@/components/dashboard/shell/command-palette"
import { buildOrderRows, type OrderRow } from "@/components/admin/finance/derive"
import { moderationReasonMeta, moderationStatusMeta } from "@/components/admin/marketplace/meta"
import { healthServices, type BrandApplication, type Payout, type PlatformUser } from "@/lib/data/admin"
import { CommandItem } from "@/components/ui/command"
import { getQueueCounts, listChartFlags, listContent, listDelivery, listMessages } from "@/lib/api/admin"
import type { QueueCountsDto } from "@/lib/api/contracts/admin"
import { useApi } from "@/lib/api/use-api"
import { adminRoleLabels, canAdmin, type AdminPermission } from "@/lib/permissions"
import { useRealtimeEvent } from "@/lib/realtime/use-realtime"
import { useServerSession } from "@/lib/session/use-server-session"
import { categories } from "@/lib/data/catalog"
import { formatMoney } from "@/lib/money"
import { useAdmin } from "@/lib/stores/admin"
import { useOrders } from "@/lib/stores/orders"
import { site } from "@/config/site"
import { YardLogo } from "@/components/brand/yard-logo"
import { cn } from "@/lib/utils"
import { useBrandApplications } from "@/components/admin/marketplace/onboarding"

/** System status pill for the top bar: operational, or how many services are degraded. A static dot: nothing loops for attention. */
function SystemStatus() {
  const degraded = healthServices.filter((s) => s.status !== "operational").length
  return (
    <Link
      href="/admin/health"
      className={cn(
        "hidden h-10 items-center gap-2 rounded-full border px-3.5 text-[12px] transition-colors duration-150 md:inline-flex",
        // Degraded reads as attention in ink (StatusBadge's attention tone): acid is kept for the one primary action.
        degraded ? "border-ink/70 text-ink hover:bg-white/[0.05]" : "border-white/[0.08] bg-white/[0.025] text-ink-2 hover:text-ink",
      )}
    >
      <span aria-hidden className={cn("inline-flex size-2 rounded-full", degraded ? "bg-ink ring-2 ring-ink/25" : "bg-violet")} />
      {degraded ? `${degraded} ${degraded === 1 ? "service" : "services"} degraded` : "All systems operational"}
    </Link>
  )
}

const applicationStatus: Record<BrandApplication["status"], string> = { pending_review: "Pending review", verified: "Verified", restricted: "Restricted", suspended: "Suspended" }
const userStatus: Record<PlatformUser["status"], string> = { active: "Active", restricted: "Restricted", suspended: "Suspended" }
const payoutStatus: Record<Payout["status"], string> = { awaiting_approval: "Awaiting approval", scheduled: "Scheduled", processing: "Processing", paid: "Paid", held: "On hold" }

const categoryName = new Map(categories.map((c) => [c.slug as string, c.name]))

/**
 * Command palette records: brands, users, moderation cases, orders (by reference or customer)
 * and payouts. Each opens on its own screen through the URL (?review=, ?case=, ?user=,
 * ?order=, ?focus=), on the page you're on too.
 */
function AdminResults({ query, go }: { query: string; go: (href: string) => void }) {
  // Live Studio applications too, as the Brands page lists them.
  const { applications } = useBrandApplications()
  const users = useAdmin((s) => s.users)
  const samplePayouts = useAdmin((s) => s.payouts)
  const clientOrders = useOrders((s) => s.orders)
  const groups = useOrders((s) => s.groups)
  const refunds = useAdmin((s) => s.refunds)
  const moderation = useAdmin((s) => s.moderation)
  // A real admin's Orders and Finance read the server, which doesn't know the sample orders' and
  // payouts' ids, so the palette leaves those out rather than open a record that isn't there.
  const { live } = useLiveMoney()
  const payouts = live ? [] : samplePayouts
  // The Orders page's own rows, so the palette finds what its search finds (checkout reference and email too).
  const sampleOrders = useMemo(() => buildOrderRows(clientOrders, groups, refunds), [clientOrders, groups, refunds])
  const orders = live ? [] : sampleOrders
  if (!query) return null

  // An order found by its checkout reference or the customer's email says so in its detail line.
  const terms = queryTerms(query)
  const matchedBy = (r: OrderRow) => {
    if (matches(query, r.order.reference, r.customer.name, r.brand.name)) return ""
    if (terms.some((t) => r.groupRef.toLowerCase().includes(t))) return `, checkout ${r.groupRef}`
    if (terms.some((t) => r.customer.email.toLowerCase().includes(t))) return `, ${r.customer.email}`
    return ""
  }

  const b = topMatches(applications, query, (x) => x.brandName, (x) => [x.handle, x.country, categoryName.get(x.category), applicationStatus[x.status]])
  const m = topMatches(moderation, query, (x) => x.title, (x) => [x.brandName, moderationReasonMeta[x.reason].label, moderationStatusMeta[x.status].label])
  const u = topMatches(users, query, (x) => x.name, (x) => [x.email, x.country, userStatus[x.status]])
  const o = topMatches(orders, query, (x) => x.order.reference, (x) => [x.search])
  const p = topMatches(payouts, query, (x) => x.brandName, (x) => [x.id, payoutStatus[x.status], x.method])
  return (
    <>
      {b.length ? (
        <PaletteGroup heading="Brands">
          {b.map((x) => (
            <PaletteItem key={x.id} value={`brand ${x.id}`} icon={SealCheckIcon} title={x.brandName} detail={`${applicationStatus[x.status]}, ${categoryName.get(x.category) ?? x.category}`} onSelect={() => go(`/admin/brands?review=${encodeURIComponent(x.id)}`)} />
          ))}
        </PaletteGroup>
      ) : null}
      {u.length ? (
        <PaletteGroup heading="Users">
          {u.map((x) => (
            <PaletteItem
              key={x.id}
              value={`user ${x.id}`}
              icon={UserIcon}
              title={x.name}
              detail={`${x.email}, ${x.country}, ${x.orders} ${x.orders === 1 ? "order" : "orders"}`}
              meta={userStatus[x.status]}
              onSelect={() => go(`/admin/users?user=${encodeURIComponent(x.id)}`)}
            />
          ))}
        </PaletteGroup>
      ) : null}
      {m.length ? (
        <PaletteGroup heading="Listings">
          {m.map((x) => (
            <PaletteItem key={x.id} value={`case ${x.id}`} icon={FlagIcon} title={x.title} detail={`${moderationReasonMeta[x.reason].label}, ${x.brandName}`} meta={moderationStatusMeta[x.status].label} onSelect={() => go(`/admin/products?case=${encodeURIComponent(x.id)}`)} />
          ))}
        </PaletteGroup>
      ) : null}
      {o.length ? (
        <PaletteGroup heading="Orders">
          {o.map((x) => (
            <PaletteItem key={x.order.id} value={`order ${x.order.id}`} icon={ReceiptIcon} title={`#${x.order.reference}`} detail={`${x.customer.name}, ${x.brand.name}${matchedBy(x)}`} meta={formatMoney(x.totalUsd, "USD")} onSelect={() => go(`/admin/orders?order=${encodeURIComponent(x.order.id)}`)} />
          ))}
        </PaletteGroup>
      ) : null}
      {p.length ? (
        <PaletteGroup heading="Payouts">
          {p.map((x) => (
            <PaletteItem key={x.id} value={`payout ${x.id}`} icon={WalletIcon} title={x.brandName} detail={`${payoutStatus[x.status]}, ${x.method}`} meta={formatMoney(x.amountUsd, "USD")} onSelect={() => go(`/admin/finance?tab=payouts&focus=${encodeURIComponent(x.id)}`)} />
          ))}
        </PaletteGroup>
      ) : null}
    </>
  )
}

/** The query once it has stopped changing for `ms` (the palette's server records wait for it). */
function useDebounced(value: string, ms: number) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return settled
}

/**
 * The palette's server records (§7.6): message reports and held messages (reason, parties and
 * status only, never a message body), reported posts and places, chart flags and delivery issues.
 * Only the queues the admin's role may view are asked for; each fetch waits 200ms after typing
 * stops, with a loading row meanwhile so "No matches" never flashes first.
 */
function AdminServerResults({ query, go }: { query: string; go: (href: string) => void }) {
  const admin = useServerSession((s) => s.admin)
  const settled = useDebounced(query, 200)
  const q = settled.length >= 2 ? settled : ""
  const can = (p: AdminPermission) => !!admin && canAdmin(admin.role, p)
  const on = !!admin && !!q
  const reported = useApi(on && can("messages.view_reports") ? "/api/admin/messages?tab=reported" : null, () => listMessages("reported"), { revalidateOnFocus: false })
  const held = useApi(on && can("messages.view_reports") ? "/api/admin/messages?tab=held" : null, () => listMessages("held"), { revalidateOnFocus: false })
  const posts = useApi(on && can("content.moderate") ? "/api/admin/content?tab=posts" : null, () => listContent("posts"), { revalidateOnFocus: false })
  const places = useApi(on && can("places.moderate") ? "/api/admin/content?tab=places" : null, () => listContent("places"), { revalidateOnFocus: false })
  const flags = useApi(on && can("charts.review") ? "/api/admin/charts/flags?status=open" : null, () => listChartFlags("open"), { revalidateOnFocus: false })
  const complaints = useApi(on && can("shipping.view") ? "/api/admin/delivery?tab=complaints" : null, () => listDelivery("complaints"), { revalidateOnFocus: false })
  if (!admin || query.length < 2) return null
  const all = [reported, held, posts, places, flags, complaints]
  const waiting = query !== settled || all.some((x) => x.isLoading && !x.data)

  const msgs = topMatches([...(reported.data?.items ?? []), ...(held.data?.items ?? [])], q, (x) => x.reasonLabel, (x) => [x.brand.name, x.customer.name, x.reporter?.name, x.status, x.kind === "held" ? "held" : "report"])
  const postRows = posts.data?.tab === "posts" ? posts.data.posts : []
  const placeRows = places.data?.tab === "places" ? places.data.places : []
  const content = topMatches(postRows, q, (x) => x.brand.name, (x) => [x.source, x.visibility, "post"])
  const placeHits = topMatches(placeRows, q, (x) => x.name, (x) => [x.brand.name, x.kind, x.neighbourhood, x.city, "place"])
  const flagHits = topMatches(flags.data?.items ?? [], q, (x) => x.brand.name, (x) => [x.detectorLabel, x.severity, "flag"])
  const issues = topMatches(complaints.data?.items ?? [], q, (x) => x.reference, (x) => [x.brand.name, x.customer.name, x.complaintKind, x.status, "complaint"])
  return (
    <>
      {msgs.length ? (
        <PaletteGroup heading="Message reports">
          {msgs.map((x) => (
            <PaletteItem key={`${x.kind}-${x.id}`} value={`message ${x.kind} ${x.id}`} icon={x.kind === "held" ? HandPalmIcon : ChatsCircleIcon} title={x.kind === "held" ? `Held: ${x.reasonLabel}` : x.reasonLabel} detail={`${x.customer.name} and ${x.brand.name}`} meta={x.status.replace(/_/g, " ")} onSelect={() => go(`/admin/messages?tab=${x.kind === "held" ? "held" : "reported"}&case=${encodeURIComponent(x.id)}`)} />
          ))}
        </PaletteGroup>
      ) : null}
      {content.length || placeHits.length ? (
        <PaletteGroup heading="Content and places">
          {content.map((x) => (
            <PaletteItem key={x.id} value={`post ${x.id}`} icon={ImagesSquareIcon} title={`Post by ${x.brand.name}`} detail={`${x.source}, ${x.visibility}`} onSelect={() => go(`/admin/content?tab=posts&case=${encodeURIComponent(x.id)}`)} />
          ))}
          {placeHits.map((x) => (
            <PaletteItem key={x.id} value={`place ${x.id}`} icon={MapPinAreaIcon} title={x.name} detail={`${x.brand.name}, ${x.neighbourhood ? `${x.neighbourhood}, ` : ""}${x.city}`} onSelect={() => go(`/admin/content?tab=places&case=${encodeURIComponent(x.id)}`)} />
          ))}
        </PaletteGroup>
      ) : null}
      {flagHits.length ? (
        <PaletteGroup heading="Chart flags">
          {flagHits.map((x) => (
            <PaletteItem key={x.id} value={`flag ${x.id}`} icon={ShieldWarningIcon} title={x.brand.name} detail={`${x.detectorLabel}, ${x.severity} severity`} meta={x.status} onSelect={() => go(`/admin/charts?tab=flags&flag=${encodeURIComponent(x.id)}`)} />
          ))}
        </PaletteGroup>
      ) : null}
      {issues.length ? (
        <PaletteGroup heading="Delivery issues">
          {issues.map((x) => (
            <PaletteItem key={x.id} value={`delivery ${x.id}`} icon={TruckIcon} title={`#${x.reference}`} detail={`${x.customer.name}, ${x.brand.name}`} meta={x.status.replace(/_/g, " ")} onSelect={() => go(`/admin/delivery?tab=complaints&case=${encodeURIComponent(x.id)}`)} />
          ))}
        </PaletteGroup>
      ) : null}
      {waiting ? (
        <CommandItem disabled value="loading" className="gap-3 rounded-xl px-2.5 py-2 text-[13px] text-ink-3 data-[disabled=true]:opacity-100">
          <CircleNotchIcon aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
          Searching the trust and safety queues…
        </CommandItem>
      ) : null}
    </>
  )
}

function AdminAllResults({ query, go }: { query: string; go: (href: string) => void }) {
  return (
    <>
      <AdminResults query={query} go={go} />
      <AdminServerResults query={query} go={go} />
    </>
  )
}

const search: ShellSearch = {
  placeholder: "Search brands, users, cases, orders, payouts",
  destinations: [
    { label: "Held messages", href: "/admin/messages?tab=held", icon: HandPalmIcon, hint: "Trust & safety" },
    { label: "Places to review", href: "/admin/content?tab=places", icon: MapPinAreaIcon, hint: "Trust & safety" },
    { label: "Social integrations", href: "/admin/content?tab=integrations", icon: PlugsConnectedIcon, hint: "Trust & safety" },
    { label: "Chart flags", href: "/admin/charts?tab=flags", icon: ShieldWarningIcon, hint: "Trust & safety" },
    { label: "Delivery complaints", href: "/admin/delivery?tab=complaints", icon: TruckIcon, hint: "Marketplace" },
    { label: "Holidays", href: "/admin/delivery?tab=holidays", icon: CalendarXIcon, hint: "Marketplace" },
    { label: "Abuse", href: "/admin/users?tab=abuse", icon: ProhibitIcon, hint: "Marketplace" },
    { label: "Notifications", href: "/admin/notifications", icon: BellIcon },
  ],
  Results: AdminAllResults,
}

function useAdminReady() {
  return useSyncExternalStore(
    (cb) => useAdmin.persist.onFinishHydration(cb),
    () => useAdmin.persist.hasHydrated(),
    () => false,
  )
}

/** The demo admin the browser-data admin pages act as (Kemi Ajayi, Owner). */
const LEGACY_ADMIN_ID = "adm_1"
const LEGACY_ADMIN_NOTE = "Legacy pages act as Kemi Ajayi in this browser."

/** The internal Admin Control Center: a control room — dense, operational, data-first. */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const ready = useAdminReady()
  // Advertising and Health have only sample data so far: demo and development only (production
  // serves them as "coming soon", src/proxy.ts). Hidden until the session says which, so production
  // never flashes them. Production badges also count only the server's records, never this
  // browser's sample queues (sample applications, flagged listings, refunds, payouts, campaigns).
  const sampleData = useServerSession((s) => s.sampleData === true)
  // The Brands queue as the page counts it: live Studio applications and, in the demo, sample ones.
  const pendingBrands = useBrandApplications().applications.filter((a) => a.status === "pending_review" && (sampleData || !!a.onboardingId)).length
  const sampleModeration = useAdmin((s) => s.moderation.filter((m) => m.status === "open" || m.status === "escalated").length)
  const openModeration = sampleData ? sampleModeration : 0
  const sampleRefunds = useAdmin((s) => s.refunds.filter((r) => r.status === "requested").length)
  const samplePayouts = useAdmin((s) => s.payouts.filter((p) => p.status === "awaiting_approval" || p.status === "held").length)
  // A real admin's Finance reads the server: its badge counts the server's payouts awaiting approval
  // (for the Owner and Finance roles), never the sample store's.
  const money = useLiveMoney()
  const refunds = money.live || !sampleData ? 0 : sampleRefunds
  const payoutsToApprove = money.live || !sampleData ? (money.payoutsToDecide ?? 0) : samplePayouts
  const sampleInReview = useAdmin((s) => s.campaigns.filter((c) => c.status === "in_review").length)
  const inReview = sampleData ? sampleInReview : 0
  // Counts appear once the store has loaded from this browser, so they never flash a stale figure.
  const n = (v: number) => (ready && v > 0 ? v : undefined)

  // The demo admin session (§2.3): the account row names who is signed in on the server.
  const session = useServerSession()
  const admin = session.admin
  // The server queues (§7.6): GET /api/admin/queues/counts, refetched whenever the admin stream
  // says the counts changed (moderation.counts). Each count is only present when the role may see
  // that queue. Unknown or zero shows no badge.
  const counts = useApi<QueueCountsDto>(admin ? `/api/admin/queues/counts#${admin.id}` : null, getQueueCounts)
  useRealtimeEvent("moderation.counts", () => void counts.revalidate())
  const c = admin ? counts.data : undefined
  const q = (v: number | undefined) => (v && v > 0 ? v : undefined)
  // A queue's item shows for an admin whose role holds its view permission (§8.1). Signed out, it
  // shows (the page asks to sign in); while the session loads, it waits, so it never flashes in or out.
  const sees = (...p: AdminPermission[]) => session.status === "ready" && (!admin || p.some((x) => canAdmin(admin.role, x)))
  const serverDecisions = (c?.messages ?? 0) + (c?.content ?? 0) + (c?.places ?? 0) + (c?.charts ?? 0) + (c?.delivery ?? 0)
  const decisions = pendingBrands + openModeration + refunds + payoutsToApprove + inReview + serverDecisions

  type Item = ShellNavGroup["items"][number]
  /** The item, or nothing when the admin can't view that queue. */
  const when = (show: boolean, item: Item): Item[] => (show ? [item] : [])
  // §7.6: 13 items. "Listings" is the old Moderation page (/admin/products, unchanged URL), renamed
  // because the Trust & safety group now holds four kinds of moderation (§7.8 decision 6).
  const groups: ShellNavGroup[] = [
    { items: [{ href: "/admin", label: "Overview", icon: SquaresFourIcon }] },
    {
      label: "Marketplace",
      items: [
        { href: "/admin/brands", label: "Brands", icon: SealCheckIcon, badge: n(pendingBrands), badgeLabel: "to review", tone: "attention" },
        { href: "/admin/users", label: "Users", icon: UsersIcon, badge: q(c?.abuse), badgeLabel: "abuse alerts", tone: "attention" },
        // A real admin sees Orders with shipping.view, as GET /api/orders/admin checks; demo and signed-out keep it.
        ...when(!money.live || sees("shipping.view"), { href: "/admin/orders", label: "Orders", icon: ShoppingCartIcon }),
        ...when(sees("shipping.view"), { href: "/admin/delivery", label: "Delivery", icon: TruckIcon, badge: q(c?.delivery), badgeLabel: "open issues", tone: "attention" }),
      ],
    },
    {
      label: "Trust & safety",
      items: [
        { href: "/admin/products", label: "Listings", icon: FlagIcon, badge: n(openModeration), badgeLabel: "open or escalated", tone: "attention" },
        ...when(sees("messages.view_reports"), { href: "/admin/messages", label: "Messages", icon: ChatsCircleIcon, badge: q(c?.messages), badgeLabel: "reports and held", tone: "attention" }),
        ...when(sees("content.moderate", "places.moderate", "social.manage"), { href: "/admin/content", label: "Content", icon: ImagesSquareIcon, badge: q((c?.content ?? 0) + (c?.places ?? 0)), badgeLabel: "to review", tone: "attention" }),
        ...when(sees("charts.review", "sponsored.view"), { href: "/admin/charts", label: "Charts", icon: RankingIcon, badge: q(c?.charts), badgeLabel: "flags and freezes", tone: "attention" }),
      ],
    },
    {
      label: "Money",
      items: [
        // The finance service answers the Owner and Finance roles only (ADMIN_FINANCE_ROLES).
        ...when(!money.live || money.finance, { href: "/admin/finance", label: "Finance", icon: MoneyIcon, badge: money.live ? q(payoutsToApprove) : n(refunds + payoutsToApprove), badgeLabel: "to decide", tone: "attention" }),
        ...when(sampleData, { href: "/admin/advertising", label: "Advertising", icon: MegaphoneIcon, badge: n(inReview), badgeLabel: "in review", tone: "attention" }),
      ],
    },
    {
      label: "Platform",
      items: [
        ...when(sampleData, { href: "/admin/health", label: "Health", icon: PulseIcon }),
        { href: "/admin/security", label: "Security", icon: ShieldCheckIcon },
      ],
    },
  ]

  const demoOn = !!session.demoAuth?.admin
  // The existing admin pages keep their browser data and act as Kemi Ajayi (the Owner, adm_1);
  // say so whenever the server session is someone else, or nobody (§1.11, §8.3).
  const legacyNote = session.status === "ready" && admin?.id !== LEGACY_ADMIN_ID
  const initials = (admin?.name ?? "")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <AppShell
      surface="admin"
      root="/admin"
      density="dense"
      groups={groups}
      search={search}
      workspace={{
        mark: (
          // The square mark, as on the app icon: the acid logo on obsidian. The name beside it says "Yard".
          <span className="inline-flex size-8 items-center justify-center rounded-[9px] border border-white/12 bg-obsidian">
            <YardLogo decorative className="h-auto w-[26px]" />
          </span>
        ),
        // The logo names the workspace ("Yard"), in the trigger and in the menu's label.
        name: <YardLogo className="block h-[18px]" />,
        caption: (
          <>
            Control Center
            <span className="rounded-[4px] border border-white/15 px-1 py-px text-[10px] leading-none font-medium text-ink-2">Internal</span>
          </>
        ),
        label: `${site.name} Control Center`,
        menu: [
          { label: "Notifications", href: "/admin/notifications", icon: BellIcon },
          { label: "Security and audit log", href: "/admin/security", icon: ShieldCheckIcon },
          ...(sampleData ? [{ label: "System health", href: "/admin/health", icon: HeartbeatIcon }] : []),
          ...(demoOn ? [{ label: "Switch demo admin…", href: SWITCH_ACCOUNT_HREF, icon: UserSwitchIcon, separated: true }] : []),
          // Signing out never depends on the demo flag: whoever holds a session can always end it.
          ...(admin ? [{ label: "Sign out of demo account", href: SIGN_OUT_HREF, icon: SignOutIcon, separated: !demoOn }] : []),
          { label: "Leave the Control Center", href: "/", icon: SignOutIcon, separated: true },
        ],
      }}
      status={{
        icon: ListChecksIcon,
        // Until the store loads, the card shows a skeleton under the usual label; only a cleared
        // queue (known once loaded) relabels it.
        label: ready && decisions === 0 ? "Decision queue" : "Decisions waiting",
        value: ready ? (decisions > 0 ? decisions : "Queue clear") : null,
        quiet: decisions === 0,
        action: decisions > 0 ? "Open the decision queue" : "Nothing needs a decision",
        // The Overview's Decision queue panel carries this anchor; Next scrolls to it, also from /admin itself.
        href: "/admin#decision-queue",
        attention: decisions > 0,
        dot: decisions > 0,
        summary: decisions > 0 ? `${decisions} ${decisions === 1 ? "decision" : "decisions"} waiting` : "Queue clear",
      }}
      account={
        admin
          ? { initials, name: admin.name, caption: `${adminRoleLabels[admin.role]}, demo account` }
          : session.status === "loading"
            ? { initials: "", name: "Control Center", caption: "Checking your session" }
            : session.status === "error"
              ? { initials: "!", name: "Session unavailable", caption: "Couldn't reach Yard" }
              : { initials: "–", name: "Not signed in", caption: "Demo accounts" }
      }
      topbar={
        <>
          {legacyNote ? <WorkspaceNote text={LEGACY_ADMIN_NOTE} label="About whose account these pages use" /> : null}
          {/* Its status comes from the sample health data, so it shows in demo and development only. */}
          {sampleData ? <SystemStatus /> : null}
        </>
      }
    >
      {children}
      <DemoAccountMenuBridge surface="admin" />
    </AppShell>
  )
}
