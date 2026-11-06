"use client"

import { useState } from "react"
import Image from "next/image"
import { AnimatePresence, Reorder, motion, useDragControls } from "motion/react"
import { ArrowDownIcon as ArrowDown, ArrowUpIcon as ArrowUp, BookOpenIcon as BookOpen, CalendarDotsIcon as CalendarClock, DotsSixVerticalIcon as GripVertical, ImagesIcon as Images, SquaresFourIcon as LayoutGrid, LockIcon as Lock, BrowserIcon as PanelTop, MinusIcon, PlusIcon, ShareNetworkIcon as ShareNetwork, ShoppingBagOpenIcon as ShoppingBag, StarIcon as Star, type Icon } from "@phosphor-icons/react"
import Link from "next/link"
import { feedSettings, storefrontSections, storefrontTemplates } from "@/components/storefront/theme"
import { coverOf } from "@/components/storefront/social/post-tile"
import { Field, FieldMessage, Segmented, control, inputClass } from "@/components/studio/catalog/fields"
import { CatalogueNote } from "@/components/studio/catalog/parts"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import type { CurrencyCode } from "@/config/markets"
import type { Collection, Product, StorefrontSection, StorefrontSectionType } from "@/lib/data/types"
import { providerLabels, type FeedSource, type SocialAccountDto, type SocialPostDto } from "@/lib/api/contracts/social"
import { formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"
import { COLLECTIONS_MAX, FEATURED_MAX, HEADING_MAX, SOCIAL_MAX, SOCIAL_MIN, autoFeaturedCount, type EditorConfig, type FieldErrors } from "./model"
import type { Update } from "./content-controls"
import { ControlGroup } from "./parts"

const icons: Record<StorefrontSectionType, Icon> = {
  hero: PanelTop,
  "featured-products": Star,
  collections: LayoutGrid,
  drops: CalendarClock,
  story: BookOpen,
  lookbook: Images,
  "all-products": ShoppingBag,
  "social-feed": ShareNetwork,
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * What the editor knows about the brand's social posts and connections (§6.1), from the server.
 * `signed_out`: no brand session. `other_brand`: the session is another brand than this editor's.
 */
export type SocialEditorData = {
  status: "loading" | "ready" | "signed_out" | "other_brand" | "error"
  posts: SocialPostDto[] | null
  accounts: SocialAccountDto[] | null
}

const sourceWords: Record<FeedSource, string> = { all: "from Instagram, TikTok and uploads", instagram: "from Instagram", tiktok: "from TikTok", uploads: "you upload" }

/** "6 posts from Instagram, 1 pinned first". */
function socialSummary(section: StorefrontSection) {
  const { count, source } = feedSettings(section)
  const pinned = section.postIds?.length ?? 0
  return `${count} posts ${sourceWords[source]}${pinned ? `, ${pinned} pinned first` : ""}`
}

/** "connected as @lagosstatic", "not connected", "needs reconnecting". */
function accountWords(a: SocialAccountDto | undefined) {
  if (!a || a.status === "not_connected" || a.status === "disconnected") return "not connected"
  if (a.status === "connected") return `connected as @${a.handle ?? ""}${a.mode === "sandbox" ? " (sandbox)" : ""}`
  if (a.status === "needs_reauth") return "needs reconnecting"
  if (a.status === "revoked") return "access removed"
  return "connection error"
}

const firstPieces = (n: number) => (n === 0 ? "No published pieces yet" : n === 1 ? "Your first piece" : `Your first ${n} pieces`)

/** One line under a section's name: what it will show right now. */
function summary(section: StorefrontSection, config: EditorConfig, products: Product[], collections: Collection[]) {
  if (!section.enabled) return "Hidden"
  switch (section.type) {
    case "hero":
      return "Cover, logo and introduction"
    case "featured-products": {
      const picked = section.productIds?.filter((id) => products.some((p) => p.id === id)).length ?? 0
      return picked ? `${plural(picked, "piece")} you picked` : firstPieces(Math.min(autoFeaturedCount(config.template), products.length))
    }
    case "collections": {
      const picked = section.collectionIds?.filter((id) => collections.some((c) => c.id === id)).length ?? 0
      return picked ? `${plural(picked, "collection")} you picked` : `All ${plural(collections.length, "collection")}`
    }
    case "all-products":
      return `${plural(products.length, "published piece")}`
    case "social-feed":
      return socialSummary(section)
    default:
      return storefrontSections[section.type].description
  }
}

export function SectionsControls({
  config,
  products,
  collections,
  currency,
  errors,
  onChange,
  onLocate,
  onHighlight,
  onEditCover,
  social,
}: {
  config: EditorConfig
  products: Product[]
  collections: Collection[]
  /** The brand's currency: product prices are shown in it, as everywhere in Studio. */
  currency: CurrencyCode
  /** The brand's social posts and connections, for the Social feed section's settings. */
  social?: SocialEditorData
  errors: FieldErrors
  onChange: Update
  /** Scroll the preview to a section. */
  onLocate: (section: StorefrontSection) => void
  /** Outline a section in the preview while its row is hovered or focused. */
  onHighlight: (section: StorefrontSection | null) => void
  onEditCover: () => void
}) {
  const [hero, ...rest] = config.sections
  const [open, setOpen] = useState<string | null>(null)
  const [said, setSaid] = useState("")

  function setSections(next: StorefrontSection[]) {
    onChange({ sections: [hero, ...next] })
  }

  function patch(id: string, p: Partial<StorefrontSection>) {
    onChange((c) => ({ sections: c.sections.map((s) => (s.id === id ? { ...s, ...p } : s)) }))
  }

  function move(index: number, by: -1 | 1) {
    const to = index + by
    if (to < 0 || to >= rest.length) return
    const next = [...rest]
    const [item] = next.splice(index, 1)
    next.splice(to, 0, item)
    setSections(next)
    setSaid(`${storefrontSections[item.type].label} moved to position ${to + 2} of ${config.sections.length}.`)
    // Keep focus on a button that still works once the row reaches either end.
    requestAnimationFrame(() => {
      const edge = to === 0 ? "down" : to === rest.length - 1 ? "up" : by === -1 ? "up" : "down"
      document.getElementById(`sf-move-${edge}-${item.id}`)?.focus()
    })
  }

  return (
    <ControlGroup
      id="sf-sections-list"
      title="Sections"
      description={`Drag to reorder, or use the arrows. Hidden sections keep their settings. ${storefrontTemplates[config.template].label} styles every section.`}
    >
      <p className="sr-only" aria-live="polite">{said}</p>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {hero ? (
          <SectionCard
            section={hero}
            locked
            switchId="sf-sections-switch"
            invalid={!!errors.sections}
            config={config}
            products={products}
            collections={collections}
            currency={currency}
            open={open === hero.id}
            onToggleOpen={() => {
              setOpen(open === hero.id ? null : hero.id)
              if (hero.enabled) onLocate(hero)
            }}
            onPatch={(p) => patch(hero.id, p)}
            onHighlight={onHighlight}
            onLocate={onLocate}
            onEditCover={onEditCover}
            social={social}
          />
        ) : null}

        <Reorder.Group axis="y" values={rest} onReorder={setSections} as="ol" aria-label="Section order" className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {rest.map((section, i) => (
            <SectionCard
              key={section.id}
              section={section}
              index={i}
              count={rest.length}
              invalid={!!errors.sections}
              config={config}
              products={products}
              collections={collections}
              currency={currency}
              open={open === section.id}
              onToggleOpen={() => {
                setOpen(open === section.id ? null : section.id)
                if (section.enabled) onLocate(section)
              }}
              onPatch={(p) => patch(section.id, p)}
              onMove={(by) => move(i, by)}
              onHighlight={onHighlight}
              onLocate={onLocate}
              onEditCover={onEditCover}
              social={social}
            />
          ))}
        </Reorder.Group>
        <FieldMessage id="sf-sections" error={errors.sections} />
        <CatalogueNote className="pt-2">
          Product and collection sections preview your Studio catalogue. On your live storefront they list the marketplace catalogue until the catalogue backend is connected.
        </CatalogueNote>
      </div>
    </ControlGroup>
  )
}

function SectionCard({
  section,
  locked = false,
  switchId,
  invalid = false,
  index = 0,
  count = 1,
  config,
  products,
  collections,
  currency,
  open,
  onToggleOpen,
  onPatch,
  onMove,
  onHighlight,
  onLocate,
  onEditCover,
  social,
}: {
  section: StorefrontSection
  locked?: boolean
  /** For the first switch, which a failed publish focuses. */
  switchId?: string
  /** No section is on: every switch points at the message under the list. */
  invalid?: boolean
  index?: number
  count?: number
  config: EditorConfig
  products: Product[]
  collections: Collection[]
  currency: CurrencyCode
  open: boolean
  onToggleOpen: () => void
  onPatch: (p: Partial<StorefrontSection>) => void
  onMove?: (by: -1 | 1) => void
  onHighlight: (section: StorefrontSection | null) => void
  onLocate: (section: StorefrontSection) => void
  onEditCover: () => void
  social?: SocialEditorData
}) {
  const drag = useDragControls()
  const meta = storefrontSections[section.type]
  const Icon = icons[section.type]
  const label = section.title?.trim() || meta.label
  const panelId = `sf-section-${section.id}-settings`

  const body = (
    <>
      <div className="flex items-center gap-1 py-1.5 pr-2 pl-1">
        {locked ? (
          <span className="inline-flex h-8 w-6 shrink-0 items-center justify-center text-ink-3" title="The hero always comes first">
            <Lock className="size-3.5" aria-hidden />
            <span className="sr-only">Always first</span>
          </span>
        ) : (
          <span
            aria-hidden
            onPointerDown={(e) => {
              e.preventDefault()
              drag.start(e)
            }}
            style={{ touchAction: "none" }}
            className="inline-flex h-8 w-6 shrink-0 cursor-grab items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-white/[0.03] hover:text-ink active:cursor-grabbing"
          >
            <GripVertical className="size-4" />
          </span>
        )}

        <button
          type="button"
          onClick={onToggleOpen}
          aria-expanded={open}
          aria-controls={panelId}
          className={cn("flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-1 text-left outline-none transition-colors hover:bg-white/[0.03] focus-visible:ring-2 focus-visible:ring-violet", open && "bg-white/[0.03]")}
        >
          <Icon className={cn("size-4 shrink-0", section.enabled ? "text-ink-2" : "text-ink-3")} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate text-[13px]", section.enabled ? "text-ink" : "text-ink-3")}>{label}</span>
            <span className="block truncate text-[11px] text-ink-3">{summary(section, config, products, collections)}</span>
          </span>
        </button>

        {!locked && onMove ? (
          <span className="flex shrink-0">
            <Button id={`sf-move-up-${section.id}`} type="button" variant="ghost" size="icon-xs" className="size-9 md:size-7" aria-label={`Move ${meta.label} up`} disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp />
            </Button>
            <Button id={`sf-move-down-${section.id}`} type="button" variant="ghost" size="icon-xs" className="size-9 md:size-7" aria-label={`Move ${meta.label} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
              <ArrowDown />
            </Button>
          </span>
        ) : null}

        <Switch
          id={switchId}
          checked={section.enabled}
          aria-label={`Show ${meta.label}`}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "sf-sections-error" : undefined}
          className="ml-1"
          onCheckedChange={(enabled) => {
            onPatch({ enabled })
            if (enabled) requestAnimationFrame(() => onLocate({ ...section, enabled }))
          }}
        />
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div key="settings" id={panelId} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} className="grid gap-4 border-t border-line-soft px-3 pt-3 pb-4">
            <SectionSettings section={section} config={config} products={products} collections={collections} currency={currency} onPatch={onPatch} onEditCover={onEditCover} social={social} />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )

  const shell = cn("rounded-md border transition-colors", section.enabled ? "border-line-soft bg-surface" : "border-dashed border-line-soft bg-card")
  const hover = {
    onMouseEnter: () => section.enabled && onHighlight(section),
    onMouseLeave: () => onHighlight(null),
    onFocus: () => section.enabled && onHighlight(section),
    onBlur: () => onHighlight(null),
  }

  if (locked) {
    return (
      <div className={shell} {...hover}>
        {body}
      </div>
    )
  }

  return (
    <Reorder.Item
      value={section}
      dragListener={false}
      dragControls={drag}
      as="li"
      className={cn(shell, "relative min-w-0 list-none")}
      whileDrag={{ scale: 1.02 }}
      onDragEnd={() => onLocate(section)}
      {...hover}
    >
      {body}
    </Reorder.Item>
  )
}

function SectionSettings({
  section,
  config,
  products,
  collections,
  currency,
  onPatch,
  onEditCover,
  social,
}: {
  section: StorefrontSection
  config: EditorConfig
  products: Product[]
  collections: Collection[]
  currency: CurrencyCode
  onPatch: (p: Partial<StorefrontSection>) => void
  onEditCover: () => void
  social?: SocialEditorData
}) {
  const meta = storefrontSections[section.type]

  if (section.type === "hero") {
    return (
      <div className="grid gap-3">
        <p className="text-xs text-ink-2">{meta.description} The hero always opens your storefront.</p>
        <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={onEditCover}>
          Change logo and cover
        </Button>
      </div>
    )
  }

  const headingId = `sf-section-${section.id}-heading`
  return (
    <>
      <p className="text-xs text-ink-2">{meta.description}</p>
      <Field id={headingId} label="Heading" optional>
        <Input
          {...control(headingId)}
          value={section.title ?? ""}
          maxLength={HEADING_MAX}
          placeholder={meta.defaultTitle}
          className={inputClass}
          onChange={(e) => onPatch({ title: e.target.value || undefined })}
        />
      </Field>
      {section.type === "featured-products" ? (
        <ItemPicker
          id={`sf-section-${section.id}-products`}
          legend="Products to feature"
          max={FEATURED_MAX}
          autoNote={`Nothing picked: ${firstPieces(Math.min(autoFeaturedCount(config.template), products.length)).toLowerCase()}, in your catalogue order.`}
          empty="Publish a product to feature it here."
          items={products.map((p) => ({ id: p.id, name: p.name, image: p.images[0]?.src, meta: formatMoney(p.price, currency) }))}
          value={section.productIds ?? []}
          onChange={(ids) => onPatch({ productIds: ids.length ? ids : undefined })}
        />
      ) : null}
      {section.type === "collections" ? (
        <ItemPicker
          id={`sf-section-${section.id}-collections`}
          legend="Collections to show"
          max={COLLECTIONS_MAX}
          autoNote="Nothing picked: every collection, newest first."
          empty="Create a collection in Collections to show it here."
          items={collections.map((c) => ({ id: c.id, name: c.name, image: c.image.src, meta: plural(c.productIds.length, "piece") }))}
          value={section.collectionIds ?? []}
          onChange={(ids) => onPatch({ collectionIds: ids.length ? ids : undefined })}
        />
      ) : null}
      {section.type === "social-feed" ? <SocialFeedSettings section={section} onPatch={onPatch} social={social} /> : null}
    </>
  )
}

const postDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
const postSource = (p: SocialPostDto) => (p.source === "upload" ? "Upload" : p.sample ? "Sample" : p.provider ? `${providerLabels[p.provider]}${p.source === "sandbox" ? " sandbox" : ""}` : "Post")

/** The Social feed section's settings: source, layout, count, pinned posts, and each network's status. */
function SocialFeedSettings({ section, onPatch, social }: { section: StorefrontSection; onPatch: (p: Partial<StorefrontSection>) => void; social?: SocialEditorData }) {
  const feed = feedSettings(section)
  const id = `sf-section-${section.id}`
  const set = (p: Partial<NonNullable<StorefrontSection["feed"]>>) => onPatch({ feed: { ...feed, ...p } })
  const posts = social?.posts ?? []
  const ig = social?.accounts?.find((a) => a.provider === "instagram")
  const tt = social?.accounts?.find((a) => a.provider === "tiktok")
  return (
    <>
      <div className="grid gap-1.5">
        <p id={`${id}-source-label`} className="text-[13px] text-ink">Show posts from</p>
        <Segmented<FeedSource>
          id={`${id}-source`}
          label="Show posts from"
          labelledBy={`${id}-source-label`}
          value={feed.source}
          onChange={(source) => set({ source })}
          options={[
            { value: "all", label: "All" },
            { value: "instagram", label: "Instagram" },
            { value: "tiktok", label: "TikTok" },
            { value: "uploads", label: "Uploads" },
          ]}
        />
      </div>
      <div className="grid gap-1.5">
        <p id={`${id}-layout-label`} className="text-[13px] text-ink">Layout</p>
        <Segmented<"grid" | "rail">
          id={`${id}-layout`}
          label="Layout"
          labelledBy={`${id}-layout-label`}
          value={feed.layout}
          onChange={(layout) => set({ layout })}
          options={[
            { value: "grid", label: "Grid" },
            { value: "rail", label: "Rail" },
          ]}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <p id={`${id}-count-label`} className="text-[13px] text-ink">Posts to show</p>
        <div role="group" aria-labelledby={`${id}-count-label`} className="flex items-center gap-1 rounded-lg border border-line bg-surface/50 p-1">
          <Button type="button" variant="ghost" size="icon-xs" className="size-9 md:size-7" aria-label="Fewer posts" disabled={feed.count <= SOCIAL_MIN} onClick={() => set({ count: feed.count - 1 })}>
            <MinusIcon />
          </Button>
          <span className="w-8 text-center text-sm text-ink tabular" aria-live="polite" id={`${id}-count`}>
            {feed.count}
          </span>
          <Button type="button" variant="ghost" size="icon-xs" className="size-9 md:size-7" aria-label="More posts" disabled={feed.count >= SOCIAL_MAX} onClick={() => set({ count: feed.count + 1 })}>
            <PlusIcon />
          </Button>
        </div>
      </div>
      {social?.status === "ready" ? (
        <ItemPicker
          id={`${id}-pinned`}
          legend="Pinned posts"
          max={SOCIAL_MAX}
          autoNote="Nothing pinned: featured posts first, then the newest."
          empty="Nothing is on your storefront yet. Show posts in Content Studio to pin them here."
          items={posts.map((p) => ({ id: p.id, name: p.caption.split("\n")[0]?.trim().slice(0, 80) || "Untitled post", image: coverOf(p).src, meta: `${postSource(p)}, ${postDate(p.postedAt)}` }))}
          value={section.postIds ?? []}
          onChange={(ids) => onPatch({ postIds: ids.length ? ids : undefined })}
        />
      ) : (
        <p className="rounded-md border border-dashed border-line px-3 py-3 text-xs text-ink-2">
          {social?.status === "loading"
            ? "Loading your posts…"
            : social?.status === "other_brand"
              ? "Your demo session is for another brand, so its posts can't be pinned here."
              : social?.status === "error"
                ? "Couldn't load your posts. Pinning is back once they load."
                : "Sign in to Brand Studio to pin posts and preview your social feed."}
        </p>
      )}
      {social?.accounts ? (
        <p className="text-xs text-ink-2">
          Instagram: {accountWords(ig)}. TikTok: {accountWords(tt)}.{" "}
          <Link href="/studio/social?tab=connections" className="inline-flex min-h-10 items-center rounded-sm text-violet hover:underline md:min-h-0">
            Manage connections
          </Link>
        </p>
      ) : null}
    </>
  )
}

/** Choose which items a section features, in the order they're picked. */
export function ItemPicker({
  id,
  legend,
  max,
  autoNote,
  empty,
  items,
  value,
  onChange,
}: {
  id: string
  legend: string
  max: number
  autoNote: string
  empty: string
  items: { id: string; name: string; image?: string; meta: string }[]
  value: string[]
  onChange: (ids: string[]) => void
}) {
  const picked = value.filter((v) => items.some((i) => i.id === v))
  const full = picked.length >= max
  return (
    // A labelled group, as growth's Field as="legend" does: the count and Clear sit beside the label.
    <div role="group" aria-labelledby={`${id}-label`} className="grid min-w-0 gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <p id={`${id}-label`} className="text-[13px] font-medium text-ink">{legend}</p>
        {picked.length ? (
          <span className="flex items-baseline gap-3">
            <span className="text-xs text-ink-3 tabular">{picked.length} of {max}</span>
            <button type="button" onClick={() => onChange([])} className="rounded-sm text-xs text-violet hover:underline">
              Clear
            </button>
          </span>
        ) : null}
      </div>
      <p className="text-xs text-ink-3">{picked.length ? `Shown in the order you picked them. Up to ${max}.` : autoNote}</p>
      {items.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-xs text-ink-2">{empty}</p>
      ) : (
        <ul className="grid max-h-72 grid-cols-[minmax(0,1fr)] gap-0.5 overflow-y-auto rounded-md border border-line-soft bg-card p-1">
          {items.map((item) => {
            const at = picked.indexOf(item.id)
            const on = at >= 0
            const disabled = !on && full
            const cid = `${id}-${item.id}`
            return (
              <li key={item.id}>
                <label
                  htmlFor={cid}
                  className={cn("flex items-center gap-2.5 rounded-[5px] px-2 py-1.5 transition-colors", disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-white/[0.03]")}
                >
                  <Checkbox
                    id={cid}
                    checked={on}
                    disabled={disabled}
                    onCheckedChange={(checked) => onChange(checked ? [...picked, item.id] : picked.filter((v) => v !== item.id))}
                  />
                  <span className="relative size-8 shrink-0 overflow-hidden rounded-[4px] bg-surface">
                    {item.image ? <Image src={item.image} alt="" fill sizes="32px" unoptimized={item.image.startsWith("/api/")} className="object-cover" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{item.name}</span>
                    <span className="block truncate text-[11px] text-ink-3 tabular">{item.meta}</span>
                  </span>
                  {on ? (
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-purple text-[10px] text-ink tabular" aria-label={`Position ${at + 1}`}>
                      {at + 1}
                    </span>
                  ) : null}
                </label>
              </li>
            )
          })}
        </ul>
      )}
      {full ? <p className="text-xs text-ink-3">That&apos;s the most this section shows. Untick one to pick another.</p> : null}
    </div>
  )
}
