"use client"

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { CaretLeftIcon as ChevronLeft, CaretRightIcon as ChevronRight, PauseIcon, PlayIcon } from "@phosphor-icons/react"
import { cubicBezier } from "motion/react"
import { ease } from "@/lib/motion"
import { cn } from "@/lib/utils"

const reducedMotion = "(prefers-reduced-motion: reduce)"
const subscribeMotion = (onChange: () => void) => {
  const mq = window.matchMedia(reducedMotion)
  mq.addEventListener("change", onChange)
  return () => mq.removeEventListener("change", onChange)
}
/** False on the server and while hydrating, so the server HTML (a plain scrollable rail) always matches. */
function useMotionAllowed() {
  return useSyncExternalStore(subscribeMotion, () => !window.matchMedia(reducedMotion).matches, () => false)
}

const arrow =
  "size-9 items-center justify-center rounded-full border border-line text-ink transition hover:bg-elevated active:scale-[0.96] disabled:opacity-30"

/**
 * A horizontal scroller with snap points and desktop arrow buttons.
 *
 * `marquee` makes it glide right to left on its own, as a seamless loop, at a calm constant
 * speed (see useMarquee). It pauses while hovered, while something in it has keyboard focus,
 * while a finger or the mouse is down, while the tab is hidden and while it is off screen; it
 * stays draggable by hand and scrollable with a trackpad, and picks up again after. Under
 * reduced motion, without JavaScript, before hydration and when everything already fits, it is
 * the plain rail. With `marquee`, give items widths in vw or cqw (the rail is the container),
 * never %, since the items sit in a moving track.
 */
export function Rail({
  children,
  className,
  itemClassName,
  label,
  marquee = false,
  speed = 36,
  footer,
}: {
  children: React.ReactNode[]
  className?: string
  itemClassName?: string
  label: string
  /** Glide right to left on its own (see above). */
  marquee?: boolean
  /** Marquee speed in px per second. */
  speed?: number
  /** Shown at the start of the controls row, e.g. a "see all" link. */
  footer?: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const cloneRef = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ start: true, end: false })
  const motionAllowed = useMotionAllowed()
  const [fits, setFits] = useState(false)
  const moving = marquee && motionAllowed && !fits

  const m = useMarquee({ enabled: moving, measure: marquee && motionAllowed, speed, count: children.length, viewportRef: ref, trackRef, cloneRef, onFits: setFits })

  useEffect(() => {
    const el = ref.current
    if (!el || moving) return
    const update = () => setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 })
    update()
    el.addEventListener("scroll", update, { passive: true })
    window.addEventListener("resize", update)
    return () => {
      el.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
    }
  }, [moving, children.length])

  const scroll = (dir: 1 | -1) => {
    if (moving) return m.step(dir)
    ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.8, behavior: "smooth" })
  }

  const item = (child: React.ReactNode, i: number, original: boolean) => (
    <div
      key={i}
      data-rail-item={original ? i : undefined}
      data-rail-copy={original ? undefined : i}
      className={cn("w-[72vw] shrink-0 sm:w-[42vw] md:w-[30vw] lg:w-[23%]", !moving && "snap-start", itemClassName)}
    >
      {child}
    </div>
  )

  // The controls row shows on phones too when it carries the footer or the pause toggle.
  const row = !!footer || moving

  return (
    <div className={cn("group/rail relative", className)} role="region" aria-label={label}>
      {/* Hover, keyboard focus and presses hold the glide here, on the cards, and on the arrows
          (stepping by hand); never on the pause toggle, so Resume resumes while the pointer or
          focus is still on it. */}
      <div
        ref={ref}
        className={cn(
          "rail -mx-4 flex gap-3 px-4 pb-2 sm:gap-4 md:-mx-8 md:px-8",
          moving ? "touch-pan-y touch-pinch-zoom overflow-x-clip select-none data-[dragging=true]:cursor-grabbing" : "snap-x snap-mandatory scroll-px-4 overflow-x-auto md:scroll-px-8",
          // Marquee rails: the items size against the rail (cqw), and the ends fade across the
          // rail's own padding (its bleed into the gutter), so cards ease out of view instead of
          // being cut at the edge. A caller beside another column leaves that much gap for it.
          marquee &&
            "@container -mt-2 pt-2 [mask-image:linear-gradient(to_right,transparent,#000_16px,#000_calc(100%-16px),transparent)] md:[mask-image:linear-gradient(to_right,transparent,#000_32px,#000_calc(100%-32px),transparent)]",
        )}
        {...(moving ? m.viewportProps : {})}
      >
        {/* A plain rail lays the items straight into the scroller (display: contents); the
            marquee moves them as one track, followed by a copy for the seamless loop. */}
        <div ref={trackRef} className={moving ? "flex w-max shrink-0 gap-3 will-change-transform sm:gap-4" : "contents"}>
          <div className={moving ? "flex gap-3 sm:gap-4" : "contents"}>{children.map((c, i) => item(c, i, true))}</div>
          {/* The copy is there to be seen and tapped, not read: hidden from assistive tech and
              out of the tab order (useMarquee), so each card is announced and tabbed once. It
              stays clickable (inert would block that), and a control in it that takes focus
              from a click hands it to the same control on the original card. */}
          {moving ? (
            <div ref={cloneRef} className="flex gap-3 sm:gap-4" aria-hidden>
              {children.map((c, i) => item(c, i, false))}
            </div>
          ) : null}
        </div>
      </div>
      <div className={cn("mt-4 items-center justify-end gap-2", row ? "flex" : "hidden md:flex")}>
        {footer ? <div className="mr-auto min-w-0">{footer}</div> : null}
        {moving ? (
          <button
            type="button"
            onClick={m.togglePaused}
            aria-label={m.paused ? "Resume scrolling" : "Pause scrolling"}
            className={cn(arrow, "inline-flex size-10 md:size-9")}
          >
            {m.paused ? <PlayIcon className="size-4" weight="fill" /> : <PauseIcon className="size-4" weight="fill" />}
          </button>
        ) : null}
        <button type="button" onClick={() => scroll(-1)} disabled={!moving && edges.start} aria-label="Scroll back" className={cn(arrow, row ? "hidden md:inline-flex" : "inline-flex")} {...(moving ? m.arrowProps : {})}>
          <ChevronLeft className="size-4" />
        </button>
        <button type="button" onClick={() => scroll(1)} disabled={!moving && edges.end} aria-label="Scroll forward" className={cn(arrow, row ? "hidden md:inline-flex" : "inline-flex")} {...(moving ? m.arrowProps : {})}>
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  )
}


/* ───────────────────────── Marquee ───────────────────────── */

const focusable = "a[href], button, input, select, textarea, summary, [tabindex]"
const easeOut = cubicBezier(...ease.out)
/** How long a touch, a trackpad scroll or a fling waits before the glide picks up again. */
const RESUME_AFTER_MS = 1400
/** A press only becomes a drag past this many pixels sideways, so taps stay taps. */
const DRAG_SLOP = 6
/** Arrow and keyboard moves: a calm glide to the card (drawer-like, not a jump). */
const STEP_MS = 420
/** An arrow press goes to the next card start at least this far away, so a press always visibly moves. */
const STEP_MIN = 32
const mod = (n: number, p: number) => ((n % p) + p) % p

type Reason = "hover" | "focus" | "press" | "settle" | "user"
type Metrics = { period: number; content: number; starts: number[]; widths: number[] }
type Drag = { id: number; x: number; y: number; offset: number; dragging: boolean; touch: boolean; samples: { x: number; t: number }[] }

/**
 * The marquee's motion, outside React: one requestAnimationFrame loop writes one transform on
 * the track. Nothing re-renders per frame and nothing is measured per frame (sizes come from a
 * ResizeObserver). The loop runs only while there is something to move and the rail is on
 * screen in a visible tab, and stops itself once the rail comes to rest.
 *
 * Speed eases toward its target, a calm start and a quick, soft stop, so pausing on hover and
 * picking up again never jolts. At rest the offset lands on a whole device pixel, so paused
 * text is crisp.
 */
class MarqueeEngine {
  private enabled = false
  private speed = 36
  private track: HTMLElement | null = null
  private metrics: Metrics | null = null
  /** Raw position in px; shown modulo the period. */
  private offset = 0
  /** Current glide speed, px/s. */
  private velocity = 0
  /** Hand-off velocity after a drag, px/ms. */
  private fling = 0
  private tween: { from: number; to: number; start: number; duration: number } | null = null
  /** Why it is held still right now; it glides only when this is empty. */
  private reasons = new Set<Reason>()
  private inView = true
  private drag: Drag | null = null
  private blockClick = false
  private nativeScroll = 0
  private raf = 0
  private last = 0
  private settleTimer = 0

  attach(track: HTMLElement, speed: number) {
    this.enabled = true
    this.speed = speed
    this.track = track
    // Carry over how far the plain rail was scrolled before the marquee took over.
    if (this.nativeScroll) this.offset = this.nativeScroll
    this.nativeScroll = 0
    this.write()
  }

  /** Stops and clears the track's transform; returns where it was, for the plain rail's scroll. */
  detach() {
    const at = this.metrics ? mod(this.offset, this.metrics.period) : 0
    this.enabled = false
    this.stop()
    if (this.track) this.track.style.transform = ""
    this.track = null
    return at
  }

  setMetrics(m: Metrics) {
    this.metrics = m
    this.offset = mod(this.offset, m.period)
    this.write()
  }

  setInView(inView: boolean) {
    this.inView = inView
    this.kick()
  }

  noteNativeScroll(x: number) {
    this.nativeScroll = x
  }

  /** True once after a drag ended, so the click that follows it is swallowed. */
  takeClickBlock() {
    const block = this.blockClick
    this.blockClick = false
    return block
  }

  write() {
    const p = this.metrics?.period
    if (this.track && p) this.track.style.transform = `translate3d(${-mod(this.offset, p)}px,0,0)`
  }

  private frame = (t: number) => {
    this.raf = 0
    const p = this.metrics?.period
    if (!this.enabled || !p) return
    const dt = this.last ? Math.min(64, t - this.last) : 0
    this.last = t
    let busy = true
    if (this.tween) {
      const k = Math.min(1, (t - this.tween.start) / this.tween.duration)
      this.offset = this.tween.from + (this.tween.to - this.tween.from) * easeOut(k)
      if (k >= 1) this.tween = null
    } else if (this.fling) {
      this.offset += this.fling * dt
      this.fling *= Math.exp(-dt / 325)
      if (Math.abs(this.fling) < 0.02) {
        this.fling = 0
        this.settle()
      }
    } else if (this.drag?.dragging) {
      busy = false
    } else {
      const target = this.reasons.size ? 0 : this.speed
      this.velocity += (target - this.velocity) * (1 - Math.exp(-dt / (target > this.velocity ? 600 : 160)))
      if (target === 0 && this.velocity < 0.5) {
        this.velocity = 0
        const dpr = window.devicePixelRatio || 1
        this.offset = Math.round(mod(this.offset, p) * dpr) / dpr
        busy = false
      } else {
        this.offset += (this.velocity * dt) / 1000
      }
    }
    if (!this.tween) this.offset = mod(this.offset, p)
    this.write()
    if (busy && this.inView && document.visibilityState === "visible") this.raf = requestAnimationFrame(this.frame)
    else this.last = 0
  }

  kick() {
    if (!this.enabled || this.raf || !this.inView || document.visibilityState !== "visible") return
    this.last = 0
    this.raf = requestAnimationFrame(this.frame)
  }

  stop() {
    cancelAnimationFrame(this.raf)
    window.clearTimeout(this.settleTimer)
    this.raf = 0
    this.last = 0
    this.tween = null
    this.fling = 0
    this.velocity = 0
    this.drag = null
    for (const r of ["hover", "focus", "press", "settle"] as const) this.reasons.delete(r)
  }

  hold(r: Reason) {
    this.reasons.add(r)
    this.kick()
  }

  release(r: Reason) {
    this.reasons.delete(r)
    this.kick()
  }

  /** After a touch, a trackpad scroll or a fling: stay put a moment, then glide on. */
  settle() {
    this.reasons.add("settle")
    window.clearTimeout(this.settleTimer)
    this.settleTimer = window.setTimeout(() => this.release("settle"), RESUME_AFTER_MS)
  }

  /**
   * Moves by `delta` from wherever it is headed, over STEP_MS, and comes to rest there: a held
   * rail stays on the card instead of drifting past it on the glide's old speed, and a running
   * one eases back up to speed from there.
   */
  glideBy(delta: number) {
    const base = this.tween ? this.tween.to : this.offset
    this.fling = 0
    this.velocity = 0
    this.tween = { from: this.offset, to: base + delta, start: performance.now(), duration: STEP_MS }
    this.kick()
  }

  /** Arrow buttons: glide to the next or previous card's start. */
  step(dir: 1 | -1) {
    const mt = this.metrics
    if (!mt) return
    const at = mod(this.tween ? this.tween.to : this.offset, mt.period)
    let best: number | null = null
    for (const k of [-1, 0, 1]) {
      for (const start of mt.starts) {
        const c = start + k * mt.period - at
        if (dir > 0 ? c > STEP_MIN && (best === null || c < best) : c < -STEP_MIN && (best === null || c > best)) best = c
      }
    }
    if (best !== null) this.glideBy(best)
  }

  /**
   * Keyboard focus on a card off to one side: bring it fully into view, the shorter way round.
   * It's the original card that has focus (the copy can't), so it's the original that has to
   * show, even where its copy is on screen; the loop looks the same either way.
   */
  reveal(el: Element) {
    const mt = this.metrics
    const item = el.closest<HTMLElement>("[data-rail-item]")
    if (!mt || !item) return
    const i = Number(item.dataset.railItem)
    const lo = Math.max(0, mt.starts[i] + mt.widths[i] - mt.content)
    const hi = mt.starts[i]
    const at = mod(this.tween ? this.tween.to : this.offset, mt.period)
    if (at >= lo - 1 && at <= hi + 1) return
    const shortest = (target: number) => {
      const d = mod(target - at, mt.period)
      return d > mt.period / 2 ? d - mt.period : d
    }
    const toLo = shortest(lo)
    const toHi = shortest(hi)
    this.glideBy(Math.abs(toLo) < Math.abs(toHi) ? toLo : toHi)
  }

  wheel(dx: number) {
    this.tween = null
    this.fling = 0
    this.velocity = 0
    this.offset += dx
    if (this.metrics) this.offset = mod(this.offset, this.metrics.period)
    this.write()
    this.settle()
  }

  pointerDown(e: React.PointerEvent) {
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return
    window.clearTimeout(this.settleTimer)
    this.reasons.delete("settle")
    this.blockClick = false
    this.tween = null
    this.fling = 0
    this.velocity = 0
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, offset: this.offset, dragging: false, touch: e.pointerType !== "mouse", samples: [{ x: e.clientX, t: e.timeStamp }] }
    this.hold("press")
  }

  pointerMove(e: React.PointerEvent<HTMLElement>) {
    const d = this.drag
    if (!d || d.id !== e.pointerId) return
    const dx = e.clientX - d.x
    if (!d.dragging) {
      if (Math.abs(dx) < DRAG_SLOP || Math.abs(dx) < Math.abs(e.clientY - d.y)) return
      d.dragging = true
      // Captured only once it is a drag, so a plain click still reaches the card's link.
      e.currentTarget.setPointerCapture(e.pointerId)
      e.currentTarget.setAttribute("data-dragging", "true")
    }
    this.offset = d.offset - dx
    if (this.metrics) this.offset = mod(this.offset, this.metrics.period)
    d.samples.push({ x: e.clientX, t: e.timeStamp })
    if (d.samples.length > 8) d.samples.shift()
    this.write()
  }

  pointerEnd(e: React.PointerEvent<HTMLElement>, cancelled: boolean) {
    const d = this.drag
    if (!d || d.id !== e.pointerId) return
    this.drag = null
    e.currentTarget.removeAttribute("data-dragging")
    this.reasons.delete("press")
    if (d.dragging && !cancelled) {
      // A drag that ends over a card isn't a click on it.
      this.blockClick = true
      const recent = d.samples.filter((p) => e.timeStamp - p.t < 100)
      const a = recent[0]
      const b = recent[recent.length - 1]
      const v = a && b && b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0
      this.fling = Math.max(-3, Math.min(3, -v))
    }
    if (d.touch || d.dragging || cancelled) this.settle()
    this.kick()
  }
}

function useMarquee({
  enabled,
  measure,
  speed,
  count,
  viewportRef,
  trackRef,
  cloneRef,
  onFits,
}: {
  enabled: boolean
  measure: boolean
  speed: number
  count: number
  viewportRef: React.RefObject<HTMLDivElement | null>
  trackRef: React.RefObject<HTMLDivElement | null>
  cloneRef: React.RefObject<HTMLDivElement | null>
  onFits: (fits: boolean) => void
}) {
  const [engine] = useState(() => new MarqueeEngine())
  const [paused, setPaused] = useState(false)

  // Sizes: the period (one set plus a gap), the visible width and where each card starts.
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!measure || !viewport) return
    const run = () => {
      const items = [...viewport.querySelectorAll<HTMLElement>("[data-rail-item]")]
      if (!items.length) return
      const first = items[0]
      const lastItem = items[items.length - 1]
      const cs = getComputedStyle(viewport)
      const gap = parseFloat(cs.columnGap) || 0
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
      const period = lastItem.offsetLeft + lastItem.offsetWidth - first.offsetLeft + gap
      engine.setMetrics({ period, content: viewport.clientWidth - pad, starts: items.map((el) => el.offsetLeft - first.offsetLeft), widths: items.map((el) => el.offsetWidth) })
      // Loop only when one set is wider than the rail; otherwise a card would show twice.
      onFits(period <= viewport.clientWidth + 1)
    }
    run()
    const ro = new ResizeObserver(run)
    ro.observe(viewport)
    return () => ro.disconnect()
  }, [engine, measure, enabled, count, viewportRef, onFits])

  // Switching between the plain rail and the marquee carries the position across.
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track) return
    if (!enabled) {
      const onScroll = () => engine.noteNativeScroll(viewport.scrollLeft)
      viewport.addEventListener("scroll", onScroll, { passive: true })
      return () => viewport.removeEventListener("scroll", onScroll)
    }
    engine.attach(track, speed)
    return () => {
      // Back to the plain rail (reduced motion switched on, or the cards now fit), or unmounting.
      const at = engine.detach()
      requestAnimationFrame(() => viewport.scrollTo({ left: at }))
    }
  }, [engine, enabled, speed, viewportRef, trackRef])

  useEffect(() => {
    const viewport = viewportRef.current
    const clone = cloneRef.current
    if (!enabled || !viewport) return

    // The copy stays out of the tab order, including controls that appear later (a drop's
    // Notify me turning into Shop the drop). Pointer and touch can still use it: it's on screen.
    let mo: MutationObserver | undefined
    if (clone) {
      const untab = () => clone.querySelectorAll<HTMLElement>(focusable).forEach((el) => el.getAttribute("tabindex") !== "-1" && el.setAttribute("tabindex", "-1"))
      untab()
      mo = new MutationObserver(untab)
      mo.observe(clone, { childList: true, subtree: true })
    }

    const io = new IntersectionObserver(
      ([entry]) => engine.setInView(entry.isIntersecting),
      { rootMargin: "120px 0px" },
    )
    io.observe(viewport)
    const onVisibility = () => engine.kick()
    document.addEventListener("visibilitychange", onVisibility)

    // A trackpad (or shift + wheel) moves it sideways; a plain vertical wheel still scrolls the page.
    const onWheel = (e: WheelEvent) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.clientWidth : 1
      const x = e.deltaX * unit
      const y = e.deltaY * unit
      const dx = x || (e.shiftKey ? y : 0)
      if (!dx || (!e.shiftKey && Math.abs(x) < Math.abs(y))) return
      e.preventDefault()
      engine.wheel(dx)
    }
    viewport.addEventListener("wheel", onWheel, { passive: false })

    engine.kick()
    return () => {
      mo?.disconnect()
      io.disconnect()
      document.removeEventListener("visibilitychange", onVisibility)
      viewport.removeEventListener("wheel", onWheel)
    }
  }, [engine, enabled, viewportRef, cloneRef])

  /**
   * A click or tap on a control in the copy focuses it, inside an aria-hidden subtree, so a
   * dialog it opens would have nowhere to hand focus back to on close. Move that focus to the
   * same control on the original card (same item, same position among its controls); the click
   * itself still lands on the copy, and both show the same state.
   */
  const redirectFromCopy = (el: HTMLElement) => {
    const copy = el.closest<HTMLElement>("[data-rail-copy]")
    if (!copy || !cloneRef.current?.contains(copy)) return false
    const twin = viewportRef.current?.querySelector<HTMLElement>(`[data-rail-item="${copy.dataset.railCopy}"]`)
    const at = [...copy.querySelectorAll(focusable)].indexOf(el)
    const target = at < 0 ? null : twin?.querySelectorAll<HTMLElement>(focusable)[at]
    if (!target) return false
    target.focus({ preventScroll: true })
    return true
  }

  // What holds the glide sits on the scroller (here) and the arrows (arrowProps), not on the
  // rail's root, so the pause toggle and the footer link never hold it.
  const viewportProps = {
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") engine.hold("hover")
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") engine.release("hover")
    },
    // Keyboard focus only: a click that leaves focus on a card's button shouldn't freeze the rail.
    onFocus: (e: React.FocusEvent) => {
      if (!(e.target instanceof HTMLElement) || redirectFromCopy(e.target) || !e.target.matches(":focus-visible")) return
      engine.hold("focus")
      engine.reveal(e.target)
    },
    onBlur: (e: React.FocusEvent) => {
      if (!viewportRef.current?.contains(e.relatedTarget as Node | null)) engine.release("focus")
    },
    // Keys pressed while focus is on a card (focus that arrived by script, then Enter): that's
    // keyboard use too.
    onKeyDown: () => engine.hold("focus"),
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => engine.pointerDown(e),
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => engine.pointerMove(e),
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => engine.pointerEnd(e, false),
    // The browser took over (a vertical page scroll on touch).
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => engine.pointerEnd(e, true),
    onClickCapture: (e: React.MouseEvent) => {
      if (!engine.takeClickBlock()) return
      e.preventDefault()
      e.stopPropagation()
    },
    // Links and images would otherwise start the browser's own drag and drop.
    onDragStart: (e: React.DragEvent) => e.preventDefault(),
  }

  // Pointing at an arrow or tabbing onto one is stepping by hand: hold still meanwhile, so each
  // press lands on a card instead of chasing a moving rail.
  const arrowProps = {
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") engine.hold("hover")
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") engine.release("hover")
    },
    onFocus: (e: React.FocusEvent<HTMLButtonElement>) => {
      if (e.currentTarget.matches(":focus-visible")) engine.hold("focus")
    },
    onBlur: () => engine.release("focus"),
  }

  const togglePaused = () => {
    const next = !paused
    setPaused(next)
    if (next) engine.hold("user")
    else engine.release("user")
  }

  return { paused, togglePaused, step: (dir: 1 | -1) => engine.step(dir), viewportProps, arrowProps }
}
