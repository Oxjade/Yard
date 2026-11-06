"use client"

import { useRouter } from "next/navigation"
import { motion } from "motion/react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Wordmark } from "@/components/market/market-header"
import { cn } from "@/lib/utils"
import { STEPS, useOnboarding, useOnboardingHydrated } from "./store"

/** The onboarding's only chrome: wordmark, progress and a way out that keeps your place. */
export function OnboardingTopBar() {
  const router = useRouter()
  const hydrated = useOnboardingHydrated()
  const step = useOnboarding((s) => s.step)
  const publishedAt = useOnboarding((s) => s.publishedAt)
  const markSaved = useOnboarding((s) => s.markSaved)
  const current = hydrated ? step : 0
  const total = STEPS.length

  function finishLater() {
    markSaved()
    toast.success("Progress saved", {
      description: `Everything is kept on this device. Pick up at step ${current + 1}, ${STEPS[current].label.toLowerCase()}, whenever you're ready.`,
      action: { label: "Resume", onClick: () => router.push("/studio/onboarding") },
    })
    router.push("/studio")
  }

  return (
    <header className="sticky top-0 z-40 border-b border-line-soft bg-obsidian/85 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 md:px-8">
        <Wordmark />
        <span className="hidden h-4 w-px bg-line sm:block" aria-hidden />
        <span className="hidden text-sm text-ink-2 sm:block">Brand setup</span>
        {/* The step counter lives in the page header; the bar below shows progress. Once published, the page's own action takes over. */}
        {publishedAt ? null : (
          <Button type="button" size="sm" variant="secondary" className="ml-auto" onClick={finishLater}>
            Save and finish later
          </Button>
        )}
      </div>
      <div
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={current + 1}
        aria-valuetext={`Step ${current + 1} of ${total}`}
        className="mx-auto flex max-w-[1400px] gap-1 px-4 pb-2 md:px-8"
      >
        {STEPS.map((s, i) => {
          const filled = publishedAt ? true : hydrated && i <= current
          return (
            <span key={s.id} className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-line">
              <motion.span
                className={cn("absolute inset-0 origin-left rounded-full", i < current || publishedAt ? "bg-violet" : "bg-purple")}
                initial={false}
                animate={{ scaleX: filled ? 1 : 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 32 }}
              />
            </span>
          )
        })}
      </div>
    </header>
  )
}
