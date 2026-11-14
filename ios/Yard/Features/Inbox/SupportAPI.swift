import Foundation

// Yard Support: the signed-in shopper's one conversation with Yard's own team
// (src/app/api/support/**, src/server/support/service.ts, docs/APP.md "Yard Support").
// The server answers in the inbox's own DTOs (`ConversationSummary`, `ThreadDto`, `MessageDto`,
// `SendResult`), so the inbox models decode them: `conversation.kind == "support"`,
// `conversation.brand` is always Yard Support, and Yard's messages have `side: "support"`.

/// GET /api/support/conversation → `{ conversation: ConversationSummary | null }`.
struct SupportConversationResponse: Decodable, Sendable {
    let conversation: InboxConversation?

    enum CodingKeys: String, CodingKey { case conversation }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        conversation = c.lenientOptional(.conversation)
    }
}

/// POST /api/support/messages body (strict on the server: only these keys, no nulls).
struct SupportSendBody: Encodable, Sendable {
    var clientId: String
    /// "text" | "image" | "order".
    var kind: String
    var body: String?
    /// kind "image" only: 1–4 media ids from POST /api/uploads.
    var attachmentIds: [String]?
    /// kind "order" only: one of the shopper's own orders (`mo_…`).
    var orderRefId: String?

    enum CodingKeys: String, CodingKey { case clientId, kind, body, attachmentIds, orderRefId }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(clientId, forKey: .clientId)
        try c.encode(kind, forKey: .kind)
        try c.encodeIfPresent(body, forKey: .body)
        try c.encodeIfPresent(attachmentIds, forKey: .attachmentIds)
        try c.encodeIfPresent(orderRefId, forKey: .orderRefId)
    }
}

/// An order attached to the next support message ("Get help from Yard" on an order).
struct SupportOrderChip: Hashable, Sendable {
    let orderId: String
    let reference: String
}

enum SupportAPI {
    /// GET /api/support/conversation. Nil until the first message creates the thread.
    static func conversation() async throws -> InboxConversation? {
        let r = try await APIClient.shared.get("/api/support/conversation", as: SupportConversationResponse.self)
        return r.conversation
    }

    /// GET /api/support/conversation/messages?before=&after=&limit= (404 before the first message).
    static func thread(before: Int? = nil, after: Int? = nil, limit: Int = 50) async throws -> InboxThread {
        var items: [URLQueryItem] = [URLQueryItem(name: "limit", value: String(limit))]
        if let before { items.append(URLQueryItem(name: "before", value: String(before))) }
        if let after { items.append(URLQueryItem(name: "after", value: String(after))) }
        return try await APIClient.shared.get("/api/support/conversation/messages", query: items, as: InboxThread.self)
    }

    /// POST /api/support/messages → 201 (new) / 200 (same clientId retried) `SendResult`.
    static func send(_ body: SupportSendBody) async throws -> InboxSendResult {
        try await APIClient.shared.post("/api/support/messages", body: body, as: InboxSendResult.self)
    }

    /// POST /api/support/conversation/read { upToSeq } → 204.
    static func markRead(upToSeq: Int) async throws {
        try await APIClient.shared.send(.post, "/api/support/conversation/read", body: InboxReadBody(upToSeq: max(0, upToSeq)))
    }
}
