"use client"

import { useEffect } from "react"
import { reportSignal } from "./report-signal"

/**
 * Counts a product or storefront view for Charts (§6.3): once per mount (and per item), after the
 * page has been visible for 1 s, so a prefetch, a background tab or a quick bounce doesn't count.
 * Renders nothing. The server dedupes views per visitor, item and day, and anonymous visitors
 * count only once their yard_anon cookie is established.
 */
type Props = { kind: "product_view"; productId: string; brandId?: never } | { kind: "storefront_view"; brandId: string; productId?: never }

export function ViewBeacon(props: Props) {
  const { kind } = props
  const productId = props.kind === "product_view" ? props.productId : undefined
  const brandId = props.kind === "storefront_view" ? props.brandId : undefined
  useEffect(() => {
    let sent = false
    let timer: number | null = null
    const arm = () => {
      if (sent || timer !== null || document.visibilityState !== "visible") return
      timer = window.setTimeout(() => {
        timer = null
        if (sent || document.visibilityState !== "visible") return
        sent = true
        reportSignal(kind === "product_view" ? { kind, productId } : { kind, brandId })
      }, 1000)
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") arm()
      else if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
    }
    arm()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [kind, productId, brandId])
  return null
}
