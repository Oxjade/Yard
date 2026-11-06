import "server-only"
import type { Actor } from "../auth/dal"
import { NotImplemented } from "../http/errors"

/** Frozen, bounded evidence (§5.3): a message plus 5 before and 2 after, the last 8 of a conversation, or a post/place's public fields. */
export async function buildSnapshot(actor: Actor, subjectType: string, subjectId: string): Promise<Record<string, unknown>> {
  void actor
  void subjectType
  void subjectId
  throw new NotImplemented("reports.buildSnapshot")
}
