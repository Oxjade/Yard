/**
 * Square crop geometry for profile photos (Settings › Your details). Plain TypeScript with no DOM,
 * so it runs under `tsx --test`. The crop sheet shows the photo inside a square frame of `frame`
 * CSS pixels: at zoom 1 the photo just covers the frame (its short side fills it), and the person
 * drags it by `offset` (the photo's centre relative to the frame's centre, in frame pixels).
 */

export type Size = { width: number; height: number }
export type Offset = { x: number; y: number }

export const MIN_ZOOM = 1
export const MAX_ZOOM = 4
/** The longest side Yard uploads for a profile photo, and the shortest the server takes. */
export const PHOTO_OUTPUT_MAX = 1024
export const PHOTO_MIN_SIDE = 64
/** The same cap as other photo uploads (10 MB), checked on the original file before it is opened. */
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024

export const clampZoom = (z: number) => (Number.isFinite(z) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) : MIN_ZOOM)

/** Image pixels → frame pixels at this zoom. */
export function displayScale(img: Size, frame: number, zoom: number) {
  return (frame / Math.min(img.width, img.height)) * clampZoom(zoom)
}

/** Keeps the frame covered: the photo's edge never moves inside the frame. */
export function clampOffset(img: Size, frame: number, zoom: number, offset: Offset): Offset {
  const s = displayScale(img, frame, zoom)
  const maxX = Math.max(0, (img.width * s - frame) / 2)
  const maxY = Math.max(0, (img.height * s - frame) / 2)
  const c = (v: number, m: number) => (Number.isFinite(v) ? Math.min(m, Math.max(-m, v)) : 0) || 0
  return { x: c(offset.x, maxX), y: c(offset.y, maxY) }
}

/** The square of the original image the frame shows, in image pixels (for canvas drawImage). */
export function sourceSquare(img: Size, frame: number, zoom: number, offset: Offset) {
  const s = displayScale(img, frame, zoom)
  const o = clampOffset(img, frame, zoom, offset)
  const size = Math.min(frame / s, img.width, img.height)
  const cx = img.width / 2 - o.x / s
  const cy = img.height / 2 - o.y / s
  const sx = Math.min(img.width - size, Math.max(0, cx - size / 2))
  const sy = Math.min(img.height - size, Math.max(0, cy - size / 2))
  return { sx, sy, size }
}

/** The uploaded square's side: the cropped area, never scaled up, at most PHOTO_OUTPUT_MAX. */
export const outputSide = (sourceSize: number) => Math.max(1, Math.min(PHOTO_OUTPUT_MAX, Math.round(sourceSize)))

/**
 * Zooming keeps the point under the frame's centre where it is: the offset scales with the zoom
 * change, then is clamped for the new zoom.
 */
export function zoomTo(img: Size, frame: number, from: { zoom: number; offset: Offset }, nextZoom: number) {
  const zoom = clampZoom(nextZoom)
  const k = zoom / clampZoom(from.zoom)
  return { zoom, offset: clampOffset(img, frame, zoom, { x: from.offset.x * k, y: from.offset.y * k }) }
}

const HEIC = /\.(heic|heif)$/i

/** Whether a picked file can be offered to the cropper, before it is decoded. HEIC is tried (Safari opens it). */
export function photoFileProblem(file: { name?: string; type: string; size: number }): string | null {
  const heic = file.type === "image/heic" || file.type === "image/heif" || HEIC.test(file.name ?? "")
  if (!heic && !/^image\/(jpeg|png|webp)$/.test(file.type)) return "Use a JPEG, PNG or WebP photo."
  if (file.size > PHOTO_MAX_BYTES) return "Photos can be up to 10 MB."
  if (file.size === 0) return "This file is empty."
  return null
}

export const isHeic = (file: { name?: string; type: string }) => file.type === "image/heic" || file.type === "image/heif" || HEIC.test(file.name ?? "")
