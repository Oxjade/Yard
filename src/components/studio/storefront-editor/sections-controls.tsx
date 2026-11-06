"use client"

import { useState } from "react"
import Image from "next/image"
import { AnimatePresence, Reorder, motion, useDragControls } from "motion/react"
import { ArrowDownIcon as ArrowDown, ArrowUpIcon as ArrowUp, BookOpenIcon as BookOpen, CalendarDotsIcon as CalendarClock, DotsSixVerticalIcon as GripVertical, ImagesIcon as Images, SquaresFourIcon as LayoutGrid, LockIcon as Lock, BrowserIcon as PanelTop, ShoppingBagOpenIcon as ShoppingBag, StarIcon as Star, type Icon } from "@phosphor-icons/react"
import { storefrontSections, storefrontTemplates } from "@/components/storefront/theme"
import { Field, FieldMessage, control, inputClass } from "@/components/studio/catalog/fields"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import type { CurrencyCode } from "@/config/markets"
import type { Collection, Product, StorefrontSection, StorefrontSectionType } from "@/lib/data/types"
import { formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"
import { COLLECTIONS_MAX, FEATURED_MAX, HEADING_MAX, autoFeaturedCount, type EditorConfig, type FieldErrors } from "./model"
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
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

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
}: {
  config: EditorConfig
  products: Product[]
  collections: Collection[]
  /** The brand's currency: product prices are shown in it, as everywhere in Studio. */
  currency: CurrencyCode
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
            />
          ))}
        </Reorder.Group>
        <FieldMessage id="sf-sections" error={errors.sections} />
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
            <Button id={`sf-move-up-${section.id}`} type="button" variant="ghost" size="icon-xs" aria-label={`Move ${meta.label} up`} disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUp />
            </Button>
            <Button id={`sf-move-down-${section.id}`} type="button" variant="ghost" size="icon-xs" aria-label={`Move ${meta.label} down`} disabled={index === count - 1} onClick={() => onMove(1)}>
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
            <SectionSettings section={section} config={config} products={products} collections={collections} currency={currency} onPatch={onPatch} onEditCover={onEditCover} />
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
}: {
  section: StorefrontSection
  config: EditorConfig
  products: Product[]
  collections: Collection[]
  currency: CurrencyCode
  onPatch: (p: Partial<StorefrontSection>) => void
  onEditCover: () => void
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
    </>
  )
}

/** Choose which items a section features, in the order they're picked. */
function ItemPicker({
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
                    {item.image ? <Image src={item.image} alt="" fill sizes="32px" className="object-cover" /> : null}
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
