"use client"

/**
 * DOM for the map's markers (§6.4 step 6). Plain elements, not React roots: MapLibre positions
 * them, and the map reconciles them by key so an unchanged pin is never recreated.
 *
 * Colour rules: pins are ink on card; a kind dot at the bottom right (store ink, showroom grey,
 * a live pop-up or exhibition acid — the only acid on the map — and upcoming an ink-2 outline);
 * purple is for active and selected states only, so the selected pin alone gets the purple ring
 * (the "you" dot's ring shows only while Locate is on, like the Locate button's fill); sample
 * places get a dashed outer ring. Cluster count chips are ink on obsidian with a hairline.
 */

export type PinStatus = "store" | "showroom" | "live" | "upcoming"
export type PinProps = { id: string; markText: string; markStyle: string; brand: string; kindLabel: string; area: string; sample: boolean; status: PinStatus }

const markFont = (style: string) => (style === "condensed" ? "font-display" : style === "expanded" ? "font-wide" : "font-sans font-bold tracking-tight")

const dotClass: Record<PinStatus, string> = {
  store: "bg-ink",
  showroom: "bg-ink-2",
  live: "bg-acid",
  upcoming: "bg-obsidian ring-1 ring-inset ring-ink-2",
}

export function pinLabel(p: PinProps) {
  return `${p.brand}, ${p.kindLabel}, ${p.area}${p.sample ? ", sample" : ""}`
}

export function placePin(p: PinProps, onClick: (id: string) => void): HTMLButtonElement {
  const el = document.createElement("button")
  el.type = "button"
  el.dataset.placeId = p.id
  el.setAttribute("aria-label", pinLabel(p))
  el.className = [
    "yard-pin group relative flex size-11 items-center justify-center rounded-full bg-card text-ink ring-2 ring-ink",
    "transition-[transform,box-shadow] duration-200 ease-out-quint focus-visible:ring-violet",
    // A sample place's dashed outer ring is an outline, so `outline-none` must not also be set.
    p.sample ? "outline-[1.5px] outline-offset-[3px] outline-dashed outline-ink/70" : "outline-none",
  ].join(" ")
  const mark = document.createElement("span")
  mark.setAttribute("aria-hidden", "true")
  mark.className = `${markFont(p.markStyle)} text-[13px] leading-none select-none`
  mark.textContent = p.markText
  const dot = document.createElement("span")
  dot.setAttribute("aria-hidden", "true")
  dot.className = `absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-card ${dotClass[p.status]}`
  el.append(mark, dot)
  // Pins stack above area names (1) and the "you" dot; the selected pin above every other pin.
  el.style.zIndex = "2"
  el.addEventListener("click", (e) => {
    e.stopPropagation()
    onClick(p.id)
  })
  return el
}

/** The selected pin: a purple 3 px ring and a slight lift (no lift under reduced motion). */
export function setPinSelected(el: HTMLElement, selected: boolean) {
  el.classList.toggle("ring-ink", !selected)
  el.classList.toggle("ring-purple", selected)
  el.classList.toggle("ring-[3px]", selected)
  el.classList.toggle("ring-2", !selected)
  el.classList.toggle("yard-pin-selected", selected)
  el.style.zIndex = selected ? "3" : "2"
  if (selected) el.setAttribute("aria-pressed", "true")
  else el.removeAttribute("aria-pressed")
}

export type ClusterLeaf = { markText: string; markStyle: string; brand: string }

/** Up to three stacked brand marks, like Snap Map's stacked avatars, plus a count chip above 3. */
export function clusterPin(count: number, onClick: () => void): HTMLButtonElement {
  const el = document.createElement("button")
  el.type = "button"
  el.setAttribute("aria-label", `${count} places here. Zoom in`)
  el.className = "yard-cluster relative flex h-11 items-center outline-none focus-visible:ring-2 focus-visible:ring-violet rounded-full"
  el.style.zIndex = "2"
  const stack = document.createElement("span")
  stack.className = "flex items-center"
  stack.dataset.stack = ""
  for (let i = 0; i < Math.min(3, count); i++) stack.append(stackCircle(null, i))
  el.append(stack)
  if (count > 3) el.append(countChip(count))
  el.addEventListener("click", (e) => {
    e.stopPropagation()
    onClick()
  })
  return el
}

function countChip(count: number) {
  const chip = document.createElement("span")
  chip.setAttribute("aria-hidden", "true")
  chip.dataset.count = ""
  chip.className = "absolute -top-2 -right-3 inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-white/15 bg-obsidian px-1.5 text-[11px] leading-none text-ink tabular"
  chip.textContent = String(count)
  return chip
}

function stackCircle(leaf: ClusterLeaf | null, i: number) {
  const c = document.createElement("span")
  c.setAttribute("aria-hidden", "true")
  c.className = `${i ? "-ml-2.5 " : ""}flex size-10 items-center justify-center rounded-full border-2 border-obsidian bg-card text-ink ring-1 ring-ink/70 ${leaf ? markFont(leaf.markStyle) : ""} text-[12px] leading-none`
  c.style.zIndex = String(3 - i)
  c.textContent = leaf?.markText ?? ""
  return c
}

export function fillCluster(el: HTMLElement, leaves: ClusterLeaf[], count: number) {
  const stack = el.querySelector<HTMLElement>("[data-stack]")
  if (!stack) return
  // One circle per brand: a brand with several places shows once, so the stack reads as
  // different brands (Snap Map's distinct avatars), never "LS LS LS".
  const distinct = leaves.filter((l, i) => leaves.findIndex((x) => x.brand === l.brand) === i)
  const circles = distinct.slice(0, 3)
  stack.replaceChildren(...circles.map((l, i) => stackCircle(l, i)))
  // Fewer circles than places (one brand's several places): the count says it's a group.
  if (count > circles.length && !el.querySelector("[data-count]")) el.append(countChip(count))
  const names = distinct.map((l) => l.brand)
  el.setAttribute("aria-label", `${count} places here${names.length ? `, including ${names.slice(0, 3).join(", ")}` : ""}. Zoom in`)
}

/** The "you" dot: an ink dot with a purple ring, drawn from a DOM overlay and never from data. */
export function youDot(): HTMLElement {
  const el = document.createElement("div")
  el.setAttribute("role", "img")
  el.setAttribute("aria-label", "Your location, on this device only")
  el.className = "pointer-events-none size-4 rounded-full border-2 border-obsidian bg-ink ring-[3px] ring-purple"
  el.style.zIndex = "1"
  return el
}

export function areaLabel(text: string, level: "city" | "neighbourhood"): HTMLElement {
  const el = document.createElement("div")
  el.setAttribute("aria-hidden", "true")
  el.className =
    level === "city"
      ? "pointer-events-none font-wide text-[11px] leading-none tracking-[0.12em] whitespace-nowrap text-ink/75 uppercase [text-shadow:0_0_2px_#080808,0_1px_3px_#080808]"
      : "pointer-events-none text-[11px] leading-none font-medium whitespace-nowrap text-ink/70 [text-shadow:0_0_2px_#080808,0_1px_3px_#080808]"
  el.textContent = text
  return el
}
