import "server-only"
import { NotImplemented } from "../http/errors"

/** Inbox contract (F1 draft; cluster I replaces the bodies and IMPL in wave 2). */
export const IMPL: string = "stub"

/** A centred system line in a conversation ("This conversation was closed by Yard."). */
export async function publishSystemNotice(conversationId: string, text: string): Promise<void> {
  void conversationId
  void text
  throw new NotImplemented("inbox.publishSystemNotice")
}

/** M's release-held-message: delivers a held message as if just sent (§6.2 steps 9–12). */
export async function releaseHeldMessage(messageId: string): Promise<void> {
  void messageId
  throw new NotImplemented("inbox.releaseHeldMessage")
}

export const jobs = {}
