"use client"

import { PlusIcon, XIcon } from "@phosphor-icons/react"
import { DAYS, dayLabels, type DayKey, type HoursRange, type PlaceHours } from "@/lib/around/hours"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

export const defaultHours = (): PlaceHours => ({ mon: [["10:00", "19:00"]], tue: [["10:00", "19:00"]], wed: [["10:00", "19:00"]], thu: [["10:00", "19:00"]], fri: [["10:00", "19:00"]], sat: [["10:00", "19:00"]], sun: null })

/**
 * Weekly opening hours for stores and showrooms (§6.4 Hours): a row per weekday with a Closed
 * switch and up to two ranges, "Copy Monday to weekdays", in the place's own time zone.
 */
export function HoursEditor({ id, value, onChange, errors, zoneLabel }: { id: string; value: PlaceHours; onChange: (h: PlaceHours) => void; errors: Record<string, string>; zoneLabel: string }) {
  const set = (d: DayKey, ranges: HoursRange[] | null) => onChange({ ...value, [d]: ranges })
  const copyMonday = () => {
    const mon = value.mon
    onChange({ ...value, tue: mon && [...mon.map((r) => [...r] as HoursRange)], wed: mon && [...mon.map((r) => [...r] as HoursRange)], thu: mon && [...mon.map((r) => [...r] as HoursRange)], fri: mon && [...mon.map((r) => [...r] as HoursRange)] })
  }
  return (
    <div className="grid gap-2" role="group" aria-labelledby={`${id}-label`}>
      <div className="flex items-baseline justify-between gap-3">
        <p id={`${id}-label`} className="text-[13px] text-ink">
          Opening hours <span className="text-xs text-ink-3">({zoneLabel})</span>
        </p>
        <Button type="button" variant="link" size="xs" onClick={copyMonday} className="text-xs">
          Copy Monday to weekdays
        </Button>
      </div>
      <ul className="grid gap-1.5">
        {DAYS.map((d) => {
          const ranges = value[d]
          const open = !!ranges && ranges.length > 0
          const err = errors[`hours.${d}`]
          return (
            <li key={d} className={cn("grid gap-2 rounded-md border border-line-soft px-3 py-2 sm:grid-cols-[7.5rem_auto_minmax(0,1fr)] sm:items-center", err && "border-danger/50")}>
              <span className="text-[13px] text-ink">{dayLabels[d]}</span>
              <label className="flex min-h-10 items-center gap-2 text-xs text-ink-2 sm:min-h-0">
                <Switch checked={open} onCheckedChange={(on) => set(d, on ? [["10:00", "19:00"]] : null)} aria-label={`${dayLabels[d]} open`} />
                {open ? "Open" : "Closed"}
              </label>
              {open ? (
                <div className="flex flex-wrap items-center gap-2">
                  {ranges!.map((r, i) => (
                    <span key={i} className="inline-flex items-center gap-1.5">
                      <Input type="time" aria-label={`${dayLabels[d]} opens`} value={r[0]} onChange={(e) => set(d, ranges!.map((x, j) => (j === i ? [e.target.value, x[1]] : x)) as HoursRange[])} className="h-10 w-[7.25rem] md:h-9" aria-invalid={err ? true : undefined} />
                      <span className="text-xs text-ink-3">to</span>
                      <Input type="time" aria-label={`${dayLabels[d]} closes`} value={r[1]} onChange={(e) => set(d, ranges!.map((x, j) => (j === i ? [x[0], e.target.value] : x)) as HoursRange[])} className="h-10 w-[7.25rem] md:h-9" aria-invalid={err ? true : undefined} />
                      {ranges!.length > 1 ? (
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove this ${dayLabels[d]} range`} onClick={() => set(d, ranges!.filter((_, j) => j !== i))}>
                          <XIcon />
                        </Button>
                      ) : null}
                    </span>
                  ))}
                  {ranges!.length < 2 ? (
                    <Button type="button" variant="ghost" size="sm" onClick={() => set(d, [...ranges!, ["15:00", "19:00"]])}>
                      <PlusIcon /> Add a range
                    </Button>
                  ) : null}
                </div>
              ) : (
                <span className="hidden sm:block" />
              )}
              {err ? <p className="text-xs text-danger sm:col-span-3">{err}</p> : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
