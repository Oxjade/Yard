"use client"

/**
 * Local uploads for the frontend phase. A chosen file previews at once from an object URL;
 * a scaled copy is then encoded as a data URL so the draft still shows it after a reload.
 * The backend phase uploads the original to storage and keeps an asset id instead.
 */

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
export const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp,image/avif"

export function uploadError(file: File) {
  if (!file.type.startsWith("image/")) return `${file.name} isn't an image. Use a JPG, PNG or WebP file.`
  if (file.size > MAX_UPLOAD_BYTES) return `${file.name} is over 15 MB. Use a smaller file.`
  return null
}

/** Reads an image file, scales it to fit `max` pixels and returns it as a data URL. */
export function encodeImage(file: File, { max, type, quality }: { max: number; type: "image/jpeg" | "image/webp"; quality: number }) {
  return new Promise<{ src: string; width: number; height: number }>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new window.Image()
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
          // JPEG has no transparency: fill with the page base (the obsidian token) first.
          ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--color-obsidian").trim() || "#080808"
          ctx.fillRect(0, 0, canvas.width, canvas.height)
        }
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve({ src: canvas.toDataURL(type, quality), width: canvas.width, height: canvas.height })
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
