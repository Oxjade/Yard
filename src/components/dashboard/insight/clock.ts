"use client"

import { useEffect } from "react"
import { cancelFrame, cubicBezier, frame, useMotionValue, useReducedMotion, type FrameData, type MotionValue } from "motion/react"
import { chartIn, countIn } from "@/lib/motion"

/** `countIn.ease` and `chartIn.ease` as functions of progress (0 to 1). */
export const countEase = cubicBezier(...countIn.ease)
export const chartEase = cubicBezier(...chartIn.ease)

/** Progress of an entrance that starts `delay` ms into a clock and lasts `ms`, from 0 to 1. */
export const progress = (t: number, ms: number, delay = 0) => (ms <= 0 ? 1 : Math.min(1, Math.max(0, (t - delay) / ms)))

/**
 * Plays `ms` of animation time from the next frame: `step(t)` runs on every frame with the
 * time played so far, then `done()` once it reaches `ms`. The first frame is always `from`
 * (0 by default), so the first thing painted is the start of the entrance. After that, each
 * frame advances by its own interval, which Motion's frame loop caps at 40ms. When the main
 * thread is busy (hydration, a long task), an entrance therefore waits rather than skipping
 * ahead, so what is painted always moves through the whole entrance. Returns a cancel function.
 *
 * "The next frame" is the first frame that begins after the call. A render committed from
 * inside one of Motion's own frame callbacks (as hydration can be) would otherwise take its
 * first step in that same, still unpainted frame, and the next frame would then jump ahead.
 */
export function play(ms: number, step: (t: number) => void, done?: () => void, from = 0) {
  let t: number | null = null
  const called = performance.now()
  const tick = ({ delta, timestamp }: FrameData) => {
    if (t === null && timestamp < called) return
    t = t === null ? Math.min(ms, from) : Math.min(ms, t + delta)
    step(t)
    if (t >= ms) {
      cancelFrame(tick)
      done?.()
    }
  }
  frame.update(tick, true)
  return () => cancelFrame(tick)
}

/**
 * The clock for a chart entrance, in ms: 0 until `run` (the chart has been seen), then it plays
 * to `ms` (see `play`) and stays there. Under reduced motion it starts at `ms`, so the chart is
 * drawn in full from its first render. Derive each mark's progress from it with useTransform.
 */
export function useEntranceClock(run: boolean, ms: number): MotionValue<number> {
  const reduce = useReducedMotion()
  const t = useMotionValue(reduce ? ms : 0)
  useEffect(() => {
    if (reduce) {
      t.set(ms)
      return
    }
    if (!run || t.get() >= ms) return
    return play(ms, (x) => t.set(x), undefined, t.get())
  }, [run, reduce, ms, t])
  return t
}
