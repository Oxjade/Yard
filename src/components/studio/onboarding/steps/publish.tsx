"use client"

import { CheckIcon as Check, CircleDashedIcon as CircleDashed } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { countries } from "@/config/markets"
import { formatMoney, formatNumber } from "@/lib/money"
import { cn } from "@/lib/utils"
import { Panel } from "@/components/studio/growth/form"
import { storefrontAccents, storefrontTemplates, storefrontType } from "@/components/storefront/theme"
import { STEP_FORM_ID, type StepProps } from "../step-form"
import { StorefrontPreview } from "../storefront-preview"
import { useOnboarding } from "../store"
import { isWhole, parsePrice, stepComplete } from "../validation"

export function PublishStep({ onNext }: StepProps) {
  const data = useOnboarding((s) => s.data)
  const goTo = useOnboarding((s) => s.goTo)
  const done = stepComplete(data)
  const { account, brand, storefront, business, product, payments } = data
  const currency = business.currency ?? "USD"
  const price = parsePrice(product.price, currency)
  const stock = product.sizes.reduce((n, s) => n + (isWhole(s.stock) ? Number(s.stock) : 0), 0)

  const items = [
    { step: 0, label: "Account", done: done.account, detail: account.email || "Not created yet" },
    { step: 1, label: "Brand", done: done.brand, detail: brand.name ? `${brand.name}, /brands/${brand.handle}` : "Name, handle and logo" },
    {
      step: 2,
      label: "Storefront",
      done: done.storefront,
      detail: storefront.template
        ? `${storefrontTemplates[storefront.template].label} template in ${storefrontAccents[storefront.accent].label.toLowerCase()}, ${storefrontType[storefront.typePreset].label.toLowerCase()} type`
        : "Cover, colour and template",
    },
    { step: 3, label: "Business info", done: done.business, detail: business.country ? `${business.city || "City"}, ${countries[business.country].name}, prices in ${currency}` : "Country, contact and currency" },
    { step: 4, label: "First product", done: done.product, detail: product.name ? `${product.name}${price !== null ? `, ${formatMoney(price, currency)}` : ""}, ${formatNumber(stock)} in stock` : "Photos, price and stock" },
    {
      step: 5,
      label: "Payments and shipping",
      done: done.payments,
      detail: payments.accountSaved ? `Payouts to the account ending ${payments.accountLast4}, ships in ${payments.processingMin}–${payments.processingMax} days` : "Payout method and delivery",
    },
  ]
  const remaining = items.filter((i) => !i.done)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (remaining.length) {
      toast.error("A step still needs details", { description: `Finish ${remaining[0].label.toLowerCase()} and come back to submit.` })
      goTo(remaining[0].step)
      return
    }
    onNext()
  }

  return (
    <form id={STEP_FORM_ID} noValidate onSubmit={submit} className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <section aria-labelledby="ob-preview-title" className="min-w-0">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="ob-preview-title" className="text-sm font-medium text-ink">Storefront preview</h2>
          <p className="truncate text-xs text-ink-3">/brands/{brand.handle}</p>
        </div>
        <StorefrontPreview data={data} size="large" eager />
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-6">
        <Panel title="Checklist" description={remaining.length ? `${remaining.length} ${remaining.length === 1 ? "step needs" : "steps need"} details before you can submit.` : "Everything a basic storefront needs is in place."}>
          <ul className="grid grid-cols-1 gap-1">
            {items.map((i) => (
              <li key={i.label} className="flex items-start gap-3 rounded-md py-2">
                <span className={cn("mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full", i.done ? "bg-purple/20 text-violet" : "text-acid")}>
                  {i.done ? <Check className="size-3" aria-hidden /> : <CircleDashed className="size-4" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-ink">
                    {i.label}
                    <span className="sr-only">{i.done ? ", done" : ", needs details"}</span>
                  </span>
                  <span className="block text-xs text-pretty break-words text-ink-3">{i.detail}</span>
                </span>
                <Button type="button" variant="ghost" size="xs" className="-mr-2" onClick={() => goTo(i.step)} aria-label={`Edit ${i.label.toLowerCase()}`}>
                  {i.done ? "Edit" : "Finish"}
                </Button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="After you submit" description="None of these hold up the review. They can wait.">
          <ul className="grid gap-3 text-sm">
            <li>
              <p className="text-ink">Add more products</p>
              <p className="text-xs text-ink-2">Storefronts with three or more products are reviewed for category pages and editorial picks.</p>
            </li>
            <li>
              <p className="text-ink">Verify before your first payout</p>
              <p className="text-xs text-ink-2">We’ll ask for ID{business.sellerType === "company" ? " and your business registration" : ""} when a payout is due, not before.</p>
            </li>
            <li>
              <p className="text-ink">Make the storefront yours</p>
              <p className="text-xs text-ink-2">Reorder sections, add a story and a lookbook in the storefront editor.</p>
            </li>
          </ul>
        </Panel>
      </div>
    </form>
  )
}
