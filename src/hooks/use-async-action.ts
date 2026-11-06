"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { toast } from "sonner"

type Options<R> = {
  /** Toast on success. Omit for inline feedback only (preferred for small actions). */
  success?: string | ((result: R) => string)
  successDescription?: string | ((result: R) => string | undefined)
  /** Message shown when the operation throws. Never shows raw error text. */
  error?: string
  /**
   * Toast the failure (the default). Pass false when the control shows `error` inline next to
   * itself (a dialog's own message), so the failure isn't announced twice.
   */
  errorToast?: boolean
  /** How long the button's success check stays visible. */
  successFlashMs?: number
  onSuccess?: (result: R) => void
  onError?: (error: unknown) => void
}

/**
 * The one pattern for every important action (add to bag, publish, save, approve…):
 * acknowledge immediately, block duplicate submissions, show `pending` only while the
 * operation is actually running (no artificial delays), then report success or failure
 * and restore the control. Works for sync operations today and server actions later.
 */
export function useAsyncAction<A extends unknown[], R>(fn: (...args: A) => R | Promise<R>, opts: Options<R> = {}) {
  const [pending, setPending] = useState(false)
  const [succeeded, setSucceeded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  // The latest options, read when an action settles (it may outlive the render that started it).
  const optsRef = useRef(opts)
  useLayoutEffect(() => {
    optsRef.current = opts
  })

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      if (inFlight.current) return undefined
      inFlight.current = true
      setPending(true)
      setError(null)
      try {
        const result = await fn(...args)
        const o = optsRef.current
        if (o.success) {
          const title = typeof o.success === "function" ? o.success(result) : o.success
          const description = typeof o.successDescription === "function" ? o.successDescription(result) : o.successDescription
          toast.success(title, description ? { description } : undefined)
        }
        setSucceeded(true)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setSucceeded(false), o.successFlashMs ?? 1400)
        o.onSuccess?.(result)
        return result
      } catch (e) {
        const message = optsRef.current.error ?? "That didn't go through. Check your connection and try again."
        setError(message)
        if (optsRef.current.errorToast !== false) toast.error(message)
        optsRef.current.onError?.(e)
        return undefined
      } finally {
        inFlight.current = false
        setPending(false)
      }
    },
    [fn],
  )

  return { run, pending, succeeded, error, reset: () => setError(null) }
}
