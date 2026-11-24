"use client"

import { useState } from "react"
import { toast } from "sonner"
import { PackageIcon } from "@phosphor-icons/react"
import { insetClass } from "@/components/admin/marketplace/detail-sheet"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { ImportedStockDto } from "@/lib/api/contracts/imports"
import { errorMessage } from "@/lib/api/errors"
import { markImportedStockAvailable, previewImportedStock } from "@/lib/api/imports"
import { useApi } from "@/lib/api/use-api"
import { cn } from "@/lib/utils"

/*
 * Admin › Brands › a brand › Products: "Mark imported products as available (stock not tracked)".
 * Products imported before the importer read "available, no count" as in stock came in at 0 and
 * show as sold out. The confirmation previews what changes (and what stays) before anything does.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function skippedLines(s: ImportedStockDto["skipped"]) {
  return [
    s.soldOutOnSite ? `${plural(s.soldOutOnSite, "size")} sold out on their site` : null,
    s.countOnSite ? `${plural(s.countOnSite, "size")} with a count on their site` : null,
    s.stockSetInYard ? `${plural(s.stockSetInYard, "size")} with stock set or sold on Yard` : null,
    s.unknown ? `${plural(s.unknown, "size")} the site didn't say were available` : null,
  ].filter((x): x is string => !!x)
}

export function ImportedStockAction({ brandId, brandName }: { brandId: string; brandName: string }) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const preview = useApi(open ? `admin.imported_stock:${brandId}` : null, () => previewImportedStock(brandId), { revalidateOnFocus: false })
  const plan = preview.data
  const kept = plan ? skippedLines(plan.skipped) : []

  async function confirm() {
    setPending(true)
    setFailure(null)
    try {
      const r = await markImportedStockAvailable(brandId)
      setOpen(false)
      toast.success(r.variants ? `${plural(r.products, "product")} back in stock` : "Nothing needed changing", {
        description: r.variants ? `${plural(r.variants, "size")} of ${r.brandName} are now available, stock not tracked.` : "Every imported size already has stock or is sold out on their site.",
      })
      void preview.revalidate()
    } catch (e) {
      setFailure(errorMessage(e, "That didn't go through, so nothing changed."))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFailure(null)
          setOpen(true)
        }}
        className={cn("group flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors duration-150 hover:border-white/[0.13] hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:outline-violet", insetClass)}
        data-testid="imported-stock-open"
      >
        <span className="min-w-0">
          <span className="block text-[13px] text-ink group-hover:text-violet">Mark imported products as available</span>
          <span className="block truncate text-[11px] text-ink-3">Stock not tracked, for sizes their site shows as available without a count</span>
        </span>
        <PackageIcon className="size-3.5 shrink-0 text-ink-3 group-hover:text-violet" aria-hidden />
      </button>

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-[480px]" data-testid="imported-stock-dialog">
          <DialogHeader>
            <DialogTitle className="font-label pr-6 text-base">Mark {brandName}&apos;s imported products as available?</DialogTitle>
            <DialogDescription className="text-ink-2">
              {preview.error
                ? errorMessage(preview.error)
                : !plan
                  ? `Checking ${brandName}'s imported products…`
                  : plan.variants
                    ? `${plural(plan.variants, "size")} across ${plural(plan.products, "product")} were in stock on ${plan.platforms.length ? plan.platforms.join(" and ") : "their site"} without a count, so they came in at 0 and show as sold out.`
                    : plan.imported
                      ? `None of ${brandName}'s ${plural(plan.imported, "imported product")} needs this.`
                      : `${brandName} has no products imported from its website.`}
            </DialogDescription>
          </DialogHeader>

          {plan && plan.variants ? (
            <ul className="grid list-disc gap-1 rounded-md border border-white/10 bg-white/[0.02] py-2.5 pr-3 pl-7 text-[12px] leading-snug text-ink-2">
              <li>They become in stock with the count not tracked: shoppers can buy them, and no number is shown or made up.</li>
              <li>Anyone who asked to hear when one is back is told.</li>
              <li>{brandName} can set a count for any size in Studio at any time; that turns tracking back on.</li>
            </ul>
          ) : null}

          {plan && kept.length ? (
            <div className="grid gap-1.5">
              <p className="text-[11px] text-ink-3">Left as they are</p>
              <ul className="grid gap-0.5 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-[12px] text-ink-2">
                {kept.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {failure ? (
            <p role="alert" className="text-sm text-danger">
              {failure}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
              {plan && !plan.variants ? "Close" : "Cancel"}
            </Button>
            {plan && plan.variants ? (
              <Button type="button" variant="primary" loading={pending} onClick={() => void confirm()} data-testid="imported-stock-confirm">
                Mark {plural(plan.variants, "size")} available
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
