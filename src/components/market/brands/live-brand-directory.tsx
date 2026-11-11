"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { MagnifyingGlassIcon as Search, MagnifyingGlassMinusIcon as SearchX } from "@phosphor-icons/react"
import { Chip, ChipRadioGroup } from "@/components/market/catalog/chip"
import { EmptyCard } from "@/components/market/editorial/empty-card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { fetchPublicBrands, type PublicBrandCard, type PublicBrandsPage } from "@/lib/api/public-brands"
import { categories } from "@/lib/data/catalog"
import { BrandsJoining } from "./brands-joining"
import { LiveBrandCard } from "./live-brand-card"

type Sort = "name" | "new"
const PAGE = 24

/**
 * The production /brands directory: listed brands from the server (GET /api/catalog/brands), never
 * the bundled sample brands. Search and a category row narrow it, "Load more" pages on (rule 7).
 * The filters appear only once there is something to narrow; with no brands at all the page shows
 * the deliberate "Brands are joining Yard" state instead of an empty shell.
 */
export function LiveBrandDirectory({ initial }: { initial: PublicBrandsPage }) {
  const [q, setQ] = useState("")
  const [category, setCategory] = useState<string | undefined>()
  const [sort, setSort] = useState<Sort>("name")
  const [page, setPage] = useState<PublicBrandsPage>(initial)
  const [status, setStatus] = useState<"idle" | "loading" | "more" | "error">("idle")
  const first = useRef(true)
  const ticket = useRef(0)

  // Category chips only for categories the listed brands actually sell in (from the first page).
  const options = useMemo(() => {
    const present = new Set(initial.brands.flatMap((b) => b.categories))
    return categories.filter((c) => present.has(c.slug)).map((c) => ({ value: c.slug, label: c.name }))
  }, [initial.brands])

  const load = async (offset: number, append: boolean) => {
    const mine = ++ticket.current
    setStatus(append ? "more" : "loading")
    try {
      const next = await fetchPublicBrands({ q: q.trim() || undefined, category, sort, limit: PAGE, offset })
      if (mine !== ticket.current) return
      setPage((cur) => (append ? { ...next, brands: [...cur.brands, ...next.brands.filter((b) => !cur.brands.some((c) => c.id === b.id))] } : next))
      setStatus("idle")
    } catch {
      if (mine === ticket.current) setStatus("error")
    }
  }

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const t = setTimeout(() => void load(0, false), q ? 250 : 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the query, category or sort changes
  }, [q, category, sort])

  if (initial.total === 0) return <BrandsJoining className="mt-10 md:mt-14" />

  const narrowing = !!(q.trim() || category)
  const showFilters = initial.total > 1

  return (
    <section aria-labelledby="brand-list-title" className="mt-10 min-w-0 md:mt-14">
      {showFilters ? (
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <label className="relative block min-w-0">
            <span className="sr-only">Search brands</span>
            <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search brands or cities" className="h-11 pl-9" maxLength={60} />
          </label>
          <ChipRadioGroup label="Sort brands" className="flex flex-wrap gap-2">
            <Chip radio selected={sort === "name"} onClick={() => setSort("name")} layoutId="live-brand-sort">
              A–Z
            </Chip>
            <Chip radio selected={sort === "new"} onClick={() => setSort("new")} layoutId="live-brand-sort">
              New on Yard
            </Chip>
          </ChipRadioGroup>
          {options.length > 1 ? (
            <ChipRadioGroup label="Category" className="rail -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:col-span-2 lg:mx-0 lg:flex-wrap lg:px-0">
              <Chip radio selected={!category} onClick={() => setCategory(undefined)} layoutId="live-brand-cat">
                All
              </Chip>
              {options.map((o) => (
                <Chip key={o.value} radio selected={category === o.value} onClick={() => setCategory(o.value)} layoutId="live-brand-cat">
                  {o.label}
                </Chip>
              ))}
            </ChipRadioGroup>
          ) : null}
        </div>
      ) : null}

      <h2 id="brand-list-title" className="mt-8 text-sm text-ink-2" aria-live="polite">
        {status === "loading" ? "Loading brands…" : `${page.total} ${page.total === 1 ? "brand" : "brands"}${sort === "new" ? ", newest first" : ""}`}
      </h2>

      {status === "error" ? (
        <EmptyCard
          className="mt-4"
          icon={<SearchX />}
          title="Brands couldn't be loaded"
          reason="Check your connection and try again."
          action={
            <Button variant="secondary" onClick={() => void load(0, false)}>
              Retry
            </Button>
          }
        />
      ) : page.brands.length === 0 && narrowing ? (
        <EmptyCard
          className="mt-4"
          icon={<SearchX />}
          title="No brands match"
          reason="Try another word or category."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setQ("")
                setCategory(undefined)
              }}
            >
              Clear search
            </Button>
          }
        />
      ) : (
        <ul className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy={status === "loading"}>
          {page.brands.map((b: PublicBrandCard) => (
            <li key={b.id} className="min-w-0">
              <LiveBrandCard brand={b} />
            </li>
          ))}
        </ul>
      )}

      {page.nextOffset !== null && status !== "error" ? (
        <div className="mt-8 flex justify-center">
          <Button variant="secondary" disabled={status === "more"} onClick={() => void load(page.nextOffset ?? page.brands.length, true)}>
            {status === "more" ? "Loading…" : "Load more brands"}
          </Button>
        </div>
      ) : null}
    </section>
  )
}
