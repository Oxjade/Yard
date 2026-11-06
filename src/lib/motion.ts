/**
 * Motion system — the single source of timing for the whole app.
 *
 * Principles: fast, responsive, purposeful. Springs settle without bouncing; nothing
 * blocks input; nothing loops for attention. Reduced motion is honoured globally by
 * <MotionConfig reducedMotion="user"> (transforms stripped, opacity kept) and by the CSS
 * media query in globals.css.
 *
 * | Interaction        | Target       |
 * |--------------------|--------------|
 * | Button feedback    | 100–160ms    |
 * | Hover              | 150–200ms    |
 * | Dropdown           | 160–220ms    |
 * | Tooltip            | 120–160ms    |
 * | Modal              | 200–280ms    |
 * | Drawer             | 250–350ms    |
 * | Page transition    | 200–300ms    |
 * | Chart transition   | 350–600ms    |
 * | Skeleton shimmer   | 1.2–1.8s     |
 */

export const ease = {
  /** Default UI easing: quick start, soft landing. */
  out: [0.22, 1, 0.36, 1] as const,
  /** Symmetric, for things that move and come back (shimmer). */
  inOut: [0.65, 0, 0.35, 1] as const,
  /** Exits: leave quickly, no lingering. */
  in: [0.4, 0, 1, 1] as const,
  /** A strong ease-out: most of the distance early, then a long, calm settle. */
  settle: [0.16, 1, 0.3, 1] as const,
  /** First counts and chart entrances (a cubic ease-out): quick off the mark, with the middle
      of the count still readable (about half way at a fifth of the time), then a calm landing. */
  count: [0.33, 1, 0.68, 1] as const,
}

export const duration = {
  press: 0.12,
  hover: 0.18,
  dropdown: 0.2,
  tooltip: 0.14,
  modal: 0.24,
  drawer: 0.3,
  page: 0.22,
  chart: 0.5,
  shimmer: 1.5,
}

/** Springs: explicit stiffness, damping and mass. None of them overshoot visibly. */
export const spring = {
  /** Presses, toggles, small icons. */
  snappy: { type: "spring", stiffness: 520, damping: 34, mass: 0.6 },
  /** Hover lift on cards. */
  lift: { type: "spring", stiffness: 420, damping: 30, mass: 0.7 },
  /** Sliding indicators: tabs, segmented pills, nav underline. */
  indicator: { type: "spring", stiffness: 500, damping: 40, mass: 0.8 },
  /** Drawers and sheets. */
  drawer: { type: "spring", stiffness: 380, damping: 38, mass: 0.9 },
  /** Lists re-flowing after add/remove. */
  layout: { type: "spring", stiffness: 420, damping: 40, mass: 0.8 },
  /** Entrance reveals of page sections. */
  reveal: { type: "spring", stiffness: 260, damping: 30, mass: 0.9 },
} as const

/** Shared variants. */
export const variants = {
  fade: { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: duration.page, ease: ease.out } } },
  rise: { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: spring.reveal } },
  listItem: {
    initial: { opacity: 0, y: -6 },
    animate: { opacity: 1, y: 0, transition: spring.layout },
    exit: { opacity: 0, x: 16, transition: { duration: 0.16, ease: ease.in } },
  },
  stagger: (gap = 0.05) => ({ hidden: {}, show: { transition: { staggerChildren: gap } } }),
}

/** Number transitions: long enough to read the change, short enough not to wait for it. */
export const counter = { duration: 0.6, ease: ease.out }

/**
 * The first count of a metric, from zero, when it first appears: a confident count, not a
 * slot machine. Numbers in one row start together. `balance` is the shorter count for money
 * balances and status figures (the sidebar card), which count on first load only.
 * Entrance clocks start on the first frame after the figure is shown and never skip ahead
 * when the main thread is busy (insight/clock.ts), so the whole count is seen.
 */
export const countIn = { duration: 1, ease: ease.count, balance: 0.75 }

/**
 * Charts on first appearance: bars grow from the baseline, donuts and gauges sweep in,
 * heatmaps fade in by column, areas draw in. `stagger` is spread across the whole series
 * (not per item), so a long series takes no longer than a short one.
 */
export const chartIn = { duration: 0.5, ease: ease.count, stagger: 0.12 }

/** `chartIn.ease` as a CSS easing, for CSS transitions and Recharts. */
export const chartEasing = `cubic-bezier(${chartIn.ease.join(",")})` as `cubic-bezier(${number},${number},${number},${number})`
