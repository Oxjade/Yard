/**
 * Client-side image preparation before upload (§5.4 step 5, §6.1 Upload sheet): decode, scale to
 * at most 2048 px on the long side and re-encode as JPEG (quality 0.86) through a canvas, which
 * drops EXIF and GPS data. The server strips metadata again. Videos are never touched here.
 */
export type PrepareOptions = { max?: number; type?: "image/jpeg" | "image/webp"; quality?: number; background?: string }

export class ImagePrepareError extends Error {
  constructor(
    public reason: "heic" | "unsupported" | "decode",
    message: string,
  ) {
    super(message)
    this.name = "ImagePrepareError"
  }
}

const HEIC = /\.(heic|heif)$/i

/** The reason an image can't be prepared, before decoding (HEIC and non-images). */
export function imageTypeProblem(file: { name?: string; type: string }): ImagePrepareError | null {
  if (file.type === "image/heic" || file.type === "image/heif" || HEIC.test(file.name ?? "")) return new ImagePrepareError("heic", "This is a HEIC photo. Export it as JPEG and try again.")
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return new ImagePrepareError("unsupported", "Use a JPEG, PNG or WebP photo.")
  return null
}

function decode(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new ImagePrepareError("decode", "This photo couldn't be read. Try exporting it again as JPEG."))
    }
    image.src = url
  })
}

/** Re-encodes an image to a Blob; the caller keeps the original name with the new extension. */
export async function reencodeImage(file: Blob, { max = 2048, type = "image/jpeg", quality = 0.86, background }: PrepareOptions = {}): Promise<Blob> {
  const image = await decode(file)
  const w = image.naturalWidth || max
  const h = image.naturalHeight || max
  const scale = Math.min(1, max / Math.max(w, h))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new ImagePrepareError("decode", "This browser can't prepare photos for upload.")
  if (type === "image/jpeg") {
    // JPEG has no transparency: flatten onto the page background.
    ctx.fillStyle = background ?? (getComputedStyle(document.documentElement).getPropertyValue("--color-obsidian").trim() || "#080808")
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new ImagePrepareError("decode", "This photo couldn't be prepared."))), type, quality))
}

/** prepareImage(file): the upload-ready File (JPEG, ≤ 2048 px, no metadata). */
export async function prepareImage(file: File, opts: PrepareOptions = {}): Promise<File> {
  const problem = imageTypeProblem(file)
  if (problem) throw problem
  const type = opts.type ?? "image/jpeg"
  const blob = await reencodeImage(file, { ...opts, type })
  const base = (file.name || "photo").replace(/\.[^.]+$/, "")
  return new File([blob], `${base}.${type === "image/webp" ? "webp" : "jpg"}`, { type, lastModified: Date.now() })
}
