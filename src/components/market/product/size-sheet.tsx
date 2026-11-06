"use client"

import { PhoneSheet } from "../catalog/phone-sheet"

/**
 * The phone size sheet, opened from the floating add-to-bag bar. The same bottom sheet as the
 * listing's filters (catalog/phone-sheet.tsx): a handle that drags it away, a display title,
 * the choices and a footer action.
 */
export function SizeSheet({
  open,
  onOpenChange,
  title,
  titleId,
  description,
  children,
  footer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Id on the visible title text, so the size radio group inside can be labelled by it. */
  titleId: string
  description: string
  children: React.ReactNode
  footer: React.ReactNode
}) {
  return (
    <PhoneSheet
      open={open}
      onOpenChange={onOpenChange}
      closeLabel="Close size selection"
      title={<span id={titleId}>{title}</span>}
      description={description}
      footerClassName="grid gap-3"
      footer={footer}
    >
      {children}
    </PhoneSheet>
  )
}
