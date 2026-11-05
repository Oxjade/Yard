"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

/** A horizontal scroller with snap points and desktop arrow buttons. */
export function Rail({ children, className, itemClassName, label }: { children: React.ReactNode[]; className?: string; itemClassName?: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: true, end: false })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 })
    update()
    el.addEventListener("scroll", update, { passive: true })
    window.addEventListener("resize", update)
    return () => {
      el.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
    }
  }, [])

  const scroll = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: "smooth" })

  return (
    <div className={cn("group/rail relative", className)} role="region" aria-label={label}>
      <div ref={ref} className="rail -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:gap-4 md:-mx-8 md:scroll-px-8 md:px-8">
        {children.map((child, i) => (
          <div key={i} className={cn("w-[72vw] shrink-0 snap-start sm:w-[42vw] md:w-[30vw] lg:w-[23%]", itemClassName)}>
            {child}
          </div>
        ))}
      </div>
      <div className="mt-4 hidden justify-end gap-2 md:flex">
        <button type="button" onClick={() => scroll(-1)} disabled={edges.start} aria-label="Scroll back" className="inline-flex size-9 items-center justify-center rounded-full border border-line text-ink transition hover:bg-elevated disabled:opacity-30">
          <ChevronLeft className="size-4" />
        </button>
        <button type="button" onClick={() => scroll(1)} disabled={edges.end} aria-label="Scroll forward" className="inline-flex size-9 items-center justify-center rounded-full border border-line text-ink transition hover:bg-elevated disabled:opacity-30">
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  )
}
