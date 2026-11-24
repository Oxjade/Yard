"use client"

import { ArrowSquareOutIcon, WarningIcon } from "@phosphor-icons/react"
import { StatusBadge } from "@/components/dashboard/status-badge"
import { Bone } from "@/components/feedback/skeletons"
import { Panel } from "@/components/admin/ui/panel"
import type { CurrencyCode } from "@/config/markets"
import type { AdminCouriersDto } from "@/lib/api/contracts/shipping"
import { errorMessage } from "@/lib/api/errors"
import { ADMIN_COURIERS_KEY, getAdminCouriers } from "@/lib/api/shipping"
import { useApi } from "@/lib/api/use-api"
import { formatMoney } from "@/lib/money"
import { formatDate } from "@/components/admin/marketplace/format"

/**
 * Admin › Delivery › Couriers (docs/SHIPPING.md): the courier service, its wallet (read-only, with
 * the low-balance line), courier money collected from shoppers vs spent on pickups (ledger), booked
 * shipments and the provider's failures. Nothing here moves money.
 */

const money = (minor: number | null, currency: string) => {
  if (minor === null) return "—"
  try {
    return formatMoney(minor, currency as CurrencyCode)
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`
  }
}

const stateMeta: Record<string, { label: string; tone: "success" | "info" | "attention" | "danger" | "muted" }> = {
  booking: { label: "Booking", tone: "info" },
  booked: { label: "Booked", tone: "info" },
  in_transit: { label: "In transit", tone: "info" },
  delivered: { label: "Delivered", tone: "success" },
  cancelled: { label: "Cancelled", tone: "danger" },
  failed: { label: "Failed", tone: "attention" },
  needs_review: { label: "Check with courier", tone: "danger" },
}

const failureLabel: Record<string, string> = {
  quote_failed: "Rates failed",
  book_failed: "Booking failed",
  track_failed: "Tracking failed",
  wallet_failed: "Wallet read failed",
  price_over_cap: "Price over cap",
  wallet_low: "Wallet low",
  unmatched: "Unknown shipment",
}

export function CouriersPanel() {
  const q = useApi<AdminCouriersDto>(ADMIN_COURIERS_KEY, () => getAdminCouriers(), { refreshInterval: 60_000 })
  const d = q.data
  if (!d) {
    return (
      <Panel id="couriers" title="Couriers" description="Live courier rates, booked pickups and Yard's courier wallet.">
        <div>{q.error ? <p className="text-sm text-ink-2">{errorMessage(q.error, "Couldn't load couriers.")}</p> : <Bone className="h-16 w-full" />}</div>
      </Panel>
    )
  }
  const w = d.wallet
  const lowOrBroken = !!w && ("error" in w || w.low)
  return (
    <Panel
      id="couriers"
      title="Couriers"
      description={d.provider ? `${d.provider.label}${d.provider.sandbox ? " (sandbox: no courier collects, nothing is charged)" : ""}. Shoppers pay the courier's price; Yard's wallet pays the courier. Price rises up to ${money(d.absorbCapMinor, "NGN")} are absorbed silently.` : "No courier service is connected (YARD_SHIPPING_PROVIDER=off). Brands use their own rates and add tracking by hand."}
      attention={lowOrBroken}
    >
      <div className="grid gap-4">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1 rounded-md border border-line-soft p-3">
            <dt className="text-[11px] text-ink-3">Wallet balance</dt>
            <dd className="flex items-center gap-2 text-sm text-ink tabular">
              {!w ? "—" : "error" in w ? <span className="text-ink-2">{w.error}</span> : money(w.amountMinor, w.currency)}
              {w && !("error" in w) && w.low ? <StatusBadge tone="danger">Low</StatusBadge> : null}
            </dd>
            {w && !("error" in w) ? <span className="text-[11px] text-ink-3">Alert under {money(w.lowAtMinor, w.currency)} · read {formatDate(w.readAt)}</span> : null}
          </div>
          {(d.totals.length ? d.totals : [{ currency: "NGN", collectedMinor: 0, spentMinor: 0 }]).map((t) => (
            <div key={t.currency} className="grid gap-1 rounded-md border border-line-soft p-3">
              <dt className="text-[11px] text-ink-3">Shipping collected vs spent ({t.currency})</dt>
              <dd className="text-sm text-ink tabular">
                {money(t.collectedMinor, t.currency)} <span className="text-ink-3">vs</span> {money(t.spentMinor, t.currency)}
              </dd>
              <span className="text-[11px] text-ink-3">Net {money(t.collectedMinor - t.spentMinor, t.currency)} · never paid out to brands</span>
            </div>
          ))}
          <div className="grid gap-1 rounded-md border border-line-soft p-3">
            <dt className="text-[11px] text-ink-3">Shipments</dt>
            <dd className="text-sm text-ink tabular">
              {(d.counts.booked ?? 0) + (d.counts.in_transit ?? 0)} active · {d.counts.delivered ?? 0} delivered
            </dd>
            {(d.counts.failed ?? 0) + (d.counts.needs_review ?? 0) > 0 ? <span className="text-[11px] text-danger">{(d.counts.failed ?? 0) + (d.counts.needs_review ?? 0)} need attention</span> : <span className="text-[11px] text-ink-3">None need attention</span>}
          </div>
        </dl>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[12px]">
            <caption className="sr-only">Booked courier shipments, newest first</caption>
            <thead className="text-ink-3">
              <tr className="border-b border-line-soft">
                <th className="py-2 pr-3 font-normal">Order</th>
                <th className="py-2 pr-3 font-normal">Brand</th>
                <th className="py-2 pr-3 font-normal">Courier · tracking</th>
                <th className="py-2 pr-3 font-normal">Status</th>
                <th className="py-2 pr-3 text-right font-normal">Collected</th>
                <th className="py-2 pr-3 text-right font-normal">Cost</th>
                <th className="py-2 font-normal">Booked</th>
              </tr>
            </thead>
            <tbody>
              {d.shipments.length ? (
                d.shipments.map((s) => {
                  const m = stateMeta[s.status] ?? { label: s.status, tone: "muted" as const }
                  return (
                    <tr key={s.id} className="border-b border-line-soft align-top">
                      <td className="py-2 pr-3 text-ink tabular">{s.reference}</td>
                      <td className="py-2 pr-3 text-ink-2">{s.brand}</td>
                      <td className="py-2 pr-3 text-ink-2">
                        {s.courierName ?? "—"}
                        {s.trackingCode ? (
                          <span className="block tabular text-ink">
                            {s.trackingUrl ? (
                              <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
                                {s.trackingCode} <ArrowSquareOutIcon className="size-3" aria-hidden />
                              </a>
                            ) : (
                              s.trackingCode
                            )}
                          </span>
                        ) : null}
                        {s.error ? <span className="block text-ink-3">{s.error}</span> : null}
                      </td>
                      <td className="py-2 pr-3">
                        <StatusBadge tone={m.tone}>{m.label}</StatusBadge>
                      </td>
                      <td className="py-2 pr-3 text-right tabular text-ink">{money(s.collectedMinor, s.currency)}</td>
                      <td className="py-2 pr-3 text-right tabular text-ink">
                        {money(s.costMinor, s.currency)}
                        {s.priceDiffMinor > 0 ? <span className={s.overCap ? "block text-danger" : "block text-ink-3"}>+{money(s.priceDiffMinor, s.currency)} absorbed</span> : null}
                      </td>
                      <td className="py-2 text-ink-2">{s.bookedAt ? formatDate(s.bookedAt) : "—"}</td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-ink-3">
                    No courier pickups booked yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="grid gap-2">
          <h3 className="font-label text-[12px] text-ink">Provider failures</h3>
          {d.failures.length ? (
            <ul className="grid gap-1.5 text-[12px]">
              {d.failures.slice(0, 12).map((f) => (
                <li key={f.id} className="flex items-start gap-2 text-ink-2">
                  <WarningIcon className="mt-0.5 size-3.5 shrink-0 text-ink-3" aria-hidden />
                  <span className="min-w-0">
                    <span className="text-ink">{failureLabel[f.kind] ?? f.kind}</span> · {formatDate(f.at)}
                    {f.detail ? <span className="block break-words text-ink-3">{f.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-ink-3">None. When the courier service can&apos;t price, book or track, checkout falls back to the brand&apos;s own rates and it shows here.</p>
          )}
        </div>
      </div>
    </Panel>
  )
}
