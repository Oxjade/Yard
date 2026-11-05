"use client"

import { GlobeIcon as Globe } from "@phosphor-icons/react"
import { countries, countryCodes, currencies, currencyCodes, type CountryCode, type CurrencyCode } from "@/config/markets"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useHydrated } from "@/hooks/use-hydrated"
import { useSession } from "@/lib/stores/session"

/** Ship-to country and display currency. Choosing a country suggests its currency. */
export function LocaleSelect() {
  const hydrated = useHydrated()
  const currency = useSession((s) => s.currency)
  const shipTo = useSession((s) => s.shipTo)
  const setCurrency = useSession((s) => s.setCurrency)
  const setShipTo = useSession((s) => s.setShipTo)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Globe className="size-4 text-ink-3" aria-hidden />
      <Select
        value={hydrated ? shipTo : "NG"}
        onValueChange={(v) => {
          const c = v as CountryCode
          setShipTo(c)
          setCurrency(countries[c].currency as CurrencyCode)
        }}
      >
        <SelectTrigger size="sm" className="h-8 min-w-36 border-white/10 bg-transparent text-xs" aria-label="Ship to">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {countryCodes.map((c) => (
            <SelectItem key={c} value={c}>Ship to {countries[c].name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={hydrated ? currency : "USD"} onValueChange={(v) => setCurrency(v as CurrencyCode)}>
        <SelectTrigger size="sm" className="h-8 min-w-24 border-white/10 bg-transparent text-xs" aria-label="Currency">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {currencyCodes.map((c) => (
            <SelectItem key={c} value={c}>{c} {currencies[c].symbol}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
