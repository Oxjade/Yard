"use client"

import { useId, useState, useSyncExternalStore } from "react"
import { CaretDownIcon, CheckIcon, MapPinIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { countries, countryCodes, type CountryCode } from "@/config/markets"
import { useHydrated } from "@/hooks/use-hydrated"
import { cities, fold } from "@/lib/around/gazetteer"
import { useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"

const PHONE = "(max-width: 639px)"
function subscribePhone(cb: () => void) {
  const mq = window.matchMedia(PHONE)
  mq.addEventListener("change", cb)
  return () => mq.removeEventListener("change", cb)
}
const usePhone = () => useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches, () => false)

/** Gazetteer suggestions for a city typed in a country: city names first, then neighbourhoods ("Yaba, Lagos"). */
function suggestions(country: CountryCode, q: string) {
  const query = fold(q)
  const inCountry = cities.filter((c) => c.country === country)
  if (!query) return inCountry.map((c) => c.name).slice(0, 6)
  const out: string[] = []
  for (const c of inCountry) {
    if ([c.name, ...c.aliases].some((n) => fold(n).startsWith(query))) out.push(c.name)
  }
  for (const c of inCountry) for (const h of c.neighbourhoods) if ([h.name, ...h.aliases].some((n) => fold(n).startsWith(query))) out.push(c.name)
  return [...new Set(out)].slice(0, 6)
}

/** "Lagos, Nigeria" or "Nigeria". */
export function destinationLabel(country: CountryCode, city: string | null) {
  return city ? `${city}, ${countries[country].name}` : countries[country].name
}

/**
 * "Deliver to Lagos, Nigeria ⌄" (§6.5): a Popover on desktop, a Sheet on phones, with the 11
 * markets, an optional city (gazetteer suggestions, never a precise location) and Save. Saving sets
 * the session's ship-to country and city; every estimate and the bag follow.
 */
export function DestinationPicker({ className }: { className?: string }) {
  const hydrated = useHydrated()
  const shipTo = useSession((s) => s.shipTo)
  const shipToCity = useSession((s) => s.shipToCity)
  const phone = usePhone()
  const [open, setOpen] = useState(false)
  const country: CountryCode = hydrated ? shipTo : "NG"
  const city = hydrated ? shipToCity : null

  const label = destinationLabel(country, city)
  if (phone)
    return (
      <>
        <Trigger label={label} open={open} className={className} onClick={() => setOpen(true)} />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="max-h-[88dvh] gap-0 rounded-t-2xl border-line-soft bg-surface p-0">
            <SheetHeader className="border-b border-line-soft p-4 pr-12">
              <SheetTitle className="text-[15px] text-ink">Deliver to</SheetTitle>
              <SheetDescription className="text-xs text-ink-2">Estimates and shipping prices follow your choice.</SheetDescription>
            </SheetHeader>
            <PickerForm country={country} city={city} onDone={() => setOpen(false)} phone />
          </SheetContent>
        </Sheet>
      </>
    )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Trigger label={label} open={open} className={className} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <PickerForm country={country} city={city} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

function Trigger({ label, open, className, ...props }: { label: string; open: boolean; className?: string } & React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      {...props}
      className={cn("-mx-1 inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-md px-1 text-left text-sm text-ink-2 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-violet", className)}
    >
      <MapPinIcon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">
        Deliver to <span className="text-ink">{label}</span>
      </span>
      <CaretDownIcon className={cn("size-3.5 shrink-0 transition-transform duration-200", open && "rotate-180")} aria-hidden />
    </button>
  )
}

function PickerForm({ country, city, onDone, phone = false }: { country: CountryCode; city: string | null; onDone: () => void; phone?: boolean }) {
  const setShipTo = useSession((s) => s.setShipTo)
  const setShipToCity = useSession((s) => s.setShipToCity)
  const [to, setTo] = useState<CountryCode>(country)
  const [cityText, setCityText] = useState(city ?? "")
  const [error, setError] = useState<string | null>(null)
  const listId = useId()
  const hints = suggestions(to, cityText).filter((h) => fold(h) !== fold(cityText))

  function save(e: React.FormEvent) {
    e.preventDefault()
    const c = cityText.trim()
    if (c.length > 60) {
      setError("Keep the city to 60 characters.")
      return
    }
    setShipTo(to)
    setShipToCity(c || null)
    onDone()
  }

  return (
    <form onSubmit={save} noValidate className="flex min-h-0 flex-1 flex-col">
      <fieldset className={cn("min-h-0 overflow-y-auto overscroll-contain", phone ? "flex-1 p-4" : "max-h-72 p-2")}>
        <legend className="sr-only">Country</legend>
        <ul className="grid gap-0.5" role="radiogroup" aria-label="Country">
          {countryCodes.map((c) => (
            <li key={c}>
              <button
                type="button"
                role="radio"
                aria-checked={to === c}
                onClick={() => {
                  // A country change drops a city typed for the old one.
                  if (c !== to) setCityText("")
                  setTo(c)
                }}
                className={cn("flex min-h-10 w-full items-center justify-between gap-3 rounded-md px-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-violet", to === c ? "bg-purple/15 text-ink" : "text-ink-2 hover:bg-white/5 hover:text-ink")}
              >
                {countries[c].name}
                {to === c ? <CheckIcon className="size-4 text-violet" aria-hidden /> : null}
              </button>
            </li>
          ))}
        </ul>
      </fieldset>
      <div className={cn("grid gap-2 border-t border-line-soft", phone ? "p-4" : "p-3")}>
        <label htmlFor={`${listId}-city`} className="text-xs text-ink-2">
          City <span className="text-ink-3">(optional)</span>
        </label>
        <Input
          id={`${listId}-city`}
          value={cityText}
          onChange={(e) => {
            setCityText(e.target.value)
            setError(null)
          }}
          maxLength={80}
          autoComplete="address-level2"
          placeholder={suggestions(to, "")[0] ? `For example ${suggestions(to, "")[0]}` : "Your city"}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${listId}-city-hint`}
          className="h-10"
        />
        {hints.length && cityText.trim() ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Suggestions">
            {hints.map((h) => (
              <li key={h}>
                <button type="button" onClick={() => setCityText(h)} className="inline-flex min-h-8 items-center rounded-full border border-line px-3 text-xs text-ink-2 hover:text-ink">
                  {h}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <p id={`${listId}-city-hint`} className={cn("text-xs", error ? "text-danger" : "text-ink-3")}>
          {error ?? "Only used to offer store pickup near you. Never a street address."}
        </p>
      </div>
      {phone ? (
        <SheetFooter className="border-t border-line-soft p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button type="submit" variant="primary" size="lg" className="w-full">
            Save
          </Button>
        </SheetFooter>
      ) : (
        <div className="flex justify-end gap-2 border-t border-line-soft p-3">
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm">
            Save
          </Button>
        </div>
      )}
    </form>
  )
}
