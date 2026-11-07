"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CircleNotchIcon as Loader2, PackageIcon as Package } from "@phosphor-icons/react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { duration, ease } from "@/lib/motion"
import { AuthPanel } from "@/components/market/account/auth-panel"
import { AuthForm } from "@/components/market/auth-prompt"
import { bagCount } from "@/components/market/bag-count"
import { Price } from "@/components/market/price"
import { Button } from "@/components/ui/button"
import { type CountryCode } from "@/config/markets"
import { useAsyncAction } from "@/hooks/use-async-action"
import { useShippingQuote } from "@/components/market/delivery/use-shipping-quote"
import { priceCart } from "@/lib/cart"
import { img } from "@/lib/data/media"
import { productById } from "@/lib/data/products"
import { useCart } from "@/lib/stores/cart"
import { CheckoutError, useOrders } from "@/lib/stores/orders"
import { useSession } from "@/lib/stores/session"
import { WarningCircleIcon } from "@phosphor-icons/react"
import { toast } from "sonner"
import { countries } from "@/config/markets"
import { Notice } from "./fields"
import { OrderSummaryAside, OrderSummaryDisclosure, type CheckoutTotals } from "./order-summary"
import {
  cardBrand,
  cityLine,
  parsePhone,
  paymentSummary,
  paymentMethodsFor,
  validateAddress,
  validateContact,
  validatePayment,
  type AddressDraft,
  type ContactDraft,
  type FieldErrors,
  type PaymentDraft,
  type PaymentMethod,
} from "./rules"
import { CheckoutSkeleton } from "./skeletons"
import { clearCheckoutDraft, readCheckoutDraft, writeCheckoutDraft } from "./draft"
import { checkoutSteps, StepIndicator } from "./step-indicator"
import { AddressStep, ContactStep, PaymentStep, ReviewStep, ShippingStep } from "./steps"
import { type ShippingMethod } from "./shipping"
import { useStoresReady } from "./use-stores-ready"

const REVIEW = checkoutSteps.length - 1

/**
 * Checkout gate: waits for the persisted stores, sends an empty bag back to /bag and shows
 * guests the family's full-page sign-in before the flow starts. (The bag and the drawer
 * already gate their Checkout through requireAuth; this covers arriving here directly.)
 */
export function CheckoutFlow() {
  const ready = useStoresReady()
  const router = useRouter()
  const lines = useCart((s) => s.lines)
  const clear = useCart((s) => s.clear)
  const user = useSession((s) => s.user)
  const [placed, setPlaced] = useState(false)
  const placedRef = useRef(false)
  // Counted like the bag and the header: a saved line whose piece has left the catalogue isn't
  // listed anywhere, so a bag holding only those is empty and goes back to /bag too.
  const empty = ready && bagCount(lines) === 0

  useEffect(() => {
    if (empty && !placedRef.current) router.replace("/bag")
  }, [empty, router])

  // Cache Components keeps this route mounted (hidden in an Activity) after the shopper
  // moves on to the confirmation. Hiding runs effect cleanups, so the "placed" state is
  // reset there: Back lands on an empty bag (and goes to /bag), and a second checkout in
  // the same tab starts a fresh attempt with a new idempotency key.
  useEffect(
    () => () => {
      placedRef.current = false
      setPlaced(false)
    },
    [],
  )

  function onPlaced(groupId: string) {
    placedRef.current = true
    clearCheckoutDraft()
    // Settle this page (placed, bag emptied) in one commit before navigating, so nothing
    // here updates while the confirmation route renders in the navigation's transition.
    flushSync(() => {
      setPlaced(true)
      clear()
    })
    router.push(`/checkout/confirmation?group=${encodeURIComponent(groupId)}`)
  }

  if (ready && !empty && !user && !placed) {
    const first = lines.map((l) => productById.get(l.productId)).find((p) => p !== undefined)
    return (
      <AuthPanel
        eyebrow="Checkout"
        title="Sign in to check out"
        body="One account keeps the orders from every brand in this bag, and their tracking, in one place. Your bag stays as it is."
        image={first ? first.images[0] : img("objects/bags/2")}
        caption={first ? `In your bag: ${first.name}` : undefined}
      >
        {/* Signing in here keeps the shopper on /checkout: the steps appear in place. */}
        <AuthForm />
      </AuthPanel>
    )
  }

  if (ready && !empty && user && !placed) return <CheckoutSteps userName={user.name} userEmail={user.email} onPlaced={onPlaced} />

  if (!placed) return <CheckoutSkeleton withTitle />

  return (
    <>
      <CheckoutTitle />
      <div role="status" className="mt-10 flex items-center gap-3 rounded-lg border border-line-soft bg-card px-5 py-6 text-sm text-ink-2">
        <Loader2 className="size-4 animate-spin text-violet" aria-hidden />
        Order placed. Opening your confirmation.
      </div>
    </>
  )
}

function CheckoutTitle() {
  return <h1 className="font-display text-display-lg text-ink">Checkout</h1>
}

const slide = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 28 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -28 }),
}

const nextLabel = ["Continue to delivery", "Continue to shipping", "Continue to payment", "Review order"]

function CheckoutSteps({ userName, userEmail, onPlaced }: { userName: string; userEmail: string; onPlaced: (groupId: string) => void }) {
  const lines = useCart((s) => s.lines)
  const currency = useSession((s) => s.currency)
  const country = useSession((s) => s.shipTo)
  const shipToCity = useSession((s) => s.shipToCity)
  const setShipTo = useSession((s) => s.setShipTo)
  const placeCheckout = useOrders((s) => s.placeCheckout)
  const removeLine = useCart((s) => s.remove)
  const reduceMotion = useReducedMotion()

  // The draft survives a reload in this tab (sessionStorage). Card number, expiry and
  // security code are never written anywhere, so they are asked for again.
  const [saved] = useState(() => readCheckoutDraft(userEmail))
  const [contact, setContact] = useState<ContactDraft>(() => saved?.contact ?? { name: userName, email: userEmail, phone: "" })
  const [address, setAddress] = useState<AddressDraft>(() => saved?.address ?? { line1: "", line2: "", city: "", region: "", postcode: "", landmark: "" })
  const [shipping, setShipping] = useState<Record<string, ShippingMethod>>(() => saved?.shipping ?? {})
  const [payment, setPayment] = useState<PaymentDraft>(() => ({ cardName: userName, ussdBank: "", momoNetwork: "", momoNumber: "", ...saved?.payment, method: saved?.payment.method ?? "card", cardNumber: "", expiry: "", cvc: "" }))
  const [step, setStep] = useState(() => resumeStep(saved, country))
  const [dir, setDir] = useState(1)
  const [furthest, setFurthest] = useState(() => saved?.furthest ?? 0)
  const [reviewing, setReviewing] = useState(false)
  const [navigated, setNavigated] = useState(false)
  const [attempted, setAttempted] = useState<Record<number, boolean>>({})
  /** Fields left with a value in them: checked on blur, before the shopper presses Continue. */
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  /**
   * One key per checkout attempt, kept in the draft: a repeated submit, or a retry after a reload
   * when the first answer was lost, returns the same server group (§6.5).
   */
  const [attemptKey, setAttemptKey] = useState<string | null>(() => saved?.idempotencyKey ?? null)
  const topRef = useRef<HTMLDivElement>(null)
  const [placeError, setPlaceError] = useState<string | null>(null)

  // The delivery city: the address's once the shopper has given it, else the one chosen on a
  // product page (it decides store pickup). The quote follows it.
  const quoteCity = step >= 2 && address.city.trim() ? address.city.trim().slice(0, 60) : shipToCity
  const quote = useShippingQuote(lines, country, quoteCity, currency)
  const methodFor = (brandId: string): ShippingMethod => shipping[brandId] ?? "standard"
  const bag = useMemo(() => priceCart(lines, country, currency, quote.quotes, (b) => shipping[b]), [lines, country, currency, quote.quotes, shipping])
  const totals: CheckoutTotals = { subtotal: bag.subtotal, shipping: bag.shipping, total: bag.total, count: bagCount(lines) }
  const quoteFailed = !quote.isLoading && !!quote.error && !quote.quotes
  const shippingBlock = quote.isLoading && !quote.quotes
    ? "Shipping is still being calculated."
    : quoteFailed
      ? "Couldn't calculate shipping. Retry to continue."
      : bag.blocked.length
        ? `${bag.blocked[0].brand.name} doesn't ship to ${countries[country].name}. Remove its pieces or change the delivery country.`
        : bag.shipping === null
          ? "Shipping isn't ready for every brand yet."
          : null

  const methods = paymentMethodsFor(country)
  const method: PaymentMethod = methods.includes(payment.method) ? payment.method : methods[0]

  const stepErrors: FieldErrors[] = [validateContact(contact, country), validateAddress(address, country), {}, validatePayment(payment, method, country), {}]
  const isValid = (i: number) => Object.keys(stepErrors[i]).length === 0
  const shownErrors = attempted[step] ? stepErrors[step] : Object.fromEntries(Object.entries(stepErrors[step]).filter(([id]) => touched[id]))
  const cardCleared = !!saved && saved.furthest >= 3 && saved.payment.method === "card" && !payment.cardNumber

  const doneRef = useRef(false)
  useEffect(() => {
    if (doneRef.current) return
    // Card number, expiry and security code stay in memory only.
    const keep = { method: payment.method, cardName: payment.cardName, ussdBank: payment.ussdBank, momoNetwork: payment.momoNetwork, momoNumber: payment.momoNumber }
    writeCheckoutDraft({ owner: userEmail, step, furthest, contact, address, shipping, payment: keep, idempotencyKey: attemptKey ?? undefined })
  }, [userEmail, step, furthest, contact, address, shipping, payment, attemptKey])

  function onFieldBlur(e: React.FocusEvent<HTMLFormElement>) {
    const t = e.target
    if (t instanceof HTMLInputElement && t.id && t.value.trim() && !touched[t.id]) setTouched((x) => ({ ...x, [t.id]: true }))
  }

  useEffect(() => {
    if (!navigated) return
    const top = topRef.current?.getBoundingClientRect().top ?? 0
    if (top < 80) window.scrollTo({ top: window.scrollY + top - 112, behavior: reduceMotion ? "auto" : "smooth" })
  }, [step, navigated, reduceMotion])

  function goTo(next: number) {
    setDir(next > step ? 1 : -1)
    setStep(next)
    setFurthest((f) => Math.max(f, next))
    setNavigated(true)
  }

  function focusFirstError(errors: FieldErrors) {
    const first = Object.keys(errors)[0]
    if (first) window.requestAnimationFrame(() => document.getElementById(first)?.focus())
  }

  function showErrors(i: number) {
    setAttempted((a) => ({ ...a, [i]: true }))
  }

  function continueFrom(i: number) {
    // Shipping: every brand needs an option before the shopper moves on (the button says why not).
    if (i === 2 && shippingBlock) return
    if (!isValid(i)) {
      showErrors(i)
      focusFirstError(stepErrors[i])
      return
    }
    if (reviewing) {
      const firstInvalid = stepErrors.findIndex((e, n) => n < REVIEW && Object.keys(e).length > 0)
      if (firstInvalid !== -1) {
        showErrors(firstInvalid)
        goTo(firstInvalid)
        return
      }
      setReviewing(false)
      goTo(REVIEW)
      return
    }
    goTo(i + 1)
  }

  function edit(i: number) {
    setReviewing(true)
    goTo(i)
  }

  const canJump = (i: number) => i < step || (i <= furthest && stepErrors.slice(0, i).every((e) => Object.keys(e).length === 0))

  function changeCountry(c: CountryCode) {
    if (c === country) return
    setShipTo(c)
    setAddress((a) => ({ ...a, region: "", postcode: "" }))
  }

  function changeMethod(m: PaymentMethod) {
    setPayment((p) => ({ ...p, method: m, momoNumber: m === "mobile_money" && !p.momoNumber ? contact.phone : p.momoNumber }))
    // A newly shown method starts without errors; they appear again on the next continue.
    setAttempted((a) => ({ ...a, 3: false }))
  }

  // No payment provider is connected: the server registers the orders unpaid, and the local orders
  // take its ids. The in-flight guard blocks a second submit while this runs, and the idempotency
  // key makes any repeat (here or after a reload) return the same checkout group.
  const submit = useAsyncAction(
    () => {
      const key = attemptKey ?? globalThis.crypto?.randomUUID?.() ?? `ck_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
      if (!attemptKey) setAttemptKey(key)
      setPlaceError(null)
      const phone = parsePhone(contact.phone, country) ?? contact.phone.trim()
      const digits = payment.cardNumber.replace(/\D/g, "")
      return placeCheckout({
        idempotencyKey: key,
        lines,
        currency,
        shipTo: country,
        shipToCity: quoteCity,
        contact: { name: contact.name.trim(), email: contact.email.trim(), phone },
        address: {
          line1: [address.line1.trim(), address.line2.trim()].filter(Boolean).join(", "),
          city: cityLine(address.city, address.region),
          postcode: address.postcode.trim().toUpperCase() || undefined,
          country,
        },
        shipping: Object.fromEntries(bag.groups.map((g) => [g.brand.id, g.option?.service ?? methodFor(g.brand.id)])),
        quotes: quote.quotes ?? {},
        paymentMethod: method,
        payment: {
          label: paymentSummary(payment, method, country),
          holder: method === "card" ? payment.cardName.trim() || contact.name.trim() : contact.name.trim(),
          cardBrand: method === "card" ? (cardBrand(digits) ?? undefined) : undefined,
          last4: method === "card" && digits.length >= 4 ? digits.slice(-4) : undefined,
        },
      })
    },
    {
      errorToast: false,
      onError: (e) => {
        const message = e instanceof CheckoutError ? e.message : "Your order wasn't placed. Nothing was charged. Try again."
        setPlaceError(message)
        if (e instanceof CheckoutError && e.kind === "changed") quote.retry()
        if (e instanceof CheckoutError && e.kind === "signin") {
          toast.error(message)
          useSession.setState({ authPrompt: { intent: "checkout" } })
        }
      },
      onSuccess: ({ groupId }) => {
        doneRef.current = true
        onPlaced(groupId)
      },
    },
  )
  const submitting = submit.pending

  function placeOrder() {
    if (submitting || shippingBlock) return
    const firstInvalid = stepErrors.findIndex((e) => Object.keys(e).length > 0)
    if (firstInvalid !== -1) {
      showErrors(firstInvalid)
      setReviewing(true)
      goTo(firstInvalid)
      return
    }
    void submit.run()
  }

  const current = checkoutSteps[step]
  const summaryProps = { groups: bag.groups, totals, currency, shipTo: country, methodFor, quote }

  return (
    // The summary starts level with the title, so its height cap (viewport minus the
    // header) keeps the total on screen before and after it sticks.
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start xl:gap-16">
      <div className="min-w-0">
        <CheckoutTitle />
        <div ref={topRef} className="mt-8 md:mt-10">
          <StepIndicator current={step} canJump={canJump} onJump={goTo} />
        </div>
        <div className="mt-6 lg:hidden">
          <OrderSummaryDisclosure {...summaryProps} />
        </div>

        <div className="relative mt-8 md:mt-10">
          <AnimatePresence mode="wait" initial={false} custom={dir}>
            <motion.div
              key={step}
              custom={dir}
              variants={slide}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: duration.page, ease: ease.out }}
            >
              <form
                noValidate
                aria-labelledby={`step-title-${step}`}
                onBlur={onFieldBlur}
                onSubmit={(e) => {
                  e.preventDefault()
                  if (step === REVIEW) placeOrder()
                  else continueFrom(step)
                }}
              >
                <StepHeading index={step} title={current.title} description={current.description} focus={navigated} />

                <div className="mt-6">
                  {step === 0 ? (
                    <ContactStep value={contact} onChange={setContact} errors={shownErrors} country={country} />
                  ) : step === 1 ? (
                    <AddressStep value={address} onChange={setAddress} errors={shownErrors} country={country} onCountryChange={changeCountry} />
                  ) : step === 2 ? (
                    <ShippingStep
                      groups={bag.groups}
                      currency={currency}
                      country={country}
                      onChange={(b, m) => setShipping((s) => ({ ...s, [b]: m }))}
                      quote={quote}
                      onRemoveBrand={(b) => bag.groups.find((g) => g.brand.id === b)?.lines.forEach((l) => removeLine(l.variant.id))}
                    />
                  ) : step === 3 ? (
                    <PaymentStep value={payment} method={method} methods={methods} onChange={setPayment} onMethodChange={changeMethod} errors={shownErrors} country={country} cardCleared={cardCleared} />
                  ) : (
                    <ReviewStep contact={contact} address={address} payment={payment} method={method} groups={bag.groups} currency={currency} country={country} methodFor={methodFor} onEdit={edit} />
                  )}
                </div>

                {attempted[step] && Object.keys(shownErrors).length > 0 ? (
                  <p role="alert" className="mt-5 text-sm text-danger">
                    {Object.keys(shownErrors).length === 1 ? "One field needs attention." : `${Object.keys(shownErrors).length} fields need attention.`}
                  </p>
                ) : null}

                {step === REVIEW ? (
                  <div className="mt-6 grid gap-4">
                    {placeError ? (
                      <div role="alert" className="flex items-start gap-3 rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm text-ink">
                        <WarningCircleIcon className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
                        <span>{placeError}</span>
                      </div>
                    ) : null}
                    <Notice icon={Package}>
                      {bag.groups.length === 1
                        ? `Placing this order creates one order with ${bag.groups[0].brand.name}.`
                        : `Placing this order creates ${bag.groups.length} orders, one for each brand. Each ships and tracks separately.`}{" "}
                      No payment provider is connected in this development build, so nothing is charged and the orders are recorded as awaiting payment confirmation.
                    </Notice>
                    <div className="flex items-baseline justify-between gap-4 border-t border-line-soft pt-4">
                      <span className="text-base text-ink">{totals.total === null ? "Subtotal" : "Total to pay"}</span>
                      <Price amount={totals.total ?? totals.subtotal} currency={currency} size="lg" />
                    </div>
                  </div>
                ) : null}

                {(step === 2 || step === REVIEW) && shippingBlock ? (
                  <p id="ship-block-reason" role="status" className="mt-5 text-sm text-ink-2">
                    {shippingBlock}
                  </p>
                ) : null}
                {/* Phones: the step's actions stay within reach at the foot of the screen. */}
                <div className="sticky bottom-0 z-10 -mx-4 mt-8 flex items-center gap-3 border-t border-line-soft bg-obsidian/92 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl sm:static sm:mx-0 sm:justify-between sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
                  {step === 0 ? (
                    <Button asChild variant="secondary" size="lg">
                      <Link href="/bag">Back to bag</Link>
                    </Button>
                  ) : (
                    <Button type="button" variant="secondary" size="lg" onClick={() => goTo(step - 1)} disabled={submitting}>
                      Back
                    </Button>
                  )}
                  {step === REVIEW ? (
                    <Button type="submit" variant="primary" size="xl" loading={submitting} disabled={!!shippingBlock && !submitting} aria-describedby={shippingBlock ? "ship-block-reason" : undefined} className="h-12 flex-1 sm:h-14 sm:min-w-64 sm:flex-none">
                      Place order
                    </Button>
                  ) : (
                    <Button type="submit" variant="primary" size="lg" disabled={step === 2 && !!shippingBlock} aria-describedby={step === 2 && shippingBlock ? "ship-block-reason" : undefined} className="flex-1 sm:min-w-56 sm:flex-none">
                      {reviewing ? "Save and review" : nextLabel[step]}
                    </Button>
                  )}
                </div>
              </form>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <OrderSummaryAside {...summaryProps} />
    </div>
  )
}

/**
 * Where a restored draft picks up: the step the shopper was on, or the first earlier step
 * that no longer validates (card details are never kept, so a card payment reopens Payment).
 */
function resumeStep(saved: ReturnType<typeof readCheckoutDraft>, country: CountryCode) {
  if (!saved) return 0
  const payment: PaymentDraft = { ...saved.payment, cardNumber: "", expiry: "", cvc: "" }
  const method = paymentMethodsFor(country).includes(payment.method) ? payment.method : paymentMethodsFor(country)[0]
  const errors = [validateContact(saved.contact, country), validateAddress(saved.address, country), {}, validatePayment(payment, method, country)]
  const firstInvalid = errors.findIndex((e) => Object.keys(e).length > 0)
  const target = Math.min(saved.step, REVIEW)
  return firstInvalid === -1 ? target : Math.min(target, firstInvalid)
}

function StepHeading({ index, title, description, focus }: { index: number; title: string; description: string; focus: boolean }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (focus) ref.current?.focus({ preventScroll: true })
  }, [focus])
  return (
    <div>
      <p className="text-xs text-violet tabular">
        Step {index + 1} of {checkoutSteps.length}
      </p>
      <h2 ref={ref} id={`step-title-${index}`} tabIndex={-1} className="mt-2 font-display text-display-sm text-ink outline-none">
        {title}
      </h2>
      <p className="mt-2 text-sm text-ink-2">{description}</p>
    </div>
  )
}
