"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { MagnifyingGlassIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DataTable, type Column } from "@/components/dashboard/data-table"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Segmented } from "@/components/admin/ui/segmented"
import { payoutStatusLabel } from "@/lib/admin-storefront"
import { formatOwed } from "@/lib/payout-needed"
import { listAdminPayoutAccounts, payoutAccountsKey } from "@/lib/api/admin-storefront"
import { PAYOUT_ACCOUNT_FILTERS, type AdminPayoutAccountRowDto, type PayoutAccountFilter } from "@/lib/api/contracts/admin-payout-accounts"
import { errorMessage } from "@/lib/api/errors"
import { useApi } from "@/lib/api/use-api"
import { useSearchParam, writeParams } from "./table"

const PAGE_SIZE = 200
const filterLabels: Record<PayoutAccountFilter, string> = { all: "All brands", owed: "Owed, no account", missing: "Missing account", pending: "Pending", verified: "Verified" }
const statusTone = { none: "attention", pending: "muted", verified: "success" } as const
const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
const isFilter = (v: string | null): v is PayoutAccountFilter => !!v && (PAYOUT_ACCOUNT_FILTERS as readonly string[]).includes(v)

function useDebounced(value: string, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * Admin › Finance › Payout accounts (Owner and Finance): every brand and whether it has added a
 * payout account (none / pending / verified), the bank, account name and last 4 digits (never the
 * number), when it was added or changed, and whether the brand can sell (an account, a live
 * storefront, good standing). GET /api/admin/finance/payout-accounts.
 */
export function PayoutAccountsTab() {
  const param = useSearchParam("status")
  const filter: PayoutAccountFilter = isFilter(param) ? param : "all"
  const [text, setText] = useState("")
  const q = useDebounced(text.trim(), 250)
  // The page belongs to one search and filter: a new search or filter starts again at page 1.
  const scope = `${filter}|${q}`
  const [paging, setPaging] = useState({ scope, page: 1 })
  const page = paging.scope === scope ? paging.page : 1
  const setPage = (next: number) => setPaging({ scope, page: next })
  const query = { status: filter, q: q || undefined, page, pageSize: PAGE_SIZE }
  const list = useApi(payoutAccountsKey(query), () => listAdminPayoutAccounts(query), { revalidateOnFocus: true })
  const data = list.data
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  const columns: Column<AdminPayoutAccountRowDto>[] = [
    {
      key: "brand",
      header: "Brand",
      sortValue: (r) => r.name.toLowerCase(),
      cell: (r) => (
        <Link href={`/admin/brands?tab=all&review=${encodeURIComponent(`brand:${r.brandId}`)}`} className="grid min-w-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-violet">
          <span className="truncate font-medium text-ink hover:text-violet">{r.name}</span>
          <span className="truncate text-[11.5px] text-ink-3">@{r.handle}</span>
        </Link>
      ),
    },
    {
      key: "status",
      header: "Payout account",
      sortValue: (r) => (r.owedNoAccount ? -1 : r.status === "none" ? 0 : r.status === "pending" ? 1 : 2),
      cell: (r) =>
        r.owedNoAccount ? (
          <span className="grid gap-0.5">
            <span>
              <StatusBadge tone="danger">Owed, no account</StatusBadge>
            </span>
            <span className="text-[11.5px] text-ink-2 tabular">
              {formatOwed(r.owed)} held{r.payoutNeededSince ? ` since ${dateFmt.format(new Date(r.payoutNeededSince))}` : ""}
            </span>
          </span>
        ) : (
          <StatusBadge tone={statusTone[r.status]}>{payoutStatusLabel[r.status]}</StatusBadge>
        ),
    },
    {
      key: "owed",
      header: "Owed",
      hideBelow: "md",
      sortValue: (r) => r.owed[0]?.minor ?? 0,
      cell: (r) => (r.owed.length ? <span className="whitespace-nowrap text-ink tabular">{formatOwed(r.owed)}</span> : <span className="text-ink-3">—</span>),
    },
    {
      key: "bank",
      header: "Bank",
      hideBelow: "md",
      sortValue: (r) => r.account?.bankName.toLowerCase() ?? "",
      cell: (r) =>
        r.account ? (
          <span className="grid min-w-0">
            <span className="truncate text-ink">
              {r.account.bankName} <span className="tabular">•••• {r.account.last4}</span>
            </span>
            <span className="truncate text-[11.5px] text-ink-3">
              {r.account.accountName}, {r.account.currency}
            </span>
          </span>
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    {
      key: "changed",
      header: "Added or changed",
      hideBelow: "lg",
      sortValue: (r) => r.account?.changedAt ?? "",
      cell: (r) => (r.account ? <time dateTime={r.account.changedAt} className="whitespace-nowrap text-ink-2 tabular">{dateFmt.format(new Date(r.account.changedAt))}</time> : <span className="text-ink-3">—</span>),
    },
    {
      key: "sell",
      header: "Can sell",
      sortValue: (r) => (r.canSell ? 1 : 0),
      cell: (r) =>
        r.canSell ? (
          <StatusBadge tone="success">Yes</StatusBadge>
        ) : (
          <span className="grid gap-0.5">
            <span>
              <StatusBadge tone="muted">No</StatusBadge>
            </span>
            <span className="text-[11.5px] text-ink-3">{r.reasons.join(", ")}</span>
          </span>
        ),
    },
  ]

  return (
    <section className="grid gap-3" aria-label="Payout accounts">
      <p className="text-[12.5px] text-ink-3">
        Every brand and the bank account Yard pays it into. Owed, no account (listed first) means Yard holds the brand&apos;s earnings and has nowhere to pay them yet; Yard emails it to add one. Verified means a payment provider confirmed the account; pending means it&apos;s on file but unconfirmed, so check the name before paying it by hand. Only the last 4 digits are ever shown.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="rail overflow-x-auto">
          <Segmented
            label="Payout account status"
            size="sm"
            countTone="neutral"
            loading={!data}
            value={filter}
            onChange={(v) => writeParams({ status: v === "all" ? null : v })}
            options={PAYOUT_ACCOUNT_FILTERS.map((f) => ({ value: f, label: filterLabels[f], count: data?.counts[f] }))}
          />
        </div>
        <label className="relative ml-auto w-full sm:w-[260px]">
          <span className="sr-only">Search brands</span>
          <MagnifyingGlassIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by brand or handle" className="h-9 pl-9" />
        </label>
      </div>
      <DataTable
        label="Payout accounts"
        rows={data?.items ?? []}
        columns={columns}
        getId={(r) => r.brandId}
        loading={!data && !list.error}
        error={list.error && !data ? errorMessage(list.error, "Couldn't load payout accounts.") : null}
        onRetry={() => void list.revalidate()}
        empty={
          q || filter !== "all"
            ? { title: "No brands match", body: "Try another search or status.", action: <Button size="sm" variant="secondary" onClick={() => { setText(""); writeParams({ status: null }) }}>Show every brand</Button> }
            : { title: "No brands yet", body: "Every brand on Yard is listed here." }
        }
        initialPageSize={25}
        pageSizes={[25, 50, 100]}
        minWidth={300}
      />
      {pages > 1 ? (
        <div className="flex items-center justify-end gap-2 text-[12px] text-ink-3">
          <span className="tabular">
            Brands {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, data?.total ?? 0)} of {data?.total}
          </span>
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      ) : null}
    </section>
  )
}
