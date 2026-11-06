"use client"

import { useState } from "react"

/**
 * Open state for a tooltip that only shows on the collapsed rail. While the panel is expanded
 * the tooltip is held shut, and Radix then never reports the close of an open it reported
 * (hover or keyboard focus), so a remembered open would pop the tooltip up on its own after
 * the next collapse. Opens are only recorded while collapsed, and the state clears whenever
 * the panel changes width.
 */
export function useRailTip(collapsed: boolean) {
  const [tip, setTip] = useState(false)
  const [was, setWas] = useState(collapsed)
  if (was !== collapsed) {
    setWas(collapsed)
    setTip(false)
  }
  return [collapsed && tip, (open: boolean) => setTip(open && collapsed)] as const
}
