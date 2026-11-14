import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { conversationSummary, messageDto, YARD_SUPPORT } from "./inbox"
import { adminSupportPatchBody, adminSupportQuery, adminSupportSendBody, studioSupportSendBody, supportSendBody } from "./support"

describe("Yard Support contracts", () => {
  it("accepts a shopper's text, photo and order messages", () => {
    assert.equal(supportSendBody.safeParse({ clientId: "abcdefgh", kind: "text", body: "Hi" }).success, true)
    assert.equal(supportSendBody.safeParse({ clientId: "abcdefgh", kind: "image", attachmentIds: ["med_1"] }).success, true)
    assert.equal(supportSendBody.safeParse({ clientId: "abcdefgh", kind: "order", orderRefId: "or_1", body: "Where is it?" }).success, true)
  })

  it("refuses unknown fields, a short clientId, too many photos and long bodies", () => {
    assert.equal(supportSendBody.safeParse({ clientId: "abcdefgh", kind: "text", body: "Hi", brandId: "b_1" }).success, false)
    assert.equal(supportSendBody.safeParse({ clientId: "short", kind: "text", body: "Hi" }).success, false)
    assert.equal(supportSendBody.safeParse({ clientId: "abcdefgh", kind: "image", attachmentIds: ["1", "2", "3", "4", "5"] }).success, false)
    assert.equal(supportSendBody.safeParse({ clientId: "abcdefgh", kind: "text", body: "x".repeat(2001) }).success, false)
  })

  it("keeps brands to text and photos, and admins to text", () => {
    assert.equal(studioSupportSendBody.safeParse({ clientId: "abcdefgh", kind: "order", orderRefId: "or_1" }).success, false)
    assert.equal(studioSupportSendBody.safeParse({ clientId: "abcdefgh", kind: "text", body: "Hi" }).success, true)
    assert.deepEqual(adminSupportSendBody.parse({ clientId: "abcdefgh", body: "Hello" }), { clientId: "abcdefgh", kind: "text", body: "Hello" })
    assert.equal(adminSupportSendBody.safeParse({ clientId: "abcdefgh", kind: "image", body: "x" }).success, false)
  })

  it("reads queue filters and patches", () => {
    assert.equal(adminSupportQuery.parse({}).filter, "open")
    assert.equal(adminSupportQuery.safeParse({ filter: "spam" }).success, false)
    assert.equal(adminSupportPatchBody.safeParse({ status: "resolved", assignee: "me" }).success, true)
    assert.equal(adminSupportPatchBody.safeParse({ assignee: null }).success, true)
    assert.equal(adminSupportPatchBody.safeParse({ assignee: "adm_2" }).success, false)
  })

  it("lets inbox DTOs carry a support thread and Yard Support's messages", () => {
    const summary = conversationSummary.parse({
      id: "cv_1",
      kind: "support",
      brand: YARD_SUPPORT,
      status: "open",
      spamState: "none",
      locked: false,
      lastMessage: { preview: "Hi", at: "2026-11-14T10:00:00.000Z", side: "support" },
      unread: 1,
      markedUnread: false,
      archived: false,
      muted: false,
      blocked: { byMe: false, byThem: false },
      sample: false,
      createdAt: "2026-11-14T09:00:00.000Z",
    })
    assert.equal(summary.kind, "support")
    // A brand conversation from an older client without `kind` still reads as one.
    const { kind: _kind, ...older } = summary
    void _kind
    assert.equal(conversationSummary.parse({ ...older, lastMessage: null }).kind, "brand")
    const m = messageDto.parse({ id: "msg_1", seq: 1, conversationId: "cv_1", side: "support", kind: "text", body: "Hello", attachments: [], status: "sent", createdAt: "2026-11-14T10:00:00.000Z", clientId: "abcdefgh" })
    assert.equal(m.side, "support")
  })
})
