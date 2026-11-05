"use client"

import { useState } from "react"
import { Ruler } from "lucide-react"
import { motion } from "motion/react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { chartFor, formatMeasure } from "./size-charts"

/** "Size guide" link that opens a dialog with the measurement table; the chosen size's row is highlighted. */
export function SizeGuide({ sizes, selected, brandName, fitNote }: { sizes: string[]; selected?: string; brandName: string; fitNote?: string }) {
  const chart = chartFor(sizes)
  const [unit, setUnit] = useState<"cm" | "in">("cm")
  if (!chart) return null

  const unitLine = chart.convertible ? `Measurements in ${unit}` : chart.unitNote
  const unitName = chart.convertible ? (unit === "cm" ? "centimetres" : "inches") : null

  return (
    <Dialog>
      <DialogTrigger className="inline-flex items-center gap-1.5 rounded-md py-1 text-sm text-violet underline-offset-4 hover:underline">
        <Ruler className="size-4" />
        Size guide
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-display-sm text-ink">Size guide</DialogTitle>
          <DialogDescription className="text-pretty text-ink-2">
            {chart.kind === "apparel"
              ? "Body measurements, not garment measurements. Between two sizes, take the larger one."
              : chart.kind === "shoes"
                ? "EU sizing, converted. If you're between sizes, go half a size up."
                : "Ring sizes in US numbering. Measure at the end of the day, when fingers are largest."}
          </DialogDescription>
        </DialogHeader>

        {fitNote ? (
          <p className="rounded-lg border border-line-soft bg-surface px-3 py-2.5 text-sm text-ink">
            <span className="text-ink-2">Fit note from {brandName}: </span>
            {fitNote}
          </p>
        ) : null}

        {unitLine ? (
          <div className="flex min-h-9 items-center justify-between gap-3">
            <p className="text-xs text-ink-2">{unitLine}</p>
            {chart.convertible ? (
              <div className="inline-flex rounded-md border border-line p-0.5" role="group" aria-label="Units">
                {(["cm", "in"] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    aria-pressed={unit === u}
                    onClick={() => setUnit(u)}
                    className={cn("relative isolate h-8 w-12 rounded-[5px] text-xs transition-colors", unit === u ? "text-ink" : "text-ink-2 hover:text-ink")}
                  >
                    {unit === u ? <motion.span layoutId="size-guide-unit" className="absolute inset-0 -z-10 rounded-[5px] bg-purple" /> : null}
                    {u}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Fits the phone dialog; a wide chart scrolls sideways with the size column pinned. */}
        <div className="overflow-x-auto overscroll-x-contain rounded-lg border border-line-soft bg-surface">
          <table className="w-full text-sm">
            <caption className="sr-only">Size chart{unitName ? `, in ${unitName}` : chart.unitNote ? `. ${chart.unitNote}` : ""}</caption>
            <thead className="border-b border-line-soft text-xs text-ink-3">
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-surface px-2 py-2.5 text-left font-normal sm:px-3">Size</th>
                {chart.columns.map((c) => (
                  <th key={c} scope="col" className="px-2 py-2.5 text-right font-normal sm:px-3">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {chart.rows.map((r) => {
                const active = r.size === selected
                return (
                  <tr key={r.size} className={cn("group transition-colors", active ? "bg-purple/15" : "hover:bg-white/[0.02]")} aria-current={active ? "true" : undefined}>
                    <th scope="row" className="sticky left-0 z-10 bg-surface px-2 py-2.5 text-left font-medium whitespace-nowrap text-ink tabular sm:px-3">
                      {/* The pinned cell is opaque, so it carries the row's tint itself. */}
                      <span aria-hidden className={cn("absolute inset-0 -z-10 transition-colors", active ? "bg-purple/15" : "group-hover:bg-white/[0.02]")} />
                      {r.size}
                      {active ? <span className="ml-2 text-xs font-normal text-violet">Selected</span> : null}
                    </th>
                    {r.values.map((v, i) => (
                      <td key={i} className="px-2 py-2.5 text-right text-ink-2 tabular sm:px-3">
                        {formatMeasure(v, chart.unit, unit)}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div>
          <h3 className="text-sm font-medium text-ink">How to measure</h3>
          <dl className="mt-2 grid gap-2 text-sm">
            {chart.howToMeasure.map((m) => (
              <div key={m.label}>
                <dt className="inline text-ink">{m.label}. </dt>
                <dd className="inline text-ink-2">{m.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </DialogContent>
    </Dialog>
  )
}
