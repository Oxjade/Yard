"use client"

import { useState } from "react"
import { ArrowCounterClockwiseIcon, CheckIcon } from "@phosphor-icons/react"
import { Bone } from "@/components/feedback/skeletons"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { errorMessage } from "@/lib/api/errors"
import { getInboxSettings, setInboxSettings } from "@/lib/api/inbox"
import { useApi } from "@/lib/api/use-api"
import { useServerSession } from "@/lib/session/use-server-session"

/**
 * "Send read receipts" (§4.4), saved on Yard's server (users.read_receipts). Off is reciprocal:
 * brands don't see when you've read their replies, and you don't see when they've read yours.
 */
export function ReadReceiptsSetting() {
  const signedIn = useServerSession((s) => (s.status === "ready" ? !!s.shopper : null))
  const { data, error, isLoading, mutate, revalidate } = useApi(signedIn ? "inbox:settings" : null, () => getInboxSettings())
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  async function change(v: boolean) {
    const before = data?.readReceipts
    mutate({ readReceipts: v })
    setSaving(true)
    setNote(null)
    try {
      const r = await setInboxSettings(v)
      mutate(r)
      setNote({ ok: true, text: `Read receipts ${v ? "on" : "off"}. Saved.` })
    } catch (e) {
      if (before !== undefined) mutate({ readReceipts: before })
      setNote({ ok: false, text: errorMessage(e, "Couldn't save. Check your connection and try again.") })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <Label htmlFor="inbox-read-receipts" className="text-sm text-ink">
            Send read receipts
          </Label>
          <p id="inbox-read-receipts-desc" className="mt-1 text-sm text-ink-2">
            Brands see &ldquo;Seen&rdquo; when you&apos;ve read their reply. Turn it off and you won&apos;t see when they&apos;ve read yours either.
          </p>
        </div>
        {signedIn === null || isLoading ? (
          <Bone className="mt-0.5 h-6 w-11 rounded-full" />
        ) : (
          <Switch id="inbox-read-receipts" checked={data?.readReceipts ?? true} disabled={!signedIn || !!error || saving} onCheckedChange={(v) => void change(v)} aria-describedby="inbox-read-receipts-desc" className="mt-0.5" />
        )}
      </div>
      <div className="mt-4 border-t border-line-soft pt-3" aria-live="polite">
        {signedIn === false ? (
          <p className="text-xs text-ink-3">Your demo session is reconnecting. This setting saves once it&apos;s back.</p>
        ) : error ? (
          <p className="flex items-center gap-2 text-xs text-ink-2" role="alert">
            Couldn&apos;t load your message settings.
            <Button size="sm" variant="ghost" onClick={() => void revalidate()}>
              <ArrowCounterClockwiseIcon /> Retry
            </Button>
          </p>
        ) : note ? (
          <p className={note.ok ? "flex items-center gap-1.5 text-xs text-ink-2" : "text-xs text-danger"} role={note.ok ? undefined : "alert"}>
            {note.ok ? <CheckIcon className="size-3.5 text-violet" aria-hidden /> : null}
            {note.text}
          </p>
        ) : (
          <p className="text-xs text-ink-3">Saved to your account on Yard as you switch.</p>
        )}
      </div>
    </div>
  )
}
