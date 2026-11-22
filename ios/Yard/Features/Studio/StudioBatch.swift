import Foundation

// One-tap batches in Studio (docs/APP.md › Studio in the app › Suggestions from Yard (Accept all)
// and New from your website › Add all): the request body, the result, the idempotency key that a
// retry reuses, the suggestions list and the copy. Pure, so it is unit-tested.

// MARK: - Body and result

/// `{ ids?, reason?, idempotencyKey }`. The server's bodies are strict: `ids` and `reason` are left
/// out when nil (omitting `ids` means every waiting item).
struct StudioBatchBody: Encodable, Equatable, Sendable {
    let ids: [String]?
    let reason: String?
    let idempotencyKey: String

    init(ids: [String]?, reason: String? = nil, idempotencyKey: String) {
        self.ids = ids
        self.reason = reason
        self.idempotencyKey = idempotencyKey
    }

    enum CodingKeys: String, CodingKey { case ids, reason, idempotencyKey }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        if let ids, !ids.isEmpty { try c.encode(ids, forKey: .ids) }
        if let reason, !reason.isEmpty { try c.encode(reason, forKey: .reason) }
        try c.encode(idempotencyKey, forKey: .idempotencyKey)
    }
}

/// One item a batch couldn't take, with the sentence to show next to it.
struct StudioBatchSkip: Decodable, Hashable, Sendable {
    let id: String
    let reason: String

    enum CodingKeys: String, CodingKey { case id, reason }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        reason = c.lenient(.reason, "This one couldn't be done. Try it on its own.")
    }

    init(id: String, reason: String) {
        self.id = id
        self.reason = reason
    }
}

/// `{ accepted: string[], skipped: [{ id, reason }], replayed?: true }` (decline-all lists the
/// declined ids under `accepted`).
struct StudioBatchResult: Decodable, Equatable, Sendable {
    let accepted: [String]
    let skipped: [StudioBatchSkip]
    /// True when the server answered a retried key with the first run's result.
    let replayed: Bool

    init(accepted: [String], skipped: [StudioBatchSkip], replayed: Bool = false) {
        self.accepted = accepted
        self.skipped = skipped
        self.replayed = replayed
    }

    enum CodingKeys: String, CodingKey { case accepted, skipped, replayed }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        accepted = c.lenient(.accepted, [String]())
        skipped = c.lenient(.skipped, LenientArray<StudioBatchSkip>()).items
        replayed = c.lenient(.replayed, false)
    }

    /// Skip reasons by id.
    var reasons: [String: String] {
        var out: [String: String] = [:]
        for s in skipped { out[s.id] = s.reason }
        return out
    }
}

/// Add all answers with the refreshed website-pieces list plus the batch result.
struct StudioWebsiteBatchResult: Decodable, Sendable {
    let pieces: StudioSitePieces
    let batch: StudioBatchResult

    init(from decoder: Decoder) throws {
        pieces = try StudioSitePieces(from: decoder)
        batch = try StudioBatchResult(from: decoder)
    }
}

// MARK: - Idempotency key

/// The key for one tap. A retry of the same request (same action, same items) after an answer we
/// never saw (dropped connection, timeout, 5xx) reuses it, so the server replays the first result
/// instead of running twice. A clear answer (success or a 4xx) ends it; the next tap gets a new one.
struct StudioBatchKeys: Sendable {
    private(set) var pendingSignature: String?
    private(set) var pendingKey: String?

    init() {}

    /// 32 characters of `0-9 A-F` (a UUID without dashes): inside the server's 8–80 `[A-Za-z0-9_-]`.
    static func fresh() -> String {
        UUID().uuidString.replacingOccurrences(of: "-", with: "")
    }

    /// What identifies a request: the action, the items (order doesn't matter; nil = all) and the reason.
    static func signature(action: String, ids: [String]?, reason: String? = nil) -> String {
        let items = ids.map { $0.sorted().joined(separator: ",") } ?? "*"
        return "\(action)|\(items)|\(reason ?? "")"
    }

    /// The key to send: the pending one when this is a retry of the same request, else a fresh one.
    mutating func key(for signature: String, make: () -> String = StudioBatchKeys.fresh) -> String {
        if let existing = pendingKey, pendingSignature == signature { return existing }
        let next = make()
        pendingSignature = signature
        pendingKey = next
        return next
    }

    /// Call with the outcome: nil (success) or a definite error ends the key; an uncertain one keeps it.
    mutating func settle(_ error: Error?) {
        if let error, Self.isUncertain(error) { return }
        pendingSignature = nil
        pendingKey = nil
    }

    /// The request may have run on the server without us seeing the answer.
    static func isUncertain(_ error: Error) -> Bool {
        guard let api = error as? APIError else { return true }
        return api.status <= 0 || api.status >= 500
    }
}

// MARK: - Suggestions from Yard

struct StudioProposal: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    /// "new" | "edit".
    let kind: String
    let status: String
    let title: String
    let cover: String?
    let note: String?
    let createdAt: String

    var isNew: Bool { kind == "new" }
    var coverURL: URL? { Config.url(for: cover) }

    init(id: String, kind: String, status: String = "pending", title: String, cover: String? = nil, note: String? = nil, createdAt: String = "") {
        self.id = id
        self.kind = kind
        self.status = status
        self.title = title
        self.cover = cover
        self.note = note
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey { case id, kind, status, title, cover, note, createdAt }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = c.lenient(.kind, "new")
        status = c.lenient(.status, "pending")
        title = c.lenient(.title, "")
        cover = c.lenientOptional(.cover)
        note = c.lenientOptional(.note)
        createdAt = c.lenient(.createdAt, "")
    }
}

/// `GET /api/studio/proposals?status=pending` → `{ items, total, counts: { pending, … }, nextOffset }`.
struct StudioProposalList: Decodable, Sendable {
    let items: [StudioProposal]
    let total: Int
    let pendingCount: Int

    private struct Counts: Decodable { let pending: Int? }

    enum CodingKeys: String, CodingKey { case items, total, counts }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        items = c.lenient(.items, LenientArray<StudioProposal>()).items
        total = c.lenient(.total, items.count)
        let counts: Counts? = c.lenientOptional(.counts)
        pendingCount = counts?.pending ?? items.filter { $0.status == "pending" }.count
    }

    var pending: [StudioProposal] { items.filter { $0.status == "pending" } }
}

// MARK: - Copy

enum StudioBatchCopy {
    /// The Home to-do and the Products card (the website's `preparedLine`).
    static func preparedLine(_ n: Int, allNew: Bool) -> String {
        if allNew {
            return "Yard prepared \(n) \(n == 1 ? "product" : "products") for you. Accept \(n == 1 ? "it" : "all") in one tap"
        }
        return "Yard has \(n) \(n == 1 ? "suggestion" : "suggestions") for you. Accept \(n == 1 ? "it" : "all") in one tap"
    }

    /// The first half of `preparedLine`: "Yard prepared 5 products for you" (Home's card and to-do).
    static func preparedTitle(_ n: Int, allNew: Bool) -> String {
        allNew
            ? "Yard prepared \(n) \(n == 1 ? "product" : "products") for you"
            : "Yard has \(n) \(n == 1 ? "suggestion" : "suggestions") for you"
    }

        static func acceptAll(_ n: Int) -> String { "Accept all (\(n))" }
    static func addAll(_ n: Int) -> String { "Add all (\(n))" }

    /// The toast after a batch: "Accepted 4. 1 needs a look below."
    static func result(_ verb: String, _ r: StudioBatchResult) -> String {
        let done = r.accepted.count
        let left = r.skipped.count
        let head = done > 0 ? "\(verb) \(done)." : "Nothing \(verb.lowercased())."
        guard left > 0 else { return head }
        return "\(head) \(left) \(left == 1 ? "needs" : "need") a look below."
    }
}
