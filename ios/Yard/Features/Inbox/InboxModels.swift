import Foundation

// Inbox wire models (shopper side). Shapes from src/lib/api/contracts/inbox.ts.
// Only the fields the iOS screens use; everything the server may omit is optional/lenient.

/// `conversationSummary.brand`.
struct InboxBrandRef: Decodable, Hashable, Sendable {
    let id: String
    let handle: String
    let name: String
    let verified: Bool
    /// `mark.text`: the brand's 1–3 letter mark (monogram fallback).
    let markText: String?

    init(id: String, handle: String, name: String, verified: Bool = false, markText: String? = nil) {
        self.id = id
        self.handle = handle
        self.name = name
        self.verified = verified
        self.markText = markText
    }

    private struct Mark: Decodable { let text: String? }
    enum CodingKeys: String, CodingKey { case id, handle, name, verified, mark }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        handle = c.lenient(.handle, "")
        name = c.lenient(.name, "")
        verified = c.lenient(.verified, false)
        let mark: Mark? = c.lenientOptional(.mark)
        markText = mark?.text
    }
}

/// `conversationSummary.lastMessage`.
struct InboxLastMessage: Decodable, Hashable, Sendable {
    let preview: String
    let at: String
    /// "customer" | "brand" | "system".
    let side: String
    let held: Bool

    init(preview: String, at: String, side: String, held: Bool = false) {
        self.preview = preview
        self.at = at
        self.side = side
        self.held = held
    }

    enum CodingKeys: String, CodingKey { case preview, at, side, held }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        preview = c.lenient(.preview, "")
        at = c.lenient(.at, "")
        side = c.lenient(.side, "customer")
        held = c.lenient(.held, false)
    }
}

/// Why the composer can't send (`interaction`).
struct InboxInteraction: Decodable, Hashable, Sendable {
    let canSend: Bool
    /// "blocked_by_them" | "blocked_by_me" | "restricted" | "locked" | "brand_unavailable" | "role".
    let reason: String?
    let until: String?

    init(canSend: Bool, reason: String? = nil, until: String? = nil) {
        self.canSend = canSend
        self.reason = reason
        self.until = until
    }

    enum CodingKeys: String, CodingKey { case canSend, reason, until }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        canSend = c.lenient(.canSend, true)
        reason = c.lenientOptional(.reason)
        until = c.lenientOptional(.until)
    }
}

/// `conversationSummary` as the shopper sees it.
struct InboxConversation: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let brand: InboxBrandRef
    /// "open" | "resolved".
    let status: String
    let locked: Bool
    let lastMessage: InboxLastMessage?
    let unread: Int
    let markedUnread: Bool
    let archived: Bool
    let muted: Bool
    let blockedByMe: Bool
    let blockedByThem: Bool
    let sample: Bool
    let createdAt: String
    /// Only on single-conversation reads.
    let interaction: InboxInteraction?

    var isUnread: Bool { unread > 0 || markedUnread }
    /// Newest activity: the last message, else when it started.
    var sortAt: String { lastMessage?.at ?? createdAt }

    /// "You: …" for the shopper's own delivered messages, like the website.
    var previewText: String {
        guard let m = lastMessage else { return "No messages yet" }
        return (m.side == "customer" && !m.held ? "You: " : "") + m.preview
    }

    init(id: String, brand: InboxBrandRef, status: String = "open", locked: Bool = false, lastMessage: InboxLastMessage? = nil, unread: Int = 0, markedUnread: Bool = false, archived: Bool = false, muted: Bool = false, blockedByMe: Bool = false, blockedByThem: Bool = false, sample: Bool = false, createdAt: String = "", interaction: InboxInteraction? = nil) {
        self.id = id
        self.brand = brand
        self.status = status
        self.locked = locked
        self.lastMessage = lastMessage
        self.unread = unread
        self.markedUnread = markedUnread
        self.archived = archived
        self.muted = muted
        self.blockedByMe = blockedByMe
        self.blockedByThem = blockedByThem
        self.sample = sample
        self.createdAt = createdAt
        self.interaction = interaction
    }

    /// A copy with local read state cleared (after mark-read).
    func markingRead() -> InboxConversation {
        InboxConversation(id: id, brand: brand, status: status, locked: locked, lastMessage: lastMessage, unread: 0, markedUnread: false, archived: archived, muted: muted, blockedByMe: blockedByMe, blockedByThem: blockedByThem, sample: sample, createdAt: createdAt, interaction: interaction)
    }

    private struct Blocked: Decodable {
        let byMe: Bool?
        let byThem: Bool?
    }

    enum CodingKeys: String, CodingKey { case id, brand, status, locked, lastMessage, unread, markedUnread, archived, muted, blocked, sample, createdAt, interaction }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        brand = try c.decode(InboxBrandRef.self, forKey: .brand)
        status = c.lenient(.status, "open")
        locked = c.lenient(.locked, false)
        lastMessage = c.lenientOptional(.lastMessage)
        unread = c.lenient(.unread, 0)
        markedUnread = c.lenient(.markedUnread, false)
        archived = c.lenient(.archived, false)
        muted = c.lenient(.muted, false)
        let blocked: Blocked? = c.lenientOptional(.blocked)
        blockedByMe = blocked?.byMe ?? false
        blockedByThem = blocked?.byThem ?? false
        sample = c.lenient(.sample, false)
        createdAt = c.lenient(.createdAt, "")
        interaction = c.lenientOptional(.interaction)
    }
}

/// GET /api/inbox/conversations → `{ items, nextCursor }`.
struct InboxConversationsPage: Decodable, Sendable {
    let items: [InboxConversation]
    let nextCursor: String?

    enum CodingKeys: String, CodingKey { case items, nextCursor }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = c.lenient(.items, [])
        nextCursor = c.lenientOptional(.nextCursor)
    }
}

/// `{ conversation }` (GET/PATCH one conversation).
struct InboxConversationResponse: Decodable, Sendable {
    let conversation: InboxConversation
}

/// A money value on a card (`{ amount, currency }`, minor units).
struct InboxMoney: Decodable, Hashable, Sendable {
    let amount: Int
    let currency: String

    init(amount: Int, currency: String) {
        self.amount = amount
        self.currency = currency
    }

    enum CodingKeys: String, CodingKey { case amount, currency }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let i: Int = c.lenientOptional(.amount) {
            amount = i
        } else {
            let d: Double = c.lenient(.amount, 0)
            amount = Int(d.rounded())
        }
        currency = c.lenient(.currency, "USD")
    }

    var formatted: String { Formatters.price(minor: amount, currency: currency) }
}

/// `productCard`: a piece shared in the thread (price as it was when shared).
struct InboxProductCard: Decodable, Hashable, Sendable {
    let productId: String
    let slug: String
    let name: String
    let price: InboxMoney
    let variantLabel: String?
}

/// `orderCard`: an order attached to a message.
struct InboxOrderCard: Decodable, Hashable, Sendable {
    let orderId: String
    let reference: String
    let status: String
    let placedAt: String
    let total: InboxMoney
    let itemCount: Int

    init(orderId: String, reference: String, status: String, placedAt: String, total: InboxMoney, itemCount: Int) {
        self.orderId = orderId
        self.reference = reference
        self.status = status
        self.placedAt = placedAt
        self.total = total
        self.itemCount = itemCount
    }

    enum CodingKeys: String, CodingKey { case orderId, reference, status, placedAt, total, itemCount }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        orderId = try c.decode(String.self, forKey: .orderId)
        reference = c.lenient(.reference, "")
        status = c.lenient(.status, "")
        placedAt = c.lenient(.placedAt, "")
        total = c.lenient(.total, InboxMoney(amount: 0, currency: "USD"))
        itemCount = c.lenient(.itemCount, 0)
    }
}

/// A photo on a message: `src` is always `/api/media/<id>?as=shopper` (cookie-authorised).
struct InboxAttachment: Decodable, Hashable, Sendable {
    let mediaId: String
    let src: String
    let width: Int?
    let height: Int?

    var url: URL? { Config.url(for: src) }

    enum CodingKeys: String, CodingKey { case mediaId, src, width, height }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mediaId = c.lenient(.mediaId, "")
        src = c.lenient(.src, "")
        width = c.lenientOptional(.width)
        height = c.lenientOptional(.height)
    }
}

/// `messageDto`.
struct InboxMessage: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let seq: Int
    /// "customer" | "brand" | "system".
    let side: String
    /// "text" | "product" | "order" | "image" | "system".
    let kind: String
    /// Nil for a message Yard removed.
    let body: String?
    let product: InboxProductCard?
    let order: InboxOrderCard?
    let attachments: [InboxAttachment]
    /// "sent" | "held" | "removed" (MESSAGE_STATUSES).
    let status: String
    let safetyNotice: Bool
    let createdAt: String
    let clientId: String

    var isMine: Bool { side == "customer" }
    var isSystem: Bool { side == "system" || kind == "system" }
    var isRemoved: Bool { status == "removed" }
    var isHeld: Bool { status == "held" }
    var date: Date? { YardDate.parse(createdAt) }

    init(id: String, seq: Int, side: String, kind: String = "text", body: String?, product: InboxProductCard? = nil, order: InboxOrderCard? = nil, attachments: [InboxAttachment] = [], status: String = "sent", safetyNotice: Bool = false, createdAt: String, clientId: String = "") {
        self.id = id
        self.seq = seq
        self.side = side
        self.kind = kind
        self.body = body
        self.product = product
        self.order = order
        self.attachments = attachments
        self.status = status
        self.safetyNotice = safetyNotice
        self.createdAt = createdAt
        self.clientId = clientId
    }

    enum CodingKeys: String, CodingKey { case id, seq, side, kind, body, product, order, attachments, status, safetyNotice, createdAt, clientId }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        seq = c.lenient(.seq, 0)
        side = c.lenient(.side, "brand")
        kind = c.lenient(.kind, "text")
        body = c.lenientOptional(.body)
        product = c.lenientOptional(.product)
        order = c.lenientOptional(.order)
        attachments = c.lenient(.attachments, [])
        status = c.lenient(.status, "sent")
        safetyNotice = c.lenient(.safetyNotice, false)
        createdAt = c.lenient(.createdAt, "")
        clientId = c.lenient(.clientId, "")
    }
}

/// GET /api/inbox/conversations/{id}/messages → `threadDto`.
struct InboxThread: Decodable, Sendable {
    let conversation: InboxConversation
    let messages: [InboxMessage]
    let hasMore: Bool

    enum CodingKeys: String, CodingKey { case conversation, messages, hasMore }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        conversation = try c.decode(InboxConversation.self, forKey: .conversation)
        messages = c.lenient(.messages, [])
        hasMore = c.lenient(.hasMore, false)
    }
}

/// GET /api/inbox/conversations/by-brand/{brandId}.
struct InboxByBrand: Decodable, Sendable {
    let conversation: InboxConversation?
    let canMessage: Bool
    /// "blocked" | "blocked_by_me" | "restricted" | "brand_unavailable".
    let reason: String?
    let until: String?

    enum CodingKeys: String, CodingKey { case conversation, canMessage, reason, until }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        conversation = c.lenientOptional(.conversation)
        canMessage = c.lenient(.canMessage, true)
        reason = c.lenientOptional(.reason)
        until = c.lenientOptional(.until)
    }

    /// The composer state for a new thread (by-brand's "blocked" is the thread's "blocked_by_them").
    var interaction: InboxInteraction {
        if canMessage { return InboxInteraction(canSend: true) }
        return InboxInteraction(canSend: false, reason: reason == "blocked" ? "blocked_by_them" : reason, until: until)
    }
}

/// POST /api/inbox/messages → 201 `{ message, conversation }`.
struct InboxSendResult: Decodable, Sendable {
    let message: InboxMessage
    let conversation: InboxConversation
}

/// POST /api/inbox/messages body (strict on the server: only these keys).
struct InboxSendBody: Encodable, Sendable {
    var conversationId: String?
    var brandId: String?
    var clientId: String
    /// "text" | "image" (product/order sharing is web-only for now).
    var kind: String
    var body: String?
    var attachmentIds: [String]?
    /// "inbox" | "product" | "order" — only with brandId (new conversation).
    var origin: String?

    // Encode only the keys that are set: the server's schema is strict and rejects nulls.
    enum CodingKeys: String, CodingKey { case conversationId, brandId, clientId, kind, body, attachmentIds, origin }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(conversationId, forKey: .conversationId)
        try c.encodeIfPresent(brandId, forKey: .brandId)
        try c.encode(clientId, forKey: .clientId)
        try c.encode(kind, forKey: .kind)
        try c.encodeIfPresent(body, forKey: .body)
        try c.encodeIfPresent(attachmentIds, forKey: .attachmentIds)
        try c.encodeIfPresent(origin, forKey: .origin)
    }
}

/// PATCH /api/inbox/conversations/{id} `{ archived?, muted? }`.
struct InboxPatchBody: Encodable, Sendable {
    var archived: Bool?
    var muted: Bool?

    enum CodingKeys: String, CodingKey { case archived, muted }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(archived, forKey: .archived)
        try c.encodeIfPresent(muted, forKey: .muted)
    }
}

/// POST /api/inbox/conversations/{id}/read `{ upToSeq }` → 204.
struct InboxReadBody: Encodable, Sendable {
    let upToSeq: Int
}

/// POST /api/inbox/blocks `{ brandId }` (DELETE with the same body unblocks).
struct InboxBlockBody: Encodable, Sendable {
    let brandId: String
}

/// POST /api/uploads → 201 `{ media: { id, src, … } }`.
struct InboxUploadResult: Decodable, Sendable {
    struct Media: Decodable, Sendable {
        let id: String
        let src: String?
    }
    let media: Media
}

/// GET /api/inbox/unread → `{ conversations }`.
struct InboxUnreadCount: Decodable, Sendable {
    let conversations: Int
}
