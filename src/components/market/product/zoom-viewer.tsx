"use client"

import { useCallback, useLayoutEffect, useRef, useState } from "react"
import Image from "next/image"
import { CaretLeftIcon as ChevronLeft, CaretRightIcon as ChevronRight, MinusIcon as Minus, PlusIcon as Plus, XIcon as X } from "@phosphor-icons/react"
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, type PanInfo } from "motion/react"
import { Dialog as DialogPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"
import type { ImageAsset } from "@/lib/data/types"

const ZOOM_STEP = 0.75
const ZOOM_TAP = 2.5
const ZOOM_MAX = 4
const spring = { type: "spring", stiffness: 380, damping: 40, mass: 0.8 } as const

/**
 * Full-screen zoom view. The image opens fitted to the screen at full resolution; a tap or
 * click zooms in on that point, dragging pans, and the buttons step the scale. At normal
 * scale a horizontal swipe moves between images.
 */
export function ZoomViewer({
  images,
  index,
  onIndexChange,
  open,
  onOpenChange,
  title,
}: {
  images: ImageAsset[]
  index: number
  onIndexChange: (i: number) => void
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-obsidian/95 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content asChild forceMount aria-describedby={undefined}>
              <motion.div
                className="fixed inset-0 z-50 flex flex-col outline-none"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                <ZoomStage images={images} index={index} onIndexChange={onIndexChange} title={title} />
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Root>
  )
}

function ZoomStage({ images, index, onIndexChange, title }: { images: ImageAsset[]; index: number; onIndexChange: (i: number) => void; title: string }) {
  const reduce = useReducedMotion()
  const stageRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [zoom, setZoom] = useState(1)
  const scale = useMotionValue(1)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const dragged = useRef(false)
  const image = images[index]
  const many = images.length > 1

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fitted size of the image inside the stage, keeping a small margin.
  const pad = box.w < 640 ? 12 : 40
  const ratio = image.width / image.height
  const availW = Math.max(0, box.w - pad * 2)
  const availH = Math.max(0, box.h - pad * 2)
  const fitW = Math.min(availW, availH * ratio)
  const fitH = fitW / ratio

  const limits = useCallback(
    (s: number) => ({ x: Math.max(0, (fitW * s - box.w) / 2), y: Math.max(0, (fitH * s - box.h) / 2) }),
    [fitW, fitH, box.w, box.h],
  )

  const zoomTo = useCallback(
    (next: number, focus?: { px: number; py: number }) => {
      const s = Math.min(ZOOM_MAX, Math.max(1, next))
      const current = scale.get()
      // Keep the focused point under the pointer: the image-space point (p - t) / s stays put.
      const fx = focus ? focus.px - (s * (focus.px - x.get())) / current : (x.get() * s) / current
      const fy = focus ? focus.py - (s * (focus.py - y.get())) / current : (y.get() * s) / current
      const l = limits(s)
      const tx = s === 1 ? 0 : Math.max(-l.x, Math.min(l.x, fx))
      const ty = s === 1 ? 0 : Math.max(-l.y, Math.min(l.y, fy))
      const t = reduce ? { duration: 0 } : spring
      animate(scale, s, t)
      animate(x, tx, t)
      animate(y, ty, t)
      setZoom(s)
    },
    [limits, reduce, scale, x, y],
  )

  // A new image always starts fitted.
  const select = (i: number) => {
    scale.set(1)
    x.set(0)
    y.set(0)
    setZoom(1)
    onIndexChange(i)
  }
  const go = (dir: 1 | -1) => select((index + dir + images.length) % images.length)

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight" && many && zoom === 1) go(1)
    else if (e.key === "ArrowLeft" && many && zoom === 1) go(-1)
    else if (e.key === "+" || e.key === "=") zoomTo(zoom + ZOOM_STEP)
    else if (e.key === "-") zoomTo(zoom - ZOOM_STEP)
  }

  function onClick(e: React.MouseEvent) {
    if (dragged.current) return
    const rect = stageRef.current!.getBoundingClientRect()
    const px = e.clientX - (rect.left + rect.width / 2)
    const py = e.clientY - (rect.top + rect.height / 2)
    if (zoom > 1) zoomTo(1)
    else zoomTo(ZOOM_TAP, { px, py })
  }

  function onDragEnd(_: unknown, info: PanInfo) {
    window.setTimeout(() => (dragged.current = false), 0)
    if (zoom === 1 && many) {
      if (info.offset.x < -60 || info.velocity.x < -500) go(1)
      else if (info.offset.x > 60 || info.velocity.x > 500) go(-1)
    }
  }

  const l = limits(zoom)

  return (
    <div className="flex h-full flex-col" onKeyDown={onKeyDown}>
      <header className="flex items-center justify-between gap-3 px-3 pt-3 sm:px-5 sm:pt-4">
        {/* Phones show only the counter so the toolbar never squeezes the name to a stub. */}
        <DialogPrimitive.Title className="flex min-w-0 items-baseline gap-3 text-sm text-ink-2">
          <span className="sr-only truncate text-ink sm:not-sr-only">
            {title}
            <span className="sr-only">, </span>
          </span>
          {many ? (
            <span className="shrink-0 tabular">
              Image {index + 1} of {images.length}
            </span>
          ) : null}
        </DialogPrimitive.Title>
        <div className="glass flex shrink-0 items-center gap-1 rounded-full p-1">
          <button type="button" onClick={() => zoomTo(zoom - ZOOM_STEP)} disabled={zoom <= 1} aria-label="Zoom out" className="inline-flex size-10 items-center justify-center rounded-full text-ink transition hover:bg-white/8 disabled:opacity-30">
            <Minus className="size-4" />
          </button>
          <span className="w-12 text-center text-xs text-ink-2 tabular" aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => zoomTo(zoom + ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in" className="inline-flex size-10 items-center justify-center rounded-full text-ink transition hover:bg-white/8 disabled:opacity-30">
            <Plus className="size-4" />
          </button>
          <span className="mx-1 h-5 w-px bg-white/10" aria-hidden />
          <DialogPrimitive.Close className="inline-flex size-10 items-center justify-center rounded-full text-ink transition hover:bg-white/8" aria-label="Close zoom view">
            <X className="size-5" />
          </DialogPrimitive.Close>
        </div>
      </header>

      <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden">
        {fitW > 0 ? (
          <motion.div
            key={image.src}
            className={cn("absolute top-1/2 left-1/2 touch-none select-none", zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in")}
            style={{ width: fitW, height: fitH, marginLeft: -fitW / 2, marginTop: -fitH / 2, x, y, scale }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            drag={zoom > 1 ? true : many ? "x" : false}
            dragConstraints={zoom > 1 ? { left: -l.x, right: l.x, top: -l.y, bottom: l.y } : { left: 0, right: 0, top: 0, bottom: 0 }}
            dragElastic={zoom > 1 ? 0.08 : 0.25}
            dragMomentum={zoom > 1}
            onDragStart={() => (dragged.current = true)}
            onDragEnd={onDragEnd}
            onClick={onClick}
          >
            <Image src={image.src} alt={image.alt} fill unoptimized draggable={false} className="pointer-events-none rounded-sm object-contain" />
          </motion.div>
        ) : null}

        {many ? (
          <>
            <button type="button" onClick={() => go(-1)} aria-label="Previous image" className="glass absolute top-1/2 left-3 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full text-ink transition hover:bg-[var(--glass-bg-strong)] sm:inline-flex">
              <ChevronLeft className="size-5" />
            </button>
            <button type="button" onClick={() => go(1)} aria-label="Next image" className="glass absolute top-1/2 right-3 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full text-ink transition hover:bg-[var(--glass-bg-strong)] sm:inline-flex">
              <ChevronRight className="size-5" />
            </button>
          </>
        ) : null}
      </div>

      <footer className="flex flex-col items-center gap-3 px-3 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {many ? (
          <div className="flex gap-2" role="group" aria-label="Images">
            {images.map((img, i) => (
              <button
                key={img.src}
                type="button"
                onClick={() => select(i)}
                aria-label={`Show image ${i + 1} of ${images.length}`}
                aria-current={i === index}
                className={cn("relative h-14 w-11 overflow-hidden rounded-md border transition", i === index ? "border-violet" : "border-white/10 opacity-60 hover:opacity-100")}
              >
                <Image src={img.src} alt="" fill sizes="44px" className="object-cover" />
              </button>
            ))}
          </div>
        ) : null}
        <p className="text-xs text-ink-3">{zoom > 1 ? "Drag to look around. Tap again to fit the screen." : "Tap or click the image to zoom in."}</p>
      </footer>
    </div>
  )
}
