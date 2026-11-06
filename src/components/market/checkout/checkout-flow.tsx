"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CircleNotchIcon as Loader2, PackageIcon as Package } from "@phosphor-icons/react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { AuthPanel } from "@/components/market/account/auth-panel"
import { AuthForm } from "@/components/market/auth-prompt"
import { Price } from "@/components/market/price"
import { Button } from "@/components/ui/button"
import { type CountryCode } from "@/config/markets"
import { useAsyncAction } from "@/hooks/use-async-action"
import { priceCart } from "@/lib/cart"
import { img } from "@/lib/data/media"
import { productById } from "@/lib/data/products"
import { useCart } from "@/lib/stores/cart"
import { useOrders } from "@/lib/stores/orders"
import { useSession } from "@/lib/stores/session"
import { Notice } from "./fields"
import { OrderSummaryAside, OrderSummaryDisclosure, type CheckoutTotals } from "./order-summary"
import {
  cityLine,
  parsePhone,
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
import { checkoutSteps, StepIndicator } from "./step-indicator"
import { AddressStep, ContactStep, PaymentStep, ReviewStep, ShippingStep } from "./steps"
import { shippingPrice, type ShippingMethod } from "./shipping"
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
  const empty = ready && lines.length === 0

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
    setPlaced(true)
    router.push(`/checkout/confirmation?group=${encodeURIComponent(groupId)}`)
    clear()
  }

  if (ready && !empty && !user && !placed) {
    const first = productById.get(lines[0].productId)
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

  return (
    <>
      <CheckoutTitle />
      {placed ? (
        <div role="status" className="mt-10 flex items-center gap-3 rounded-lg border border-line-soft bg-card px-5 py-6 text-sm text-ink-2">
          <Loader2 className="size-4 animate-spin text-violet" aria-hidden />
          Order placed. Opening your confirmation.
        </div>
      ) : (
        <CheckoutSkeleton />
      )}
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
  const setShipTo = useSession((s) => s.setShipTo)
  const placeCheckout = useOrders((s) => s.placeCheckout)
  const reduceMotion = useReducedMotion()

  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const [furthest, setFurthest] = useState(0)
  const [reviewing, setReviewing] = useState(false)
  const [navigated, setNavigated] = useState(false)
  const [attempted, setAttempted] = useState<Record<number, boolean>>({})
  const [contact, setContact] = useState<ContactDraft>({ name: userName, email: userEmail, phone: "" })
  const [address, setAddress] = useState<AddressDraft>({ line1: "", line2: "", city: "", region: "", postcode: "", landmark: "" })
  const [shipping, setShipping] = useState<Record<string, ShippingMethod>>({})
  const [payment, setPayment] = useState<PaymentDraft>({ method: "card", cardNumber: "", expiry: "", cvc: "", cardName: userName, ussdBank: "", momoNetwork: "", momoNumber: "" })
  /** One key per checkout attempt: a repeated submit returns the same checkout group. */
  const idempotencyKey = useRef<string | null>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const [today] = useState(() => new Date())

  const bag = useMemo(() => priceCart(lines, country, currency), [lines, country, currency])
  const methodFor = (brandId: string): ShippingMethod => shipping[brandId] ?? "standard"
  const shippingTotal = bag.groups.reduce((s, g) => s + shippingPrice(g, methodFor(g.brand.id)), 0)
  const totals: CheckoutTotals = { subtotal: bag.subtotal, shipping: shippingTotal, total: bag.subtotal + shippingTotal, count: bag.count }

  const methods = paymentMethodsFor(country)
  const method: PaymentMethod = methods.includes(payment.method) ? payment.method : methods[0]

  const stepErrors: FieldErrors[] = [validateContact(contact, country), validateAddress(address, country), {}, validatePayment(payment, method, country), {}]
  const isValid = (i: number) => Object.keys(stepErrors[i]).length === 0
  const shownErrors = attempted[step] ? stepErrors[step] : {}

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

  // Payments are simulated: placeCheckout records the orders unpaid, as the backend will
  // before the provider confirms. The in-flight guard blocks a second submit while this
  // runs, and the idempotency key makes any repeat return the same checkout group.
  const submit = useAsyncAction(
    () => {
      const key = (idempotencyKey.current ??= globalThis.crypto?.randomUUID?.() ?? `ck_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`)
      const phone = parsePhone(contact.phone, country) ?? contact.phone.trim()
      return placeCheckout({
        idempotencyKey: key,
        lines,
        currency,
        shipTo: country,
        contact: { name: contact.name.trim(), email: contact.email.trim(), phone },
        address: {
          line1: [address.line1.trim(), address.line2.trim()].filter(Boolean).join(", "),
          city: cityLine(address.city, address.region),
          postcode: address.postcode.trim().toUpperCase() || undefined,
          country,
        },
        shipping: Object.fromEntries(bag.groups.map((g) => [g.brand.id, methodFor(g.brand.id)])),
        paymentMethod: method,
      })
    },
    {
      error: "Your order wasn't placed. Nothing was charged. Try again.",
      onSuccess: ({ groupId }) => onPlaced(groupId),
    },
  )
  const submitting = submit.pending

  function placeOrder() {
    if (submitting) return
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
  const summaryProps = { groups: bag.groups, totals, currency, shipTo: country, methodFor }

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
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <form
                noValidate
                aria-labelledby={`step-title-${step}`}
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
                    <ShippingStep groups={bag.groups} currency={currency} country={country} methodFor={methodFor} onChange={(b, m) => setShipping((s) => ({ ...s, [b]: m }))} today={today} />
                  ) : step === 3 ? (
                    <PaymentStep value={payment} method={method} methods={methods} onChange={setPayment} onMethodChange={changeMethod} errors={shownErrors} country={country} />
                  ) : (
                    <ReviewStep contact={contact} address={address} payment={payment} method={method} groups={bag.groups} currency={currency} country={country} methodFor={methodFor} onEdit={edit} today={today} />
                  )}
                </div>

                {Object.keys(shownErrors).length > 0 ? (
                  <p role="alert" className="mt-5 text-sm text-danger">
                    {Object.keys(shownErrors).length === 1 ? "One field needs attention." : `${Object.keys(shownErrors).length} fields need attention.`}
                  </p>
                ) : null}

                {step === REVIEW ? (
                  <div className="mt-6 grid gap-4">
                    <Notice icon={Package}>
                      {bag.groups.length === 1
                        ? `Placing this order creates one order with ${bag.groups[0].brand.name}.`
                        : `Placing this order creates ${bag.groups.length} orders, one for each brand. Each ships and tracks separately.`}{" "}
                      Payments are simulated in this development build.
                    </Notice>
                    <div className="flex items-baseline justify-between gap-4 border-t border-line-soft pt-4">
                      <span className="text-base text-ink">Total to pay</span>
                      <Price amount={totals.total} currency={currency} size="lg" />
                    </div>
                  </div>
                ) : null}

                <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                    <Button type="submit" variant="primary" size="xl" loading={submitting} className="sm:min-w-64">
                      Place order
                    </Button>
                  ) : (
                    <Button type="submit" variant="primary" size="lg" className="sm:min-w-56">
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
