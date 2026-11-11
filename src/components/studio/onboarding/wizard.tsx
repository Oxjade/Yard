"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { AnimatePresence, motion } from "motion/react"
import { ArrowLeftIcon as ArrowLeft, ArrowRightIcon as ArrowRight, CheckIcon as Check, EyeIcon as Eye, ArrowCounterClockwiseIcon as RotateCcw, XIcon as X } from "@phosphor-icons/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/dashboard/page-header"
import { site } from "@/config/site"
import { useAsyncAction } from "@/hooks/use-async-action"
import { errorMessage, ApiError } from "@/lib/api/errors"
import { cn } from "@/lib/utils"
import { useFocusReturn } from "@/components/studio/business/shared"
import { STEP_FORM_ID } from "./step-form"
import { StorefrontPreview } from "./storefront-preview"
import { discardOnboarding as discardOnboardingRequest } from "./remote"
import { reloadOnboarding, saveOnboardingProgress, STEPS, submitOnboardingProgress, useOnboarding, useOnboardingHydrated } from "./store"
import { stepComplete } from "./validation"
import { AccountStep } from "./steps/account"
import { BrandStep } from "./steps/brand"
import { StorefrontStep } from "./steps/storefront"
import { BusinessStep } from "./steps/business"
import { ProductStep } from "./steps/product"
import { PaymentsStep } from "./steps/payments"
import { PublishStep } from "./steps/publish"

const stepComponents = [AccountStep, BrandStep, StorefrontStep, BusinessStep, ProductStep, PaymentsStep, PublishStep]
const LAST = STEPS.length - 1

const variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 28 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -28 }),
}

function minutesLeft(step: number) {
  const m = STEPS.slice(step).reduce((n, s) => n + s.minutes, 0)
  return m <= 1 ? "about a minute left" : `about ${Math.round(m)} minutes left`
}

const WIDE = "(min-width: 1024px)"

/**
 * Whether the side preview has room (lg and up). The wizard only renders after the saved
 * progress loads on the client, so this never disagrees with server HTML. Rendering the
 * aside only when it shows keeps phones from loading a second copy of every preview image.
 */
function useWide() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(WIDE)
      m.addEventListener("change", cb)
      return () => m.removeEventListener("change", cb)
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  )
}

/** Merchant onboarding: seven short steps from account to a published storefront. */
export function OnboardingWizard() {
  const hydrated = useOnboardingHydrated()
  const publishedAt = useOnboarding((s) => s.publishedAt)
  const loadError = useOnboarding((s) => s.loadError)
  if (!hydrated) return <WizardSkeleton />
  if (loadError) return <OnboardingLoadError message={loadError} onRetry={() => void reloadOnboarding()} />
  if (publishedAt) return <Published />
  return <Wizard />
}

function showOnboardingError(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    toast.error(error.message, { action: { label: "Reload", onClick: () => void reloadOnboarding() } })
    return
  }
  const details = error instanceof ApiError && error.fields ? Object.values(error.fields).join(" ") : undefined
  toast.error(errorMessage(error), details ? { description: details } : undefined)
}

function Wizard() {
  const step = useOnboarding((s) => s.step)
  const maxReached = useOnboarding((s) => s.maxReached)
  const data = useOnboarding((s) => s.data)
  const reviewNote = useOnboarding((s) => s.reviewNote)
  // A draft that already created a brand (rejected, then edited) can't be cleared: the server refuses.
  const canStartOver = useOnboarding((s) => s.status === "draft" && !s.brandId)
  const next = useOnboarding((s) => s.next)
  const back = useOnboarding((s) => s.back)
  const anything = maxReached > 0 || !!data.account.email
  const wide = useWide()

  const save = useAsyncAction(async () => {
    const saved = await saveOnboardingProgress(STEPS[step].id)
    // Signing in on the account step loads the saved application, which moves to its first
    // unfinished step; stay there rather than skipping one.
    if (saved && useOnboarding.getState().step === step) next()
    else if (saved) return
    else toast.message("Your latest edit is not saved yet", { description: "Try Continue again to include it." })
  }, { errorToast: false, onError: showOnboardingError })
  const publish = useAsyncAction(() => submitOnboardingProgress(), {
    success: "Application submitted",
    errorToast: false,
    onError: showOnboardingError,
  })
  const publishing = publish.pending || save.pending
  const [previewOpen, setPreviewOpen] = useState(false)
  const previewFocus = useFocusReturn()
  const [resumed, setResumed] = useState(() => step > 0)
  // Direction of travel, adjusted while rendering when the step changes (so the exit animation knows it).
  const [nav, setNav] = useState({ step, dir: 1, moved: false })
  if (nav.step !== step) {
    setNav({ step, dir: step > nav.step ? 1 : -1, moved: true })
    setResumed(false)
  }
  const dir = nav.dir
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (nav.moved) window.scrollTo({ top: 0, behavior: "smooth" })
  }, [step, nav.moved])

  const meta = STEPS[step]
  const Current = stepComponents[step]
  const isPublish = step === LAST
  const showPreview = !isPublish

  function onNext() {
    if (isPublish) void publish.run()
    else void save.run()
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pt-6 pb-28 md:px-8 md:pt-10 lg:pb-20">
      {reviewNote ? (
        <div role="status" className="mb-6 rounded-md border border-line-soft bg-surface/50 p-4 text-sm">
          <p className="font-medium text-ink">Yard asked for changes</p>
          <p className="mt-1 break-words leading-relaxed text-ink-2">{reviewNote}</p>
        </div>
      ) : null}
      {resumed ? <ResumeNote onDismiss={() => setResumed(false)} step={step} /> : null}
      <div className={cn("grid gap-6", isPublish ? "xl:grid-cols-[200px_minmax(0,1fr)]" : "lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[200px_minmax(0,1fr)_380px]")}>
        <StepNav step={step} maxReached={maxReached} className="hidden xl:block" />

        <div className="min-w-0">
          <AnimatePresence mode="wait" initial={false} custom={dir}>
            <motion.div
              key={step}
              ref={container}
              custom={dir}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              onAnimationComplete={(def) => {
                if (def === "center" && nav.moved) container.current?.focus({ preventScroll: true })
              }}
              tabIndex={-1}
              aria-labelledby="ob-step-title"
              className="grid grid-cols-1 gap-6 outline-none"
            >
              <div>
                <PageHeader
                  title={meta.title}
                  description={meta.description}
                  actions={
                    (showPreview && step > 0) || anything ? (
                      <>
                        {showPreview && step > 0 ? (
                          <Button type="button" variant="secondary" size="sm" className="lg:hidden" onClick={() => setPreviewOpen(true)}>
                            <Eye /> Preview storefront
                          </Button>
                        ) : null}
                        {/* The step list holds Start over from xl; below that it lives here. */}
                        {anything && canStartOver ? <StartOver size="sm" className="xl:hidden" /> : null}
                      </>
                    ) : null
                  }
                >
                  <p className="mt-2 text-xs text-ink-3">
                    <span className="text-ink-2 tabular">Step {step + 1} of {STEPS.length}</span>, {minutesLeft(step)}
                  </p>
                </PageHeader>
                <span id="ob-step-title" className="sr-only">Step {step + 1} of {STEPS.length}: {meta.title}</span>
              </div>
              <Current onNext={onNext} />
            </motion.div>
          </AnimatePresence>

          <WizardFooter step={step} publishing={publishing} onBack={back} />
        </div>

        {showPreview && wide ? (
          <aside aria-labelledby="ob-aside-preview-title" className="hidden lg:block">
            <div className="sticky top-24">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 id="ob-aside-preview-title" className="text-sm font-medium text-ink">Storefront preview</h2>
                <p className="text-xs text-ink-3">{step === 0 ? "Fills in as you go" : "Updates as you type"}</p>
              </div>
              <StorefrontPreview data={data} eager />
            </div>
          </aside>
        ) : null}
      </div>

      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetContent side="bottom" className="max-h-[88dvh] gap-0 overflow-y-auto rounded-t-2xl border-white/10 pb-[max(1rem,env(safe-area-inset-bottom))]" {...previewFocus}>
          <SheetHeader className="pr-12">
            <SheetTitle>Storefront preview</SheetTitle>
            <SheetDescription>How shoppers will see your storefront so far.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-2">
            <StorefrontPreview data={data} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function WizardFooter({ step, publishing, onBack }: { step: number; publishing: boolean; onBack: () => void }) {
  const isPublish = step === LAST
  // The last step sends the application to the platform team; nothing goes live from here.
  const label = isPublish ? "Submit for review" : step === LAST - 1 ? "Review" : "Continue"
  return (
    // Phones: the family's floating glass action bar. Desktop: a plain row under the step.
    <div className="glass-strong fixed inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-30 flex items-center gap-2 rounded-2xl p-2 lg:static lg:z-auto lg:mt-6 lg:rounded-none lg:border-x-0 lg:border-b-0 lg:border-line-soft lg:bg-transparent lg:p-0 lg:pt-4 lg:shadow-none lg:backdrop-filter-none">
      {step === 0 ? (
        <Button asChild variant="secondary" size="sm" className="shrink-0">
          <Link href="/"><ArrowLeft /> <span className="max-sm:sr-only">Back to {site.name}</span></Link>
        </Button>
      ) : (
        <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={onBack} disabled={publishing}>
          <ArrowLeft /> <span className="max-sm:sr-only">Back</span>
        </Button>
      )}
      <p className="hidden flex-1 items-center gap-1.5 text-xs text-ink-3 lg:flex">
        <Check className="size-3.5" aria-hidden /> Saved on this device as you go
      </p>
      <Button type="submit" form={STEP_FORM_ID} variant="primary" size="sm" className="flex-1 lg:flex-none" loading={publishing}>
        {label} {isPublish ? null : <ArrowRight />}
      </Button>
    </div>
  )
}

function StepNav({ step, maxReached, className }: { step: number; maxReached: number; className?: string }) {
  const goTo = useOnboarding((s) => s.goTo)
  const data = useOnboarding((s) => s.data)
  // A draft that already created a brand (rejected, then edited) can't be cleared: the server refuses.
  const canStartOver = useOnboarding((s) => s.status === "draft" && !s.brandId)
  const done = stepComplete(data)
  const anything = maxReached > 0 || !!data.account.email
  return (
    <div className={className}>
      <nav aria-label="Setup steps" className="sticky top-24">
        <ol className="grid gap-0.5">
          {STEPS.map((s, i) => {
            const current = i === step
            const reachable = i <= maxReached
            const complete = s.id !== "publish" && done[s.id as keyof typeof done] && i < maxReached
            return (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={!reachable}
                  onClick={() => goTo(i)}
                  aria-current={current ? "step" : undefined}
                  className={cn(
                    "relative flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-left text-sm transition-colors disabled:cursor-default",
                    current ? "bg-purple/14 text-ink" : reachable ? "text-ink-2 hover:bg-white/4 hover:text-ink" : "text-ink-3",
                  )}
                >
                  {current ? <motion.span layoutId="ob-step-active" className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-purple" /> : null}
                  <span
                    className={cn(
                      "inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] tabular",
                      complete ? "border-violet/40 bg-purple/20 text-violet" : current ? "border-violet text-ink" : "border-line text-ink-3",
                    )}
                  >
                    {complete ? <Check className="size-3" aria-hidden /> : i + 1}
                  </span>
                  <span className="truncate">{s.label}</span>
                  {complete ? <span className="sr-only">, done</span> : null}
                </button>
              </li>
            )
          })}
        </ol>
        <p className="mt-4 px-2.5 text-xs text-ink-3">About 5 minutes in total. You can leave and come back.</p>
        {anything && canStartOver ? <StartOver size="xs" className="mt-2 ml-0.5" /> : null}
      </nav>
    </div>
  )
}

function StartOver({ className, variant = "ghost", size = "xs", label = "Start over" }: { className?: string; variant?: "ghost" | "secondary"; size?: "xs" | "sm" | "default"; label?: string }) {
  const reset = useOnboarding((s) => s.reset)
  const [open, setOpen] = useState(false)
  const discard = useAsyncAction(async () => {
    await discardOnboardingRequest()
    reset()
    setOpen(false)
  }, { errorToast: false, onError: showOnboardingError })
  // After clearing, step 1's first field takes focus (the button that opened this is gone).
  const focus = useFocusReturn(() => document.querySelector<HTMLElement>(`#${STEP_FORM_ID} input, #${STEP_FORM_ID} button`))
  return (
    <>
      <Button type="button" variant={variant} size={size} className={className} onClick={() => setOpen(true)}>
        <RotateCcw /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[420px]" {...focus}>
          <DialogHeader>
            <DialogTitle>Start over?</DialogTitle>
            <DialogDescription>This clears your saved draft and uploaded photos. You stay signed in.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary" disabled={discard.pending}>Keep my progress</Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              loading={discard.pending}
              onClick={() => void discard.run()}
            >
              Clear and start over
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ResumeNote({ step, onDismiss }: { step: number; onDismiss: () => void }) {
  return (
    <div role="status" className="mb-6 flex items-start gap-3 rounded-lg border border-violet/25 bg-purple/8 p-3">
      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-violet" aria-hidden />
      <p className="min-w-0 flex-1 py-0.5 text-sm text-ink">Welcome back. Everything you entered is still here, so you’re picking up at step {step + 1}.</p>
      <Button type="button" variant="ghost" size="icon-xs" className="shrink-0" aria-label="Dismiss" onClick={onDismiss}>
        <X />
      </Button>
    </div>
  )
}

function Published() {
  const brand = useOnboarding((s) => s.data.brand)
  const approved = useOnboarding((s) => s.status === "approved")
  const name = brand.name || "Your brand"
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-16 md:py-24">
      <section aria-labelledby="ob-submitted-title" className="rounded-lg border border-line-soft bg-card p-6 text-center md:p-8">
        <span className="mx-auto inline-flex size-14 items-center justify-center rounded-full border border-violet/40 bg-purple/15">
          <Check weight="bold" className="size-6 text-violet" aria-hidden />
        </span>
        <h1 id="ob-submitted-title" className="mt-5 text-lg font-medium text-ink">{approved ? "Your brand is approved" : "Your storefront is submitted for review"}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-2">
          {approved ? (
            <>
              {name} is approved. Publish your storefront and products from Brand Studio to go live at <span className="text-ink">/brands/{brand.handle}</span>.
            </>
          ) : (
            <>
              {name} is with the Yard team. Once it&apos;s approved, your store can go live at <span className="text-ink">/brands/{brand.handle}</span>. Your application is saved to your account.
            </>
          )}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button asChild variant="primary">
            <Link href="/studio">Go to Brand Studio</Link>
          </Button>
        </div>
      </section>
    </div>
  )
}

function OnboardingLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto grid min-h-[50vh] w-full max-w-xl content-center gap-3 px-4 py-12">
      <h1 className="text-base font-medium text-ink">Your saved progress could not load</h1>
      <p role="alert" className="text-sm text-ink-2">{message}</p>
      <Button type="button" variant="secondary" className="w-fit" onClick={onRetry}>Retry</Button>
    </div>
  )
}

/** Also the route's loading state, so the first paint and the saved-progress wait look the same. */
export function WizardSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pt-6 pb-28 md:px-8 md:pt-10" aria-busy="true" aria-label="Loading your setup">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[200px_minmax(0,1fr)_380px]">
        <div className="hidden gap-2 xl:grid xl:content-start">
          {STEPS.map((s) => <Skeleton key={s.id} className="h-9 rounded-md bg-card" />)}
        </div>
        <div className="grid content-start gap-6">
          <div className="grid gap-2 border-b border-line-soft pb-5">
            <Skeleton className="h-8 w-2/3 bg-card" />
            <Skeleton className="h-4 w-full max-w-md bg-card" />
            <Skeleton className="h-3 w-40 bg-card" />
          </div>
          <Skeleton className="h-72 rounded-lg bg-card" />
          <Skeleton className="h-40 rounded-lg bg-card" />
        </div>
        <Skeleton className="hidden h-[520px] rounded-lg bg-card lg:block" />
      </div>
    </div>
  )
}
