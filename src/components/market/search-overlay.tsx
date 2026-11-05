"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Search, X } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { categories, searchBrands, searchProducts } from "@/lib/data"
import { brandById } from "@/lib/data/brands"
import { create } from "zustand"
import { BrandMark } from "./brand-mark"
import { Price } from "./price"

export const useSearchOverlay = create<{ open: boolean; setOpen: (o: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }))

const suggestions = ["hoodie", "silver", "sneakers", "ceramics", "fragrance", "kente"]

export function SearchOverlay() {
  const router = useRouter()
  const open = useSearchOverlay((s) => s.open)
  const setOpen = useSearchOverlay((s) => s.setOpen)
  const [q, setQ] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen(!useSearchOverlay.getState().open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setOpen])

  const results = useMemo(() => {
    const term = q.trim()
    if (term.length < 2) return null
    return {
      products: searchProducts({ q: term }).slice(0, 6),
      brands: searchBrands({ q: term }).slice(0, 4),
      categories: categories.filter((c) => c.name.toLowerCase().includes(term.toLowerCase())).slice(0, 3),
    }
  }, [q])

  const close = () => setOpen(false)
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!q.trim()) return
    close()
    router.push(`/shop?q=${encodeURIComponent(q.trim())}`)
  }

  const empty = results && !results.products.length && !results.brands.length && !results.categories.length

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[8px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content
              asChild
              forceMount
              aria-describedby={undefined}
              onOpenAutoFocus={(e) => {
                e.preventDefault()
                inputRef.current?.focus()
              }}
            >
              <motion.div
                className="glass-strong glass-sheen fixed inset-x-2 top-2 z-50 mx-auto max-h-[calc(100dvh-1rem)] max-w-2xl overflow-hidden rounded-2xl outline-none sm:top-16"
                initial={{ opacity: 0, y: -12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              >
                <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
                <form onSubmit={submit} className="flex items-center gap-3 border-b border-white/8 px-4">
                  <Search className="size-5 shrink-0 text-ink-2" />
                  <input
                    ref={inputRef}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search brands, products and categories"
                    className="h-14 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-3"
                    aria-label="Search"
                  />
                  <DialogPrimitive.Close className="inline-flex size-8 items-center justify-center rounded-full text-ink-2 hover:bg-white/8 hover:text-ink" aria-label="Close search">
                    <X className="size-4" />
                  </DialogPrimitive.Close>
                </form>

                <div className="max-h-[70dvh] overflow-y-auto p-4">
                  {!results ? (
                    <div>
                      <p className="text-xs text-ink-3">Try</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {suggestions.map((s) => (
                          <button key={s} type="button" onClick={() => setQ(s)} className="h-8 rounded-full border border-white/10 px-3 text-sm text-ink-2 transition hover:border-violet hover:text-ink">
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : empty ? (
                    <p className="py-8 text-center text-sm text-ink-2">Nothing matches “{q}”. Try a brand name, a city or a material.</p>
                  ) : (
                    <div className="grid gap-5">
                      {results.brands.length ? (
                        <div>
                          <p className="mb-2 text-xs text-ink-3">Brands</p>
                          <ul className="grid gap-1">
                            {results.brands.map((b) => (
                              <li key={b.id}>
                                <Link href={`/brands/${b.handle}`} onClick={close} className="flex items-center gap-3 rounded-lg p-2 hover:bg-white/6">
                                  <BrandMark brand={b} size="sm" />
                                  <span className="text-sm text-ink">{b.name}</span>
                                  <span className="text-xs text-ink-2">{b.city}</span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {results.products.length ? (
                        <div>
                          <p className="mb-2 text-xs text-ink-3">Products</p>
                          <ul className="grid gap-1 sm:grid-cols-2">
                            {results.products.map((p) => (
                              <li key={p.id}>
                                <Link href={`/products/${p.slug}`} onClick={close} className="flex items-center gap-3 rounded-lg p-2 hover:bg-white/6">
                                  <span className="relative size-12 shrink-0 overflow-hidden rounded-md bg-surface">
                                    <Image src={p.images[0].src} alt="" fill sizes="48px" className="object-cover" />
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm text-ink">{p.name}</span>
                                    <span className="block truncate text-xs text-ink-2">{brandById.get(p.brandId)?.name}</span>
                                  </span>
                                  <Price amount={p.price} currency={p.currency} className="text-xs" />
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {results.categories.length ? (
                        <div>
                          <p className="mb-2 text-xs text-ink-3">Categories</p>
                          <div className="flex flex-wrap gap-2">
                            {results.categories.map((c) => (
                              <Link key={c.slug} href={`/categories/${c.slug}`} onClick={close} className="h-8 rounded-full border border-white/10 px-3 text-sm leading-8 text-ink-2 hover:text-ink">
                                {c.name}
                              </Link>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      <button type="submit" onClick={submit} className="h-10 rounded-md border border-white/10 text-sm text-ink-2 hover:bg-white/6 hover:text-ink">
                        See all results for “{q}”
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  )
}
