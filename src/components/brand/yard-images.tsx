import { ImageResponse } from "next/og"
import { site } from "@/config/site"
import { yardLogoAspect, yardLogoSvg } from "./yard-logo-paths"

/**
 * The generated brand images: the app icons (src/app/icon.tsx, apple-icon.tsx) and the share
 * image (opengraph-image.tsx, twitter-image.tsx). The colours are the app's own tokens, written
 * out because the image renderer reads no CSS: obsidian (--color-obsidian) behind, the logo in
 * acid (--color-acid). Never the trace's original green.
 */
const obsidian = "#080808"
const acid = "#f5ff00"
const ink3 = "#858585"

const logoSrc = `data:image/svg+xml;utf8,${encodeURIComponent(yardLogoSvg(acid))}`

function Logo({ width }: { width: number }) {
  const height = Math.round(width / yardLogoAspect)
  // eslint-disable-next-line @next/next/no-img-element -- the image renderer draws <img>, not next/image
  return <img src={logoSrc} width={width} height={height} alt={site.name} />
}

/**
 * The square mark: the logo is too wide for a square, so it sits acid on an obsidian square,
 * scaled to its width with padding. Small icons give the logo a larger share of the square so
 * the letters stay legible in a browser tab.
 */
export function yardIconImage(size: number) {
  const share = size <= 48 ? 0.9 : 0.74
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: obsidian }}>
        <Logo width={Math.round(size * share)} />
      </div>
    ),
    { width: size, height: size },
  )
}

export const shareImageSize = { width: 1200, height: 630 }
export const shareImageAlt = `${site.name} — ${site.tagline}`

/** The share image: the logo in acid on obsidian, the tagline under it. */
export function yardShareImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: obsidian }}>
        <Logo width={560} />
        <div style={{ marginTop: 40, fontSize: 34, color: ink3, letterSpacing: "-0.01em" }}>{site.tagline}</div>
      </div>
    ),
    shareImageSize,
  )
}
