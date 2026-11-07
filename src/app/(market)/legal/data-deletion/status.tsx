"use client"

import { useSearchParams } from "next/navigation"
import { CheckCircleIcon, ClockIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { Bone } from "@/components/feedback/skeletons"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api/client"
import { dataDeletionStatus } from "@/lib/api/contracts/social"
import { isNotFound } from "@/lib/api/errors"
import { useApi } from "@/lib/api/use-api"

/** The request's status for its confirmation code: Received or Completed, nothing else. */
export function DataDeletionStatus() {
  const code = useSearchParams().get("code")?.trim() ?? ""
  const valid = /^[A-Za-z0-9_-]{16,40}$/.test(code)
  const { data, error, isLoading, revalidate } = useApi(valid ? `/api/social/data-deletion/${encodeURIComponent(code)}` : null, (k) => api<{ status: "received" | "completed" }>(k, { schema: dataDeletionStatus }), { revalidateOnFocus: false })

  const box = "flex items-start gap-3 rounded-lg border border-line-soft bg-card p-5"
  if (!valid || isNotFound(error))
    return (
      <div className={box}>
        <WarningCircleIcon className="mt-0.5 size-5 shrink-0 text-ink-2" aria-hidden />
        <div>
          <p className="text-ink">We couldn&apos;t find that request</p>
          <p className="mt-1 text-sm text-ink-2">Check that the link is the one Instagram gave you, with its whole confirmation code.</p>
        </div>
      </div>
    )
  if (isLoading)
    return (
      <div role="status" className={box}>
        <span className="sr-only">Checking the request</span>
        <Bone className="size-5 rounded-full" />
        <div className="grid flex-1 gap-2">
          <Bone className="h-4 w-32" />
          <Bone className="h-3 w-3/4" />
        </div>
      </div>
    )
  if (error || !data)
    return (
      <div className={box}>
        <WarningCircleIcon className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
        <div className="grid gap-3">
          <p className="text-ink">Couldn&apos;t check the request right now</p>
          <Button variant="secondary" className="w-fit" onClick={() => void revalidate()}>
            Try again
          </Button>
        </div>
      </div>
    )
  const done = data.status === "completed"
  return (
    <div className={box} role="status">
      {done ? <CheckCircleIcon weight="fill" className="mt-0.5 size-5 shrink-0 text-ink" aria-hidden /> : <ClockIcon className="mt-0.5 size-5 shrink-0 text-ink-2" aria-hidden />}
      <div>
        <p className="text-ink">{done ? "Completed" : "Received"}</p>
        <p className="mt-1 text-sm text-ink-2">{done ? "Yard has deleted the data it imported for this request." : "Yard has your request and is deleting the data it imported."}</p>
        <p className="mt-3 text-xs text-ink-3 break-all">Confirmation code {code}</p>
      </div>
    </div>
  )
}
