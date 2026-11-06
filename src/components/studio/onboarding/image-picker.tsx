"use client"

import { useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { imageFileError } from "./image-utils"

/* ---------- Image picking ---------- */

/** A hidden file input plus drag-and-drop on whatever it wraps. Reports a message on a bad file. */
export function ImagePicker({
  multiple,
  onFiles,
  onError,
  className,
  children,
  label,
  id,
  invalid,
  describedBy,
}: {
  multiple?: boolean
  onFiles: (files: File[]) => void
  onError: (message: string) => void
  className?: string
  children: React.ReactNode
  label: string
  id?: string
  invalid?: boolean
  describedBy?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  function take(list: FileList | null) {
    const files = Array.from(list ?? [])
    if (!files.length) return
    const bad = files.map(imageFileError).find(Boolean)
    if (bad) return onError(bad)
    onFiles(files)
  }

  return (
    <>
      <button
        type="button"
        id={id}
        aria-label={label}
        data-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          take(e.dataTransfer.files)
        }}
        className={cn(
          "relative outline-none transition-colors focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian",
          over && "border-violet bg-purple/10",
          invalid && "border-danger/70",
          className,
        )}
      >
        {children}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
        multiple={multiple}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          take(e.target.files)
          e.target.value = ""
        }}
      />
    </>
  )
}
