import "server-only"
import type { Actor } from "../auth/dal"
import { NotImplemented } from "../http/errors"

export type ReportInput = { subjectType: "message" | "conversation" | "social_post" | "location" | "location_event"; subjectId: string; reason: string; details?: string }

/** POST /api/reports?as= (F2, §5.3): validates visibility, freezes the snapshot, notifies admins by permission. */
export async function createReport(actor: Actor, input: ReportInput): Promise<{ id: string; status: string }> {
  void actor
  void input
  throw new NotImplemented("reports.createReport")
}
