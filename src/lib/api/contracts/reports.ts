import { z } from "zod"
import { REPORT_SUBJECTS } from "./enums"

/**
 * POST /api/reports?as=shopper|brand (F2, §5.3). The reasons per subject type are the same list
 * ReportSheet shows. Draft by F1.
 */
export const reportSubject = z.enum(REPORT_SUBJECTS)
export type ReportSubject = z.infer<typeof reportSubject>

export const REPORT_REASONS = {
  message: ["spam", "scam_or_offplatform_payment", "harassment", "hate", "sexual_content", "counterfeit", "other"],
  conversation: ["spam", "scam_or_offplatform_payment", "harassment", "hate", "sexual_content", "counterfeit", "other"],
  social_post: ["misleading", "counterfeit", "ip_infringement", "offensive", "other"],
  location: ["wrong_location", "closed_or_not_real", "unsafe", "misleading", "other"],
  location_event: ["wrong_location", "closed_or_not_real", "unsafe", "misleading", "other"],
} as const satisfies Record<ReportSubject, readonly string[]>

export type ReportReason = (typeof REPORT_REASONS)[ReportSubject][number]

/** What each reason says to a person (sentence case; the admin queue uses the same words). */
export const reportReasonLabels: Record<string, { label: string; hint?: string }> = {
  spam: { label: "Spam", hint: "Repeated or unwanted messages." },
  scam_or_offplatform_payment: { label: "Scam or payment outside Yard", hint: "Asks you to pay outside checkout or by bank transfer, gift card or crypto." },
  harassment: { label: "Harassment", hint: "Insults, threats or unwanted pressure." },
  hate: { label: "Hate", hint: "Attacks people for who they are." },
  sexual_content: { label: "Sexual content" },
  counterfeit: { label: "Counterfeit", hint: "Fakes of another brand's products." },
  misleading: { label: "Misleading", hint: "False claims about a product, price or event." },
  ip_infringement: { label: "Uses my work without permission", hint: "Your photos, designs or trademark." },
  offensive: { label: "Offensive" },
  wrong_location: { label: "Wrong location", hint: "The pin or address is in the wrong place." },
  closed_or_not_real: { label: "Closed or not real", hint: "The place has closed or doesn't exist." },
  unsafe: { label: "Unsafe", hint: "Something about this place puts people at risk." },
  other: { label: "Something else" },
}

export const reportSubjectLabels: Record<ReportSubject, string> = {
  message: "message",
  conversation: "conversation",
  social_post: "post",
  location: "place",
  location_event: "event",
}

export const reportBody = z
  .object({
    subjectType: reportSubject,
    subjectId: z.string().min(1).max(80),
    reason: z.string().min(1).max(40),
    details: z.string().max(1000, { error: "Keep the details to 1,000 characters." }).optional(),
  })
  .strict()
  .refine((b) => (REPORT_REASONS[b.subjectType] as readonly string[]).includes(b.reason), { path: ["reason"], error: "Choose one of the reasons." })
export type ReportBody = z.infer<typeof reportBody>

export const reportResult = z.object({ report: z.object({ id: z.string(), status: z.enum(["open", "in_review", "actioned", "dismissed", "escalated"]), createdAt: z.string() }) })
export type ReportResult = z.infer<typeof reportResult>
