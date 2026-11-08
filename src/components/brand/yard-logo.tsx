import { site } from "@/config/site"
import { cn } from "@/lib/utils"
import { yardLogoPaths, yardLogoTransform, yardLogoViewBox } from "./yard-logo-paths"

/**
 * The Yard logo: the brush-script "YARD", inlined so it fills with currentColor and costs no
 * request. Callers set the height (the width follows the ~2.56:1 box) and, where it differs from
 * the default acid, the colour: acid on dark surfaces, black (`text-black`) on acid ones.
 *
 * Named as an image ("Yard") by default; `decorative` hides it from assistive tech, for places
 * where a link or visible text already carries the name. A server component (no hooks), so the
 * footer and not-found render it without a client reference.
 */
export function YardLogo({ className, decorative = false }: { className?: string; decorative?: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={yardLogoViewBox}
      className={cn("inline-block h-6 w-auto shrink-0 text-acid", className)}
      {...(decorative ? { "aria-hidden": true, focusable: false } : { role: "img", "aria-label": site.name })}
    >
      {decorative ? null : <title>{site.name}</title>}
      <g transform={yardLogoTransform} fill="currentColor">
        {yardLogoPaths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>
    </svg>
  )
}
