"use client"

import { useCallback, useLayoutEffect, useRef } from "react"
import Image, { type ImageProps } from "next/image"

/**
 * next/image that fades in once the photograph has loaded, over whatever placeholder sits
 * behind it (the card's surface colour), instead of painting in top to bottom.
 *
 * Never hides a picture that is already there: server HTML and pages without JavaScript show
 * images straight away, and an image that finished loading before hydration (cached, or simply
 * fast) is left alone. Only an image still loading when this mounts, or after its src changes,
 * waits transparent and then fades (globals.css, `img[data-fade]`). The fade is an animation,
 * so the caller's own transition and opacity classes keep working; reduced motion makes it
 * instant. A failed load is shown as the browser shows it, never left invisible. Images marked
 * `preload` (or the older `priority`) skip the fade.
 */
export function FadeImage({ alt, onLoad, onError, ref, ...props }: ImageProps & { ref?: React.Ref<HTMLImageElement> }) {
  const node = useRef<HTMLImageElement | null>(null)
  const setRef = useCallback(
    (el: HTMLImageElement | null) => {
      node.current = el
      if (typeof ref === "function") ref(el)
      else if (ref) (ref as React.RefObject<HTMLImageElement | null>).current = el
    },
    [ref],
  )
  // Above-the-fold images the page preloads are never held back: they are the largest paint.
  const eager = !!(props.preload || props.priority)
  const src = typeof props.src === "string" ? props.src : "src" in props.src ? props.src.src : props.src.default.src

  // Before paint: an image still on its way waits transparent. Set on the element directly (not
  // React state), so hydration never sees an attribute it didn't render.
  useLayoutEffect(() => {
    const img = node.current
    if (!img || eager) return
    if (img.complete && img.naturalWidth > 0) {
      if (img.dataset.fade === "pending") img.dataset.fade = "in"
      return
    }
    img.dataset.fade = "pending"
  }, [src, eager])

  return (
    <Image
      {...props}
      alt={alt}
      ref={setRef}
      onLoad={(e) => {
        if (e.currentTarget.dataset.fade === "pending") e.currentTarget.dataset.fade = "in"
        onLoad?.(e)
      }}
      onError={(e) => {
        delete e.currentTarget.dataset.fade
        onError?.(e)
      }}
    />
  )
}
