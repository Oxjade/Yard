"use client"

import { useCallback, useEffect, useLayoutEffect, useRef } from "react"
import { animate, motion, useInView, useMotionValue, useReducedMotion } from "motion/react"
import { counter, countIn } from "@/lib/motion"
import { countEase, play } from "./clock"

/* ── Figures: the number inside a formatted string ───────────────────────────────────────
 * A count is drawn in the final value's own shape: its prefix and suffix (currency symbol,
 * K/M, %, "+"), its decimal places and its digit grouping. So "₦3.5M" counts 0.0M, 0.4M …
 * 3.5M (never "₦999.9K" or "₦3.4999M"), "1.06%" counts with two decimals, and "₦1,582,700"
 * keeps its separators on every frame. Long figures count in round steps (planCount). */

export type Figure = {
  prefix: string
  suffix: string
  /** The number as displayed ("3.5" in "₦3.5M"). */
  n: number
  decimals: number
  decimal: string
  group: string
  /** Digits in the last group and in the ones before it (3 and 2 for "35,12,400"). */
  primary: number
  secondary: number
}

const spaceLike = /[   ']/

/** The single number inside `text`, or null when there is none (or more than one). */
export function parseFigure(text: string): Figure | null {
  const m = /\d(?:[\d.,   ']*\d)?/.exec(text)
  if (!m) return null
  const run = m[0]
  const prefix = text.slice(0, m.index)
  const suffix = text.slice(m.index + run.length)
  if (/\d/.test(prefix) || /\d/.test(suffix)) return null
  const seps = [...run.matchAll(/\D/g)].map((x) => ({ ch: x[0], at: x.index }))
  const kinds = new Set(seps.map((x) => x.ch))
  if (kinds.size > 2) return null
  let decimal = ""
  let group = ""
  if (seps.length) {
    const last = seps[seps.length - 1]
    const after = run.length - last.at - 1
    if (kinds.size === 2) {
      decimal = last.ch
      group = seps[0].ch
      if (seps.filter((x) => x.ch === decimal).length > 1) return null
    } else if (seps.length > 1 || spaceLike.test(last.ch) || after === 3) {
      // One kind of separator: repeated, a space, or followed by exactly three digits is
      // grouping ("18,484", "5.400 €"); otherwise it is the decimal point ("3.5", "3,5").
      group = last.ch
    } else {
      decimal = last.ch
    }
  }
  const cut = decimal ? run.lastIndexOf(decimal) : run.length
  const whole = run.slice(0, cut)
  const fraction = decimal ? run.slice(cut + 1) : ""
  const parts = group ? whole.split(group) : [whole]
  if (parts.some((p) => !/^\d+$/.test(p)) || (fraction && !/^\d+$/.test(fraction))) return null
  const primary = parts.length > 1 ? parts[parts.length - 1].length : 3
  const secondary = parts.length > 2 ? parts[parts.length - 2].length : primary
  return { prefix, suffix, n: Number(`${parts.join("")}.${fraction || "0"}`), decimals: fraction.length, decimal: decimal || ".", group, primary, secondary }
}

/** `n` drawn in the figure's shape. */
export function renderFigure(f: Figure, n: number) {
  const [whole, fraction] = Math.max(0, n).toFixed(f.decimals).split(".")
  let digits = whole
  if (f.group && whole.length > f.primary) {
    const chunks = [whole.slice(-f.primary)]
    let rest = whole.slice(0, -f.primary)
    while (rest.length > f.secondary) {
      chunks.unshift(rest.slice(-f.secondary))
      rest = rest.slice(0, -f.secondary)
    }
    if (rest) chunks.unshift(rest)
    digits = chunks.join(f.group)
  }
  return `${f.prefix}${digits}${fraction ? `${f.decimal}${fraction}` : ""}${f.suffix}`
}

const sameShape = (a: Figure, b: Figure) => a.prefix === b.prefix && a.suffix === b.suffix && a.decimals === b.decimals && a.decimal === b.decimal

/** `b`'s shape, grouped like `a` when only `a` is long enough to show its grouping ("1,887" to
    "441" passes "1,576", never "1576"). */
const grouped = (a: Figure, b: Figure): Figure => (b.group || !a.group ? b : { ...b, group: a.group, primary: a.primary, secondary: a.secondary })

/**
 * How the first count of `final` draws its frames: the text at eased progress q (0 to 1), or
 * null when the figure is shown as it is. Not counted: text with no single number ("5 of 6",
 * "None yet"), zero, and figures with one significant digit ("8", "5K", "₦1M"), where a count
 * only flickers through states the page never shows (a status reading "0 of 6" or a flip
 * from "₦0M"). Frames never pass the final value and never add digits it does not have: a
 * figure with five or more significant digits counts in steps of its third digit
 * ("₦10,299,000" by 100,000), and a round one in its own round steps ("25,000" by 1,000), so
 * the end of a count never ticks through units like a meter. A figure with a word in it
 * ("76 days") is drawn by the caller's own format when it has one, so "1 day" stays grammatical.
 */
export function planCount(final: string, raw: number | null, format?: (n: number) => string): ((q: number) => string) | null {
  const f = parseFigure(final)
  if (!f || f.n === 0) return null
  const [whole, fraction = ""] = f.n.toFixed(f.decimals).split(".")
  const digits = (whole + fraction).replace(/^0+/, "")
  if (digits.length < 2) return null
  const unit = 10 ** -f.decimals
  let step = unit
  if (whole.length >= 4) {
    const significant = digits.replace(/0+$/, "").length
    const zeros = whole.length - whole.replace(/0+$/, "").length
    if (significant >= 5) step = Math.max(unit, 10 ** (whole.length - 3))
    else if (!fraction && zeros) step = 10 ** Math.min(zeros, whole.length - 2)
  }
  const at = (q: number) => Math.min(f.n, Math.floor((f.n * q) / step + 1e-6) * step)
  if (format && raw === f.n && /[a-z]{2,}/i.test(f.prefix + f.suffix)) return (q) => format(at(q))
  return (q) => renderFigure(f, at(q))
}

/** Keys that already counted in this page session (`once`). Read and written in effects only. */
const counted = new Set<string>()

type Source = { value: number; format: (n: number) => string; text?: never } | { text: string; value?: never; format?: never }

/**
 * A metric number that counts up from zero the first time it appears (on load, or when it
 * first scrolls into view), then eases between values when the period changes.
 *
 * Pass a number and its `format`, or a preformatted `text` ("₦1,582,700", "21") whose number
 * is counted in its own shape; text that holds no single number is shown as it is, and so is
 * a figure with a single significant digit (see planCount).
 *
 * - `updates="instant"`: later changes snap to the new value, and the first count is shorter
 *   (`countIn.balance`). Use it for money balances, so a balance that changes after an action
 *   never looks like money moving.
 * - `once`: a key for a figure that is rendered again in other places (the sidebar's status
 *   card on the rail and in the phone drawer): it counts the first time only, page-wide.
 *
 * The first count runs on its own clock (clock.ts): it starts on the first frame after the
 * figure is revealed at zero and never skips ahead while the main thread is busy, so a page
 * that is still hydrating shows the whole count rather than its last tick.
 *
 * Hydration-safe: the server HTML and the hydrating render carry the final value; CSS
 * (globals.css, `[data-count="pending"]`) holds it back until the count starts, only when
 * scripting and motion are allowed. Without JavaScript, and under reduced motion, the final
 * value shows from the first paint and nothing counts. An invisible copy of the final value
 * holds the width, so whatever sits beside the number never slides; while a later change
 * eases, the holder also keeps the widest figure on the way, so a falling value never covers
 * what sits beside it. Screen readers get the final value, never the frames.
 */
export function CountUp({ updates = "ease", once, className, ...source }: Source & { updates?: "ease" | "instant"; once?: string; className?: string }) {
  const final = source.text ?? source.format(source.value)
  const raw = source.text === undefined ? source.value : null
  const reduce = useReducedMotion()
  const ref = useRef<HTMLSpanElement>(null)
  const live = useRef<HTMLSpanElement>(null)
  // Extra width while a later change eases (filled in by `hold`; React never renders into it).
  const holder = useRef<HTMLSpanElement>(null)
  // Any visible pixel starts it: a number must never sit blank beside its label.
  const inView = useInView(ref, { once: true })
  const display = useMotionValue(final)
  // Stops whatever is running: the first count or a later ease.
  const stop = useRef<(() => void) | null>(null)
  // The latest props, for effects that should not restart when an inline `format` changes identity.
  const latest = useRef({ final, raw, format: source.format })
  // Where the display is heading, and where it is right now (raw value in number mode,
  // displayed number in text mode).
  const target = useRef<{ final: string; raw: number | null } | null>(null)
  const at = useRef(0)

  useLayoutEffect(() => {
    latest.current = { final, raw, format: source.format }
  })

  useEffect(() => () => stop.current?.(), [])

  const isPending = () => live.current?.dataset.count === "pending"
  const reveal = () => {
    if (live.current) live.current.dataset.count = "live"
  }

  /* The first count, from zero. The zero frame is set before the number is revealed (both
     synchronously), so the final value never flashes first; the clock starts on the next
     frame. Returns an undo for an effect cleanup: a count interrupted before it settles (an
     unmount, or development's double-invoked effects) goes back to waiting, so the next mount
     counts it in full. */
  const begin = useCallback(() => {
    const reveal = () => {
      if (live.current) live.current.dataset.count = "live"
    }
    const { final: f, raw: r, format: fmt } = latest.current
    const end = r ?? parseFigure(f)?.n ?? 0
    target.current = { final: f, raw: r }
    const frame = planCount(f, r, fmt)
    if (!frame) {
      at.current = end
      display.set(f)
      reveal()
      return
    }
    const claimed = !!once && !counted.has(once)
    if (once) counted.add(once)
    at.current = 0
    display.set(frame(0))
    reveal()
    const ms = (updates === "instant" ? countIn.balance : countIn.duration) * 1000
    let settled = false
    const mine = play(
      ms,
      (t) => {
        const p = t / ms
        const q = countEase(p)
        at.current = end * q
        // The last few percent land on the final text itself.
        display.set(p >= 0.97 ? f : frame(q))
      },
      () => {
        settled = true
        at.current = end
        display.set(f)
      },
    )
    stop.current = mine
    return () => {
      // Superseded by a later change, or already settled: nothing to undo.
      if (settled || stop.current !== mine) return
      mine()
      display.set(latest.current.final)
      target.current = null
      if (claimed && once) counted.delete(once)
      if (live.current) live.current.dataset.count = "pending"
    }
  }, [once, updates, display])

  // Before the first paint: under reduced motion, or for a figure that already counted
  // elsewhere, the final value; a number that is already on screen starts counting now,
  // so it never sits blank beside its label waiting for the visibility observer.
  useLayoutEffect(() => {
    if (!isPending()) return
    if (reduce || (once && counted.has(once))) {
      const { final: f, raw: r } = latest.current
      display.set(f)
      target.current = { final: f, raw: r }
      at.current = r ?? parseFigure(f)?.n ?? 0
      reveal()
      return
    }
    const box = ref.current?.getBoundingClientRect()
    if (box && box.width > 0 && box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth) return begin()
  }, [reduce, once, display, begin])

  // Otherwise once it scrolls into view (any visible pixel).
  useEffect(() => {
    if (!inView || reduce || !isPending()) return
    return begin()
  }, [inView, reduce, begin])

  // Later changes: ease between values (or snap, with `updates="instant"`).
  useEffect(() => {
    const prev = target.current
    if (isPending() || !prev || prev.final === final) return
    stop.current?.()
    stop.current = null
    target.current = { final, raw }
    const settle = () => {
      display.set(final)
      hold(holder.current, null)
    }
    if (reduce || updates === "instant") {
      at.current = raw ?? parseFigure(final)?.n ?? 0
      settle()
      return
    }
    const shown = display.get()
    const b = parseFigure(final)
    let from: number
    let to: number
    let frame: (v: number) => string
    // Frames that might be wider than both ends; when one is, the change snaps instead.
    let wide: string[] = []
    const fmt = latest.current.format
    if (raw !== null && prev.raw !== null && fmt) {
      from = at.current
      to = raw
      const a = parseFigure(shown)
      const whole = Number.isInteger(raw) && Number.isInteger(prev.raw)
      if (a && b && sameShape(a, b) && to !== 0) {
        // Both ends share a shape ("₦3.5M" to "₦1.0M"): every frame keeps it.
        const shape = grouped(a, b)
        frame = (v) => renderFigure(shape, Math.max(0, (shape.n * v) / to))
      } else if (b || whole) {
        // The shape changes ("$2.4K" to "$583"): every frame is the caller's own format of a
        // two-significant-digit value on the way to the new one (whole units when the new
        // figure has none), so a value under 1,000 reads "$590", never "$0.6K" or "$583.4".
        const rising = to > from
        const round = !b || b.decimals === 0
        const step = (v: number) => {
          if (v <= 0) return 0
          const unit = 10 ** (Math.floor(Math.log10(v)) - 1)
          const x = Number(((rising ? Math.floor(v / unit) : Math.ceil(v / unit)) * unit).toPrecision(2))
          return round ? Math.round(x) : x
        }
        frame = (v) => fmt(step(v))
        wide = between(Math.min(from, to), Math.max(from, to)).map(frame)
      } else {
        at.current = raw
        settle()
        return
      }
    } else {
      const a = parseFigure(prev.final)
      if (!a || !b || !sameShape(a, b)) {
        at.current = b?.n ?? 0
        settle()
        return
      }
      const shape = grouped(a, b)
      from = at.current || a.n
      to = shape.n
      frame = (n) => renderFigure(shape, n)
    }
    // While the ease runs, the box keeps the wider of the two ends, so a falling value never
    // covers what sits beside it; it takes the new value's width once, when the ease ends.
    // A change whose frames would be wider still (a compact "₦999.9K" between "₦1M" and "₦0")
    // snaps instead.
    const box = ref.current
    hold(holder.current, [shown, final])
    if (wide.length && box) {
      const ends = box.getBoundingClientRect().width
      hold(holder.current, [shown, final, ...wide])
      if (box.getBoundingClientRect().width > ends + 0.5) {
        at.current = to
        settle()
        return
      }
      hold(holder.current, [shown, final])
    }
    const c = animate(from, to, {
      ...counter,
      onUpdate: (v) => {
        at.current = v
        display.set(frame(v))
      },
      onComplete: settle,
    })
    stop.current = () => {
      c.stop()
      hold(holder.current, null)
    }
  }, [final, raw, reduce, updates, display])

  return (
    <span ref={ref} className={`relative inline-block whitespace-nowrap ${className ?? ""}`}>
      {/* Zero height: it only widens the box while a later change eases (see `hold`). */}
      <span ref={holder} aria-hidden className="invisible block h-0 overflow-hidden" />
      <span aria-hidden className="invisible">{final}</span>
      <motion.span ref={live} aria-hidden data-count="pending" className="absolute inset-y-0 left-0">
        {display}
      </motion.span>
      <span className="sr-only">{final}</span>
    </span>
  )
}

/** A spread of two-significant-digit values between `lo` and `hi` (and both ends), to find the
    widest frames a format draws on the way: in each power of ten, the digit patterns that
    make a figure widest or narrowest. */
function between(lo: number, hi: number) {
  const out = [lo, hi]
  if (hi <= 0) return out
  const top = Math.floor(Math.log10(hi))
  for (let e = Math.floor(Math.log10(Math.max(lo, hi * 1e-6))); e <= top; e++) {
    for (const d of [10, 11, 15, 19, 25, 49, 55, 95, 99]) {
      const v = Number((d * 10 ** (e - 1)).toPrecision(2))
      if (v >= lo && v <= hi) out.push(v)
    }
  }
  return out
}

/** Widens a CountUp's box to the widest of `texts` (zero-height lines), or clears it. */
function hold(el: HTMLSpanElement | null, texts: string[] | null) {
  if (!el) return
  el.replaceChildren(
    ...[...new Set(texts ?? [])].map((t) => {
      const line = document.createElement("span")
      line.style.display = "block"
      line.style.height = "0"
      line.textContent = t
      return line
    }),
  )
}
