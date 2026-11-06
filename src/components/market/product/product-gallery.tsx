"use client"

import { useRef, useState } from "react"
import Image from "next/image"
import { CaretLeftIcon as ChevronLeft, CaretRightIcon as ChevronRight, ArrowsOutIcon as Expand } from "@phosphor-icons/react"
import { AnimatePresence, motion, type PanInfo } from "motion/react"
import { cn } from "@/lib/utils"
import type { ImageAsset } from "@/lib/data/types"
import { ZoomViewer } from "./zoom-viewer"

const slide = {
  enter: (dir: number) => ({ x: dir === 0 ? 0 : dir > 0 ? "6%" : "-6%", opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? "-6%" : dir < 0 ? "6%" : 0, opacity: 0 }),
}

/**
 * Product photography. Desktop: a vertical thumbnail strip beside one large image.
 * Phone: the image runs edge to edge, swipes sideways and shows dots. Images crossfade
 * with a short slide; tapping opens the zoom view.
 */
export function ProductGallery({ images, name, overlay }: { images: ImageAsset[]; name: string; overlay?: React.ReactNode }) {
  const [[index, dir], setState] = useState<[number, number]>([0, 0])
  const [zoomOpen, setZoomOpen] = useState(false)
  const dragged = useRef(false)
  const many = images.length > 1
  const image = images[index]

  const show = (next: number, direction?: number) => {
    const i = (next + images.length) % images.length
    if (i === index) return
    setState([i, direction ?? (i > index ? 1 : -1)])
  }

  function onDragEnd(_: unknown, info: PanInfo) {
    window.setTimeout(() => (dragged.current = false), 0)
    if (info.offset.x < -50 || info.velocity.x < -450) show(index + 1, 1)
    else if (info.offset.x > 50 || info.velocity.x > 450) show(index - 1, -1)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!many) return
    if (e.key === "ArrowRight") show(index + 1, 1)
    if (e.key === "ArrowLeft") show(index - 1, -1)
  }

  return (
    <div
      role="region"
      aria-roledescription="gallery"
      aria-label={`${name} images`}
      onKeyDown={onKeyDown}
      className={cn("md:grid md:gap-3", many ? "md:grid-cols-[56px_minmax(0,1fr)] lg:grid-cols-[72px_minmax(0,1fr)]" : "md:grid-cols-1")}
    >
      {many ? (
        <div className="hidden md:flex md:flex-col md:gap-2" role="group" aria-label="Choose an image">
          {images.map((img, i) => (
            <button
              key={img.src}
              type="button"
              onClick={() => show(i)}
              aria-label={`Show image ${i + 1} of ${images.length}`}
              aria-current={i === index}
              className="group/thumb relative aspect-[4/5] w-full overflow-hidden rounded-md bg-card"
            >
              <Image src={img.src} alt="" fill sizes="72px" loading="eager" className={cn("object-cover transition-opacity duration-300", i === index ? "opacity-100" : "opacity-55 group-hover/thumb:opacity-90")} />
              {i === index ? <motion.span layoutId="pdp-thumb-ring" className="absolute inset-0 rounded-md border-2 border-violet" /> : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className="relative -mx-4 aspect-[4/5] overflow-hidden bg-card md:mx-0 md:rounded-lg lg:max-h-[calc(100dvh-8rem)] lg:w-full">
        <AnimatePresence initial={false} custom={dir}>
          <motion.div
            key={image.src}
            custom={dir}
            variants={slide}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ x: { type: "spring", stiffness: 340, damping: 36 }, opacity: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } }}
            className={cn("absolute inset-0 cursor-zoom-in", many && "touch-pan-y")}
            drag={many ? "x" : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.18}
            onDragStart={() => (dragged.current = true)}
            onDragEnd={onDragEnd}
            onClick={() => {
              if (!dragged.current) setZoomOpen(true)
            }}
          >
            <Image
              src={image.src}
              alt={image.alt}
              fill
              loading={index === 0 ? "eager" : "lazy"}
              fetchPriority={index === 0 ? "high" : undefined}
              draggable={false}
              sizes="(min-width: 1024px) 50vw, (min-width: 768px) 48vw, 100vw"
              className="pointer-events-none object-cover select-none"
            />
          </motion.div>
        </AnimatePresence>

        {overlay ? <div className="pointer-events-none absolute top-3 left-3 z-10 flex flex-wrap gap-1.5 md:top-4 md:left-4">{overlay}</div> : null}

        <button
          type="button"
          onClick={() => setZoomOpen(true)}
          aria-label={`Open zoom view, image ${index + 1} of ${images.length}`}
          className="glass absolute top-3 right-3 z-10 inline-flex size-10 items-center justify-center rounded-full text-ink transition hover:bg-[var(--glass-bg-strong)] md:top-4 md:right-4"
        >
          <Expand className="size-4" />
        </button>

        {many ? (
          <>
            <button type="button" onClick={() => show(index - 1, -1)} aria-label="Previous image" className="glass absolute top-1/2 left-4 z-10 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full text-ink transition hover:bg-[var(--glass-bg-strong)] md:inline-flex">
              <ChevronLeft className="size-5" />
            </button>
            <button type="button" onClick={() => show(index + 1, 1)} aria-label="Next image" className="glass absolute top-1/2 right-4 z-10 hidden size-10 -translate-y-1/2 items-center justify-center rounded-full text-ink transition hover:bg-[var(--glass-bg-strong)] md:inline-flex">
              <ChevronRight className="size-5" />
            </button>
            <div className="glass absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center rounded-full px-1.5 md:hidden" role="group" aria-label="Choose an image">
              {images.map((img, i) => (
                <button key={img.src} type="button" onClick={() => show(i)} aria-label={`Show image ${i + 1} of ${images.length}`} aria-current={i === index} className="relative inline-flex h-7 w-6 items-center justify-center">
                  <span className="size-1.5 rounded-full bg-ink/35" />
                  {i === index ? <motion.span layoutId="pdp-dot" className="absolute h-1.5 w-4 rounded-full bg-ink" /> : null}
                </button>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <ZoomViewer images={images} index={index} onIndexChange={(i) => show(i)} open={zoomOpen} onOpenChange={setZoomOpen} title={name} />
    </div>
  )
}
