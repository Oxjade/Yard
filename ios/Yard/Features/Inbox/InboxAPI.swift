import Foundation

/// The shopper inbox endpoints (src/app/api/inbox/**, src/app/api/uploads).
enum InboxAPI {
    /// Which list the inbox shows (`filter` on GET /api/inbox/conversations).
    enum Filter: String, CaseIterable, Hashable, Sendable {
        case inbox
        case archived
        case blocked

        var title: String {
            switch self {
            case .inbox: return "Inbox"
            case .archived: return "Archived"
            case .blocked: return "Blocked"
            }
        }

        var systemImage: String {
            switch self {
            case .inbox: return "tray"
            case .archived: return "archivebox"
            case .blocked: return "nosign"
            }
        }
    }

    private static func encoded(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
    }

    /// GET /api/inbox/conversations?q=&filter=blocked|archived&cursor=
    static func conversations(filter: Filter, query: String, cursor: String?) async throws -> InboxConversationsPage {
        var items: [URLQueryItem] = []
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !q.isEmpty { items.append(URLQueryItem(name: "q", value: String(q.prefix(100)))) }
        if filter != .inbox { items.append(URLQueryItem(name: "filter", value: filter.rawValue)) }
        if let cursor { items.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await APIClient.shared.get("/api/inbox/conversations", query: items, as: InboxConversationsPage.self)
    }

    /// GET /api/inbox/conversations/{id}/messages?before=&after=&limit=
    static func thread(id: String, before: Int? = nil, after: Int? = nil, limit: Int = 50) async throws -> InboxThread {
        var items: [URLQueryItem] = [URLQueryItem(name: "limit", value: String(limit))]
        if let before { items.append(URLQueryItem(name: "before", value: String(before))) }
        if let after { items.append(URLQueryItem(name: "after", value: String(after))) }
        return try await APIClient.shared.get("/api/inbox/conversations/\(encoded(id))/messages", query: items, as: InboxThread.self)
    }

    /// GET /api/inbox/conversations/by-brand/{brandId}
    static func byBrand(brandId: String) async throws -> InboxByBrand {
        try await APIClient.shared.get("/api/inbox/conversations/by-brand/\(encoded(brandId))", as: InboxByBrand.self)
    }

    /// POST /api/inbox/messages
    static func send(_ body: InboxSendBody) async throws -> InboxSendResult {
        try await APIClient.shared.post("/api/inbox/messages", body: body, as: InboxSendResult.self)
    }

    /// POST /api/inbox/conversations/{id}/read { upToSeq } → 204
    static func markRead(id: String, upToSeq: Int) async throws {
        try await APIClient.shared.send(.post, "/api/inbox/conversations/\(encoded(id))/read", body: InboxReadBody(upToSeq: max(0, upToSeq)))
    }

    /// Mark read from the list, where the row doesn't carry the last seq: read the newest message first.
    static func markReadLatest(id: String) async throws {
        let t = try await thread(id: id, limit: 1)
        let seq = t.messages.map(\.seq).max() ?? 0
        try await markRead(id: id, upToSeq: seq)
    }

    /// PATCH /api/inbox/conversations/{id} { archived?, muted? }
    static func patch(id: String, archived: Bool? = nil, muted: Bool? = nil) async throws -> InboxConversation {
        let r = try await APIClient.shared.patch("/api/inbox/conversations/\(encoded(id))", body: InboxPatchBody(archived: archived, muted: muted), as: InboxConversationResponse.self)
        return r.conversation
    }

    /// POST (block) / DELETE (unblock) /api/inbox/blocks { brandId }
    static func setBlocked(_ on: Bool, brandId: String) async throws {
        try await APIClient.shared.send(on ? .post : .delete, "/api/inbox/blocks", body: InboxBlockBody(brandId: brandId))
    }

    /// GET /api/catalog/storefronts/{handle or brand id} (public): the brand's name, handle and logo.
    static func brand(idOrHandle: String) async throws -> StorefrontBrand {
        let s = try await APIClient.shared.get("/api/catalog/storefronts/\(encoded(idOrHandle))", as: PublicStorefront.self)
        return s.brand
    }

    /// GET /api/catalog/products?ids=…: one batched read for the photos of shared product cards.
    static func products(ids: [String]) async throws -> [Product] {
        let unique = Array(Set(ids)).prefix(60)
        guard !unique.isEmpty else { return [] }
        var items: [URLQueryItem] = unique.map { URLQueryItem(name: "ids", value: $0) }
        items.append(URLQueryItem(name: "limit", value: String(min(60, unique.count))))
        let page = try await APIClient.shared.get("/api/catalog/products", query: items, as: ProductsPage.self)
        return page.products
    }

    /// POST /api/uploads?purpose=inbox_attachment&as=shopper&(conversationId=|brandId=), multipart field `file`.
    /// Returns the media id to pass in `attachmentIds`.
    static func uploadPhoto(jpeg: Data, conversationId: String?, brandId: String) async throws -> String {
        var query: [URLQueryItem] = [
            URLQueryItem(name: "purpose", value: "inbox_attachment"),
            URLQueryItem(name: "as", value: "shopper"),
        ]
        if let conversationId {
            query.append(URLQueryItem(name: "conversationId", value: conversationId))
        } else {
            query.append(URLQueryItem(name: "brandId", value: brandId))
        }
        var request = try APIClient.shared.makeRequest(.post, "/api/uploads", query: query, body: nil)
        let boundary = "YardBoundary-\(UUID().uuidString)"
        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"photo.jpg\"\r\n".utf8))
        body.append(Data("Content-Type: image/jpeg\r\n\r\n".utf8))
        body.append(jpeg)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(String(body.count), forHTTPHeaderField: "Content-Length")
        request.httpBody = body
        request.timeoutInterval = 60

        let result: (Data, URLResponse)
        do {
            result = try await APIClient.shared.session.data(for: request)
        } catch {
            throw APIError.network(error)
        }
        guard let http = result.1 as? HTTPURLResponse else {
            throw APIError(status: 0, code: "network", message: "We couldn't reach Yard. Try again.")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw APIClient.error(status: http.statusCode, data: result.0)
        }
        do {
            return try APIClient.shared.decoder.decode(InboxUploadResult.self, from: result.0).media.id
        } catch {
            throw APIError.decoding(error)
        }
    }
}
