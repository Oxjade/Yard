import { ApiError } from "./client"
import type { MediaDto, UploadPurpose } from "./contracts/uploads"

/**
 * Uploads one file to POST /api/uploads (F2, §5.4) with XMLHttpRequest, so progress is real
 * upload progress and never a timer. Purpose and target travel in the query string, so the server
 * authorises before reading the body. Abort with the returned handle's `abort()`.
 */
export type UploadTarget = { purpose: UploadPurpose; as: "shopper" | "brand"; conversationId?: string; brandId?: string }

export function apiUpload(file: Blob & { name?: string }, target: UploadTarget, onProgress?: (fraction: number) => void) {
  const xhr = new XMLHttpRequest()
  const q = new URLSearchParams({ purpose: target.purpose, as: target.as })
  if (target.conversationId) q.set("conversationId", target.conversationId)
  if (target.brandId) q.set("brandId", target.brandId)
  const promise = new Promise<MediaDto>((resolve, reject) => {
    xhr.open("POST", `/api/uploads?${q.toString()}`)
    xhr.withCredentials = true
    xhr.setRequestHeader("X-Yard-Client", "1")
    xhr.responseType = "text"
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) onProgress(Math.min(1, ev.loaded / ev.total))
    }
    xhr.onload = () => {
      let data: unknown
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : undefined
      } catch {
        data = undefined
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1)
        resolve(((data as { media?: MediaDto })?.media ?? data) as MediaDto)
        return
      }
      const err = (data as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | undefined)?.error
      const retry = Number(xhr.getResponseHeader("Retry-After"))
      reject(new ApiError(xhr.status, err?.code ?? (xhr.status === 404 ? "not_found" : "internal"), err?.message ?? "The upload didn't go through. Try again.", err?.fields, Number.isFinite(retry) && retry > 0 ? retry : undefined))
    }
    xhr.onerror = () => reject(new ApiError(0, "network", "The upload stopped. Check your connection and try again."))
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"))
    const form = new FormData()
    form.append("file", file, file.name ?? "upload")
    xhr.send(form)
  })
  return { promise, abort: () => xhr.abort() }
}
