"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowLeftIcon as ArrowLeft } from "@phosphor-icons/react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { toast } from "sonner"
import { BrandCard } from "@/components/market/brand-card"
import { Chip } from "@/components/market/catalog/chip"
import { Button } from "@/components/ui/button"
import { aestheticLabels, brands, categories, categoryBySlug, recommendBrands } from "@/lib/data"
import { duration, ease } from "@/lib/motion"
import { useSaved } from "@/lib/stores/saved"
import { useSession } from "@/lib/stores/session"
import { cn } from "@/lib/utils"
import type { Aesthetic, CategorySlug, ImageAsset } from "@/lib/data/types"
import { firstName, safeNext } from "./format"

const aestheticList = Object.keys(aestheticLabels) as Aesthetic[]

/** One photograph per look, taken from a brand that works in it. */
const aestheticImage = Object.fromEntries(
  aestheticList.map((a, i) => {
    const pool = brands.filter((b) => b.aesthetics.includes(a))
    return [a, (pool[i % Math.max(1, pool.length)] ?? brands[i % brands.length]).cover]
  }),
) as Record<Aesthetic, ImageAsset>

const steps = [
  { title: "What do you shop for?", body: "Pick as many as you like. We use them to order Discover and suggest brands." },
  { title: "Which looks feel like you?", body: "Looks cut across categories. Pick any that fit, or skip." },
  { title: "Brands to start with", body: "Picked from your answers. Follow a few and their new pieces, drops and stories fill your Following feed." },
]

/** The shared Chip, sized up for onboarding with a photograph at its start. */
const pickChip = "h-12 gap-2 pr-4 pl-1.5 text-[0.9375rem]"

function ChipImage({ image }: { image: ImageAsset }) {
  return (
    <span className="relative size-9 shrink-0 overflow-hidden rounded-full bg-card" aria-hidden>
      <Image src={image.src} alt="" fill sizes="36px" className="object-cover" />
    </span>
  )
}

function StepTitle({ focus, children }: { focus: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (focus) ref.current?.focus({ preventScroll: true })
  }, [focus])
  return (
    <h1 ref={ref} tabIndex={-1} className="font-display text-display-lg text-ink outline-none">
      {children}
    </h1>
  )
}

function toggle<T>(list: T[], v: T) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]
}

/** Customer onboarding: categories, looks, then brands to follow. Every step can be skipped. */
export function WelcomeFlow() {
  const router = useRouter()
  const params = useSearchParams()
  const nextParam = safeNext(params.get("next"), "/")
  const next = nextParam.startsWith("/welcome") || nextParam.startsWith("/sign-in") ? "/" : nextParam
  const user = useSession((s) => s.user)!
  const setInterests = useSession((s) => s.setInterests)
  const finishOnboarding = useSession((s) => s.finishOnboarding)
  const followingCount = useSaved((s) => s.following.length)

  const [step, setStep] = useState(0)
  const [dir, setDir] = useState(1)
  const [cats, setCats] = useState<CategorySlug[]>(() => useSession.getState().interests)
  const [looks, setLooks] = useState<Aesthetic[]>(() => useSession.getState().aesthetics)
  const [lastPick, setLastPick] = useState<{ key: string; label: string; image: ImageAsset } | null>(null)
  const [followedHere] = useState(() => useSaved.getState().following.length)

  // Suggestions are fixed when step 3 opens, so following a brand doesn't reshuffle the list.
  const suggestions = useMemo(() => {
    if (step !== 2) return []
    const following = useSaved.getState().following
    return recommendBrands({ interests: cats, following }, 12)
      .map((b, i) => ({ b, score: b.aesthetics.filter((a) => looks.includes(a)).length * 6 - i }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((s) => s.b)
  }, [step, cats, looks])

  const topRef = useRef<HTMLDivElement>(null)
  const [navigated, setNavigated] = useState(false)
  const reduceMotion = useReducedMotion()

  // After Back or Continue (often pressed at the foot of a long step), bring the new step
  // into view; its heading takes focus when it mounts (StepTitle) so the change is announced.
  useEffect(() => {
    if (!navigated) return
    const top = topRef.current?.getBoundingClientRect().top ?? 0
    if (top < 80) window.scrollTo({ top: window.scrollY + top - 112, behavior: reduceMotion ? "auto" : "smooth" })
  }, [step, navigated, reduceMotion])

  function go(to: number) {
    setNavigated(true)
    setDir(to > step ? 1 : -1)
    setStep(to)
  }

  function finish(save = true) {
    if (save) setInterests(cats, looks)
    finishOnboarding()
    const newFollows = useSaved.getState().following.length - followedHere
    toast(save ? "You're set" : "Setup skipped", {
      description: save
        ? `${cats.length + looks.length ? "Discover now leads with what you picked." : "Discover shows a bit of everything for now."}${newFollows > 0 ? ` Following ${newFollows} new ${newFollows === 1 ? "brand" : "brands"}.` : ""}`
        : "You can add interests any time in Settings.",
    })
    router.push(next)
  }

  // Skipping a step leaves that answer as it was before onboarding (empty for a new account).
  function skip() {
    if (step === 0) setCats(useSession.getState().interests)
    if (step === 1) setLooks(useSession.getState().aesthetics)
    if (step === 2) finish()
    else go(step + 1)
  }

  const picks = step === 0 ? cats.length : step === 1 ? looks.length : 0
  const fallback = categoryBySlug.get("streetwear")!.image
  const visual = lastPick ?? { key: "default", label: "Independent brands, found first", image: fallback }

  return (
    <div ref={topRef}>
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-violet">Welcome, {firstName(user.name)}</p>
        <button type="button" onClick={() => finish(false)} className="relative rounded-sm text-sm text-ink-2 underline-offset-4 transition-colors after:absolute after:-inset-x-2 after:-inset-y-2.5 hover:text-ink hover:underline">
          Skip setup
        </button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2" role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step + 1} aria-valuetext={`Step ${step + 1} of 3`}>
        {steps.map((s, i) => (
          <span key={s.title} className="h-1 overflow-hidden rounded-full bg-line">
            <motion.span className="block h-full origin-left rounded-full bg-violet" initial={false} animate={{ scaleX: i <= step ? 1 : 0 }} transition={{ duration: duration.drawer, ease: ease.out }} />
          </span>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-3 tabular">Step {step + 1} of 3, about a minute in all</p>

      <div className={cn("mt-10 grid gap-12", step < 2 && "lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_460px]")}>
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={step}
            custom={dir}
            initial={{ opacity: 0, x: 28 * dir }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -28 * dir }}
            transition={{ duration: duration.page, ease: ease.out }}
            className="min-w-0"
          >
            <StepTitle focus={navigated}>{steps[step].title}</StepTitle>
            <p className="mt-4 max-w-xl text-pretty text-[0.9375rem] leading-relaxed text-ink-2">{steps[step].body}</p>

            {step === 0 ? (
              <div className="mt-8 flex flex-wrap gap-2.5" role="group" aria-label="Categories">
                {categories.map((c) => (
                  <Chip
                    key={c.slug}
                    className={pickChip}
                    selected={cats.includes(c.slug)}
                    onClick={() => {
                      const on = !cats.includes(c.slug)
                      setCats(toggle(cats, c.slug))
                      if (on) setLastPick({ key: c.slug, label: c.name, image: c.image })
                    }}
                  >
                    <ChipImage image={c.image} />
                    {c.name}
                  </Chip>
                ))}
              </div>
            ) : step === 1 ? (
              <div className="mt-8 flex flex-wrap gap-2.5" role="group" aria-label="Looks">
                {aestheticList.map((a) => (
                  <Chip
                    key={a}
                    className={pickChip}
                    selected={looks.includes(a)}
                    onClick={() => {
                      const on = !looks.includes(a)
                      setLooks(toggle(looks, a))
                      if (on) setLastPick({ key: a, label: aestheticLabels[a], image: aestheticImage[a] })
                    }}
                  >
                    <ChipImage image={aestheticImage[a]} />
                    {aestheticLabels[a]}
                  </Chip>
                ))}
              </div>
            ) : (
              <>
                <div className="rail -mx-4 mt-8 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 *:w-[78vw] *:shrink-0 *:snap-start sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 sm:*:w-auto lg:grid-cols-3">
                  {suggestions.map((b) => (
                    <BrandCard key={b.id} brand={b} />
                  ))}
                </div>
                <p className="mt-4 text-sm text-ink-2" aria-live="polite">
                  {followingCount ? `Following ${followingCount} ${followingCount === 1 ? "brand" : "brands"}.` : "Not following anyone yet. You can always follow brands later."}
                </p>
              </>
            )}

            <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-line-soft pt-6">
              {step > 0 ? (
                <Button variant="secondary" size="lg" onClick={() => go(step - 1)}>
                  <ArrowLeft /> Back
                </Button>
              ) : null}
              {step < 2 && picks === 0 ? (
                <p id="welcome-continue-hint" className="text-xs text-ink-3">
                  Pick at least one to continue, or skip this step.
                </p>
              ) : null}
              <div className="ml-auto flex flex-wrap items-center gap-3">
                <Button variant="secondary" size="lg" onClick={skip}>
                  {step === 2 ? "Skip and finish" : "Skip"}
                </Button>
                {step < 2 ? (
                  <Button variant="primary" size="lg" disabled={picks === 0} aria-describedby={picks === 0 ? "welcome-continue-hint" : undefined} onClick={() => go(step + 1)}>
                    {picks ? `Continue with ${picks} ${picks === 1 ? "pick" : "picks"}` : "Continue"}
                  </Button>
                ) : (
                  <Button variant="primary" size="lg" onClick={() => finish()}>
                    {next === "/" ? "Finish and go to Discover" : "Finish"}
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>

        {step < 2 ? (
          <figure className="relative hidden aspect-[4/5] overflow-hidden rounded-lg bg-card lg:block">
            <AnimatePresence initial={false}>
              <motion.div key={visual.key} className="absolute inset-0" initial={{ opacity: 0, scale: 1.03 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: duration.chart, ease: ease.out }}>
                <Image src={visual.image.src} alt="" fill sizes="460px" className="object-cover" />
                <span className="scrim-b absolute inset-0" aria-hidden />
              </motion.div>
            </AnimatePresence>
            <figcaption className="absolute inset-x-5 bottom-5">
              <p className="font-display text-display-sm text-ink">{visual.label}</p>
              <p className="mt-2 text-xs text-ink-2 tabular">
                {/* This step's picks, the same number the Continue button carries. */}
                {picks ? `${picks} ${step === 0 ? (picks === 1 ? "category" : "categories") : picks === 1 ? "look" : "looks"} picked` : "Nothing picked yet"}
              </p>
            </figcaption>
          </figure>
        ) : null}
      </div>
    </div>
  )
}
