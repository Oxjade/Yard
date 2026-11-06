import { z } from "zod"
import { auditEntryDto } from "./common"

/** Admin contracts (F1 draft; cluster M owns this file in wave 2, §8). Decisions return a DTO plus their audit entry, never a row. */
export const decisionBase = z.object({ id: z.string().min(1).max(80), reason: z.string().min(8, { error: "Give a reason of at least 8 characters." }).max(500) })

export const queueCountsDto = z.object({
  messages: z.number().optional(),
  content: z.number().optional(),
  places: z.number().optional(),
  charts: z.number().optional(),
  delivery: z.number().optional(),
  abuse: z.number().optional(),
})
export type QueueCountsDto = z.infer<typeof queueCountsDto>

export const decisionResult = z.object({ item: z.unknown(), audit: auditEntryDto })

export const setUserStatusBody = decisionBase.extend({ status: z.enum(["active", "restricted", "suspended"]) }).strict()
export const setBrandStatusBody = decisionBase.extend({ status: z.enum(["pending_review", "verified", "restricted", "suspended"]) }).strict()

export const auditQuery = z.object({ subjectType: z.string().max(40).optional(), subjectId: z.string().max(80).optional(), cursor: z.string().max(200).optional() })
export const auditListResult = z.object({ items: z.array(auditEntryDto), nextCursor: z.string().nullable() })
