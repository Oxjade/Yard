import Image from "next/image"
import type { ImageAsset, StorefrontTemplate } from "@/lib/data/types"
import { cn } from "@/lib/utils"

/** A line of "text" in a thumbnail. */
function Bar({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={cn("absolute block rounded-[1px] bg-ink/80", className)} style={style} />
}

function Photo({ image, sizes, className }: { image: ImageAsset; sizes: string; className?: string }) {
  return (
    <span className={cn("absolute block overflow-hidden", className)}>
      <Image src={image.src} alt="" fill sizes={sizes} unoptimized={image.src.startsWith("/api/")} className="object-cover" />
    </span>
  )
}

/**
 * A miniature of each template's opening screen, drawn with the brand's own cover and
 * accent, so the choice reads as a layout rather than a name. `sizes` is the thumbnail's own
 * width: the default fits a two-column grid in the editor's side panel (full width below lg).
 */
export function TemplateThumb({
  template,
  cover,
  accent,
  sizes = "(min-width: 1024px) 160px, 50vw",
}: {
  template: StorefrontTemplate
  cover: ImageAsset
  accent: string
  sizes?: string
}) {
  const acc = { backgroundColor: accent }
  return (
    <span aria-hidden className="relative block aspect-[4/3] w-full overflow-hidden rounded-[5px] bg-obsidian">
      {template === "editorial" ? (
        <>
          <Photo image={cover} sizes={sizes} className="inset-0" />
          <span className="absolute inset-0 bg-gradient-to-b from-obsidian/80 via-obsidian/10 to-obsidian" />
          <Bar className="top-[9%] right-[8%] left-[8%] h-px bg-ink/40" />
          <Bar className="top-[16%] left-[8%] h-[16%] w-[70%] bg-ink" />
          <Bar className="bottom-[22%] left-[8%] h-[5%] w-[38%]" />
          <Bar className="bottom-[14%] left-[8%] h-[5%] w-[28%]" />
          <Bar className="right-[8%] bottom-[12%] h-[9%] w-[22%] rounded-[2px]" style={acc} />
        </>
      ) : null}

      {template === "minimal" ? (
        <>
          <span className="absolute top-[12%] right-[7%] bottom-[12%] w-[44%] overflow-hidden rounded-[3px]">
            <Image src={cover.src} alt="" fill sizes={sizes} loading="eager" unoptimized={cover.src.startsWith("/api/")} className="object-cover" />
          </span>
          <Bar className="top-[18%] left-[8%] size-[9%] rounded-[2px] border border-ink/30 bg-transparent" />
          <Bar className="top-[40%] left-[8%] h-[9%] w-[34%] bg-ink" />
          <Bar className="top-[55%] left-[8%] h-[3.5%] w-[30%] bg-ink/45" />
          <Bar className="top-[61%] left-[8%] h-[3.5%] w-[24%] bg-ink/45" />
          <Bar className="bottom-[14%] left-[8%] h-[8%] w-[16%] rounded-[2px]" style={acc} />
        </>
      ) : null}

      {template === "street" ? (
        <>
          <Photo image={cover} sizes={sizes} className="inset-x-0 top-0 h-[64%] grayscale-[0.35]" />
          <span className="absolute inset-x-0 top-0 h-[64%] bg-gradient-to-t from-obsidian via-obsidian/40 to-obsidian/30" />
          <Bar className="top-[26%] left-[6%] h-[4%] w-[30%]" style={acc} />
          <Bar className="top-[36%] left-[6%] h-[22%] w-[86%] bg-ink" />
          <span className="absolute inset-x-0 top-[64%] h-[16%] border-y-2 bg-obsidian" style={{ borderColor: accent }} />
          <Bar className="top-[69%] left-[6%] h-[6%] w-[6%] rounded-[1px] bg-ink/70" />
          <Bar className="top-[70%] left-[16%] h-[4%] w-[30%] bg-ink/45" />
          <Bar className="top-[69%] right-[6%] h-[6%] w-[18%] rounded-[1px]" style={acc} />
          <Bar className="bottom-[8%] left-[6%] h-[4%] w-[60%] bg-ink/45" />
        </>
      ) : null}

      {template === "studio" ? (
        <>
          <Bar className="top-[11%] left-[7%] size-[8%] rounded-[2px] border border-ink/30 bg-transparent" />
          <Bar className="top-[24%] left-[7%] h-[11%] w-[44%] bg-ink" />
          <Bar className="top-[24%] right-[7%] h-[3.5%] w-[32%] bg-ink/45" />
          <Bar className="top-[30%] right-[7%] h-[3.5%] w-[26%] bg-ink/45" />
          <span className="absolute top-[46%] bottom-[9%] left-[7%] w-[44%] rounded-[2px] border border-ink/15 bg-card p-[3%]">
            <span className="relative block h-full w-full overflow-hidden rounded-[1px]">
              <Image src={cover.src} alt="" fill sizes={sizes} loading="eager" unoptimized={cover.src.startsWith("/api/")} className="object-cover" />
            </span>
          </span>
          <span className="absolute top-[46%] bottom-[9%] left-[54%] w-[18%] rounded-[2px] border border-ink/15 bg-card" />
          <span className="absolute top-[46%] right-[7%] bottom-[9%] w-[18%] rounded-[2px] border border-ink/15 bg-card" />
          <Bar className="top-[41%] left-[7%] h-px w-[86%] bg-ink/20" />
          <Bar className="right-[7%] bottom-[4%] h-[2.5%] w-[8%]" style={acc} />
        </>
      ) : null}
    </span>
  )
}
