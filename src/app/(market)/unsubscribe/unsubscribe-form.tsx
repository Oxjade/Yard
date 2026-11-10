"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api/client"
import { errorMessage } from "@/lib/api/errors"

type Preview = { category: string; label: string }
type RequestState = { token: string; preview?: Preview; done?: boolean; error?: string }

export function UnsubscribeForm() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get("token")
  const [state, setState] = useState<RequestState | null>(null)
  const [retry, setRetry] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    void api<Preview>("/api/notifications/preferences/unsubscribe", { query: { token }, signal: controller.signal })
      .then((preview) => setState({ token, preview }))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setState({ token, error: errorMessage(cause, "This unsubscribe link couldn't be checked.") })
      })
    return () => controller.abort()
  }, [token, retry])

  async function confirm() {
    if (!token || submitting) return
    setSubmitting(true)
    try {
      const result = await api<{ label: string }>("/api/notifications/preferences/unsubscribe", { method: "POST", query: { token } })
      setState({ token, preview: { category: "", label: result.label }, done: true })
      router.replace("/unsubscribe", { scroll: false })
    } catch (cause) {
      setState({ token, error: errorMessage(cause, "You couldn't be unsubscribed just now. Try again.") })
    } finally {
      setSubmitting(false)
    }
  }

  if (state?.done) {
    return <p role="status" className="border-t border-line pt-4 text-sm leading-relaxed text-ink-2">You’re unsubscribed from {state.preview?.label}. You can close this page.</p>
  }
  if (!token) {
    return <p className="border-t border-line pt-4 text-sm leading-relaxed text-ink-2">This link is missing its token. Open the complete unsubscribe link from your email.</p>
  }

  const current = state?.token === token ? state : null
  if (!current) return <p role="status" className="border-t border-line pt-4 text-sm text-ink-2">Checking this link…</p>
  if (current.error) {
    return <div className="grid gap-3 border-t border-line pt-4"><p role="alert" className="text-sm text-danger">{current.error}</p><div><Button type="button" variant="secondary" onClick={() => setRetry((value) => value + 1)}>Try again</Button></div></div>
  }
  if (!current.preview) return null

  return <div className="grid gap-4 border-t border-line pt-4">
    <p className="text-sm leading-relaxed text-ink-2">This will unsubscribe this email address from {current.preview.label}.</p>
    <div><Button type="button" variant="secondary" loading={submitting} disabled={submitting} onClick={() => void confirm()}>Unsubscribe</Button></div>
  </div>
}