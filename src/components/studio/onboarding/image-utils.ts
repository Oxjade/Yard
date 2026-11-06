"use client"

import { prepareImage } from "@/lib/media/prepare-image"

const MAX_BYTES = 15 * 1024 * 1024

/** A reason the file can't be used, or null. */
export function imageFileError(file: File) {
  if (!file.type.startsWith("image/")) return "That file isn't an image. Use a JPG, PNG or WebP."
  if (file.size > MAX_BYTES) return "That image is over 15 MB. Use a smaller one."
  return null
}

/**
 * Reads an image and scales it down in the browser, so previews are instant and saved
 * progress stays small. The backend phase uploads the original to storage instead.
 */
export function readImage(file: File, { max = 1400, type = "image/jpeg", quality = 0.82 }: { max?: number; type?: string; quality?: number } = {}) {
  return new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      try {
        const w = image.naturalWidth || max
        const h = image.naturalHeight || max
        const scale = Math.min(1, max / Math.max(w, h))
        const canvas = document.createElement("canvas")
        canvas.width = Math.max(1, Math.round(w * scale))
        canvas.height = Math.max(1, Math.round(h * scale))
        const ctx = canvas.getContext("2d")
        if (!ctx) throw new Error("canvas")
        if (type === "image/jpeg") {
          // JPEG has no transparency: flatten onto the page background, read from the theme.
          ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--color-obsidian").trim() || "#080808"
          ctx.fillRect(0, 0, canvas.width, canvas.height)
        }
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL(type, quality))
      } catch (e) {
        reject(e)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("decode"))
    }
    image.src = url
  })
}

/**
 * The toBlob variant of readImage (v2 uploads, §6.1): the same scale-and-flatten pipeline, as an
 * upload-ready File (max 2048 px, JPEG quality 0.86, metadata dropped by the canvas).
 */
export function readImageBlob(file: File, opts: { max?: number; type?: "image/jpeg" | "image/webp"; quality?: number } = {}) {
  return prepareImage(file, { max: opts.max ?? 2048, type: opts.type ?? "image/jpeg", quality: opts.quality ?? 0.86 })
}
