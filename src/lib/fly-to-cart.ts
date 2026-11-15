import { duration, ease } from "@/lib/motion"

/**
 * The added piece's photograph travels into the Cart button: header Cart on desktop, the home
 * bar's Cart tab on phones (whichever carries `data-cart-target` and is on screen).
 *
 * Called only after the cart store has accepted the add (the server answered), so it never runs
 * ahead of the real state; the count and the "Added to cart" bubble update at the same moment.
 * A copy of the photograph already on screen (its `currentSrc`, so nothing is fetched again)
 * moves on transform and opacity alone, on a fixed layer that takes no pointer events, and is
 * removed when it lands. Nothing happens under reduced motion, when neither the photograph nor
 * `origin` is on screen, when the Cart isn't (the home bar hidden on scroll, say), or without
 * the Web Animations API.
 */
export function flyToCart(source: Element | null | undefined, origin?: Element | null) {
  if (typeof window === "undefined" || !source) return
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
  const img = source instanceof HTMLImageElement ? source : source.querySelector("img")
  const src = img?.currentSrc || img?.src
  if (!img || !src) return
  // On phones the home bar may be sliding back in (an add brings the hidden chrome back), so
  // wait a few frames for the Cart to settle on screen; if it never does, nothing flies.
  let frames = 0
  const start = () => {
    const target = [...document.querySelectorAll<HTMLElement>("[data-cart-target]")].find(visible)
    if (target) return fly(img, src, target, origin)
    if (++frames < 30) requestAnimationFrame(start)
  }
  start()
}

function fly(img: HTMLImageElement, src: string, target: HTMLElement, origin?: Element | null) {
  // From the photograph when it's on screen, else from the control that added it (the phone
  // size sheet covers the gallery, for one).
  const photo = img.getBoundingClientRect()
  const from = onScreen(photo) ? photo : origin?.getBoundingClientRect()
  const to = target.getBoundingClientRect()
  if (!from || !onScreen(from) || typeof document.body.animate !== "function") return

  // The copy starts as a 64px tile centred on the photograph and shrinks into the Cart icon.
  const size = 64
  const startScale = Math.min(1.6, Math.max(from.width, from.height) / size)
  const x0 = from.left + from.width / 2 - size / 2
  const y0 = from.top + from.height / 2 - size / 2
  const x1 = to.left + to.width / 2 - size / 2
  const y1 = to.top + to.height / 2 - size / 2
  // A tossed arc: across first, then into the Cart, lifting a little more on a longer trip, and
  // never above the top of the screen.
  const lift = Math.min(90, Math.hypot(x1 - x0, y1 - y0) * 0.12)
  const xm = x0 + (x1 - x0) * 0.62
  const ym = Math.max(8, y0 + (y1 - y0) * 0.3 - lift)

  const el = document.createElement("img")
  el.src = src
  el.alt = ""
  el.setAttribute("aria-hidden", "true")
  el.decoding = "async"
  Object.assign(el.style, {
    position: "fixed",
    left: "0px",
    top: "0px",
    width: `${size}px`,
    height: `${size * 1.25}px`,
    objectFit: "cover",
    borderRadius: "10px",
    boxShadow: "0 12px 32px -8px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(255 255 255 / 0.14)",
    pointerEvents: "none",
    zIndex: "80",
    willChange: "transform, opacity",
  } satisfies Partial<CSSStyleDeclaration>)
  document.body.appendChild(el)

  const at = (x: number, y: number, s: number) => `translate3d(${x}px, ${y}px, 0) scale(${s})`
  const anim = el.animate(
    [
      { transform: at(x0, y0, startScale), opacity: 0 },
      { transform: at(x0, y0 - 6, startScale * 0.92), opacity: 1, offset: 0.12 },
      { transform: at(xm, ym, 0.7), opacity: 1, offset: 0.55 },
      { transform: at(x1, y1, 0.18), opacity: 0.2 },
    ],
    { duration: duration.drawer * 1000 + 260, easing: `cubic-bezier(${ease.out.join(",")})`, fill: "forwards" },
  )
  const done = () => el.remove()
  anim.onfinish = done
  anim.oncancel = done
}

/** Laid out, shown and wholly on screen (a bar still sliding in doesn't count yet). */
function visible(el: HTMLElement) {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth && el.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false
}

function onScreen(r: DOMRect) {
  return r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth
}
