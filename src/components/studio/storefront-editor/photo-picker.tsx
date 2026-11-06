"use client"

import { useId, useRef, useState } from "react"
import Image from "next/image"
import { ImageSquareIcon as ImagePlus, CircleNotchIcon as Loader2 } from "@phosphor-icons/react"
import { motion } from "motion/react"
import { RadioGroup as RadioGroupPrimitive } from "radix-ui"
import type { ImageAsset } from "@/lib/data/types"
import { cn } from "@/lib/utils"
import { ACCEPTED_TYPES } from "./image-tools"

const tileClass =
  "group/tile relative aspect-square rounded-md border outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-2 focus-visible:ring-offset-card"

/** Tiles sit four to a row: about 80px in the side panel, a quarter of the screen below lg. */
const TILE_SIZES = "(min-width: 1024px) 80px, 25vw"

/**
 * A photo tile in the radio group, selected the way ChoiceCard is: a purple ring that slides
 * from tile to tile. The photo clips inside its own layer so the ring is never cut off.
 */
function Tile({ value, on, ring, label, className, children }: { value: string; on: boolean; ring: string; label: string; className?: string; children: React.ReactNode }) {
  return (
    <RadioGroupPrimitive.Item value={value} aria-label={label} className={cn(tileClass, on ? "border-transparent bg-purple/10" : "border-line-soft bg-surface hover:border-ink-2/40", className)}>
      <span className="absolute inset-0 overflow-hidden rounded-[5px]">{children}</span>
      {on ? <motion.span layoutId={ring} aria-hidden className="pointer-events-none absolute -inset-px rounded-[inherit] border-2 border-purple" transition={{ type: "spring", stiffness: 500, damping: 40 }} /> : null}
    </RadioGroupPrimitive.Item>
  )
}

/**
 * Pick one of the brand's photographs, or upload one from this computer. A radio group,
 * so arrow keys move between photos; the upload tile is a separate button.
 */
export function PhotoPicker({
  id,
  labelledBy,
  photos,
  value,
  onPick,
  onUpload,
  uploading,
  upload,
  leading,
  invalid,
  initialCount = 7,
}: {
  id: string
  /** The id of the visible text that names the group. */
  labelledBy: string
  photos: ImageAsset[]
  /** src of the chosen photo, or a special value matched by `leading`. */
  value: string
  onPick: (src: string) => void
  onUpload: (file: File) => void
  uploading?: boolean
  /** The current upload, shown as the first photo while it's in use. */
  upload?: ImageAsset
  /** An extra option before the photos (the text mark, for logos). */
  leading?: { value: string; label: string; node: React.ReactNode }
  invalid?: boolean
  initialCount?: number
}) {
  const input = useRef<HTMLInputElement>(null)
  const [all, setAll] = useState(false)
  const hintId = useId()
  // Keep the chosen photo visible even when it sits past the first row or two.
  const chosenAt = photos.findIndex((p) => p.src === value)
  const count = all ? photos.length : Math.max(initialCount, chosenAt + 1)
  const shown = photos.slice(0, count)
  const hidden = photos.length - shown.length

  return (
    <div className="grid gap-2">
      <RadioGroupPrimitive.Root
        id={id}
        aria-labelledby={labelledBy}
        aria-invalid={invalid || undefined}
        value={value}
        onValueChange={onPick}
        className="grid grid-cols-4 gap-2"
      >
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={uploading}
          aria-describedby={hintId}
          className={cn(tileClass, "flex flex-col items-center justify-center gap-1 border-dashed border-line bg-surface text-ink-2 hover:border-ink-2/50 hover:text-ink disabled:opacity-60")}
        >
          {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
          <span className="text-[11px]">{uploading ? "Adding" : "Upload"}</span>
        </button>

        {leading ? (
          <Tile value={leading.value} on={value === leading.value} ring={`${id}-ring`} label={leading.label}>
            {leading.node}
          </Tile>
        ) : null}

        {upload ? (
          <Tile value={upload.src} on={value === upload.src} ring={`${id}-ring`} label={`Your upload${upload.alt ? `: ${upload.alt}` : ""}`}>
            <Image src={upload.src} alt="" fill sizes={TILE_SIZES} className="object-cover" unoptimized />
          </Tile>
        ) : null}

        {shown.map((p) => (
          <Tile key={p.src} value={p.src} on={value === p.src} ring={`${id}-ring`} label={p.alt || "Brand photo"}>
            <Image src={p.src} alt="" fill sizes={TILE_SIZES} className="object-cover transition-transform duration-500 ease-out-quint group-hover/tile:scale-[1.04]" />
          </Tile>
        ))}
      </RadioGroupPrimitive.Root>

      <div className="flex items-center justify-between gap-3">
        <p id={hintId} className="text-xs text-ink-3">JPG, PNG or WebP, up to 15 MB.</p>
        {hidden > 0 || all ? (
          <button type="button" onClick={() => setAll((v) => !v)} className="shrink-0 rounded-sm text-xs text-violet hover:underline">
            {all ? "Show fewer" : `Show ${hidden} more`}
          </button>
        ) : null}
      </div>

      <input
        ref={input}
        type="file"
        accept={ACCEPTED_TYPES}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          if (file) onUpload(file)
        }}
      />
    </div>
  )
}
