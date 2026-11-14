import SwiftUI
import UIKit

/// A message the shopper sent that the server hasn't confirmed yet (or that failed).
struct InboxPendingMessage: Identifiable, Hashable, Sendable {
    /// The `clientId` (idempotency key): retrying with it never double-sends.
    let id: String
    let text: String
    /// JPEG data of photos still to upload (kept for retry).
    let photos: [Data]
    let createdAt: Date
    var failedMessage: String?
    /// Media ids of `photos` already uploaded, in order (photos[i] → attachmentIds[i]). Kept so a
    /// retry reuses them instead of uploading the same photos again.
    var attachmentIds: [String] = []
    /// Yard Support only: the order attached to this message ("Get help from Yard").
    var order: SupportOrderChip? = nil

    var isFailed: Bool { failedMessage != nil }
}

/// One row of the thread as drawn: a day separator, a message, or a pending send.
enum InboxThreadItem: Identifiable, Hashable {
    case day(id: String, label: String)
    case message(InboxMessage, showsTime: Bool)
    case pending(InboxPendingMessage)

    var id: String {
        switch self {
        case .day(let id, _): return "day:" + id
        case .message(let m, _): return m.id
        case .pending(let p): return "pending:" + p.id
        }
    }
}

/// The shopper's thread with one brand: load, 5 s polling, older pages, sending, read receipts.
/// Works for an existing conversation (`conversationId`) and for a new one by brand (`brandId`),
/// whose first send creates the conversation. With `init(supportOrder:)` it is the shopper's
/// Yard Support thread instead (same DTOs over /api/support/…; the first message creates it).
@Observable @MainActor
final class InboxThreadModel {
    enum Phase {
        case loading
        case ready
        case failed(String)
    }

    private(set) var conversationId: String?
    private(set) var brandId: String?
    var conversation: InboxConversation?
    /// The composer state for a brand-new thread (from by-brand).
    var newThreadInteraction: InboxInteraction?

    // Brand details for the header (from the conversation, then the public storefront for the logo).
    var brandName: String = ""
    var brandHandle: String?
    var brandVerified: Bool = false
    var brandLogoURL: URL?

    var messages: [InboxMessage] = []
    var pending: [InboxPendingMessage] = []
    var hasMore = false
    var isLoadingOlder = false
    var phase: Phase = .loading
    /// Product photos for shared product cards (productId → cover URL).
    var productImages: [String: URL] = [:]

    /// True for the shopper's Yard Support thread (/api/support/…).
    private(set) var isSupport = false
    /// Yard Support only: the order to attach to the next message (a removable chip above the composer).
    var supportOrder: SupportOrderChip?
    /// Read receipts (`threadDto.receipts`): the other side has read up to this seq.
    var theirReadUpToSeq: Int?
    var receiptsEnabled = false

    private var lastMarkedSeq = 0
    private var requestedProductIds: Set<String> = []
    private var loadedBrandInfo = false
    private var isPolling = false

    init(conversationId: String) {
        self.conversationId = conversationId
    }

    init(brandId: String) {
        self.brandId = brandId
    }

    /// The shopper's Yard Support thread, optionally with an order attached to the first message.
    init(supportOrder: SupportOrderChip?) {
        self.isSupport = true
        self.supportOrder = supportOrder
        self.brandName = "Yard Support"
        self.brandVerified = true
        self.loadedBrandInfo = true
    }

    /// Preview-only: a thread already loaded.
    init(preview conversation: InboxConversation, messages: [InboxMessage]) {
        self.conversationId = conversation.id
        self.isSupport = conversation.isSupport
        self.brandId = conversation.isSupport ? nil : conversation.brand.id
        self.conversation = conversation
        self.messages = messages
        self.brandName = conversation.brand.name
        self.brandHandle = conversation.brand.handle
        self.brandVerified = conversation.brand.verified
        self.phase = .ready
        self.loadedBrandInfo = true
    }

    // MARK: Derived

    var displayName: String {
        if isSupport { return "Yard Support" }
        return brandName.isEmpty ? "This brand" : brandName
    }

    /// Yard Support: the shopper's newest message the team has read ("Seen" goes under it).
    var seenMessageId: String? {
        guard isSupport, receiptsEnabled, let upTo = theirReadUpToSeq else { return nil }
        guard let newestMine = messages.last(where: { $0.isMine }), newestMine.seq <= upTo else { return nil }
        return newestMine.id
    }

    var interaction: InboxInteraction? {
        conversationId != nil ? conversation?.interaction : newThreadInteraction
    }

    var disabledReason: String? {
        InboxFormat.disabledReason(interaction, brand: displayName)
    }

    var isBlockedByMe: Bool {
        conversation?.blockedByMe ?? (interaction?.reason == "blocked_by_me")
    }

    /// The newest order attached in the thread: the order this conversation is about.
    var contextOrder: InboxOrderCard? {
        messages.last(where: { $0.order != nil && !$0.isRemoved })?.order
    }

    var isEmpty: Bool { messages.isEmpty && pending.isEmpty }

    /// Messages with day separators, then pending sends at the bottom.
    var items: [InboxThreadItem] {
        var out: [InboxThreadItem] = []
        let cal = Calendar.current
        var lastDay: Date?
        for (i, m) in messages.enumerated() {
            let date = m.date ?? Date()
            let day = cal.startOfDay(for: date)
            if lastDay == nil || lastDay! != day {
                out.append(.day(id: String(Int(day.timeIntervalSince1970)), label: InboxFormat.dayLabel(date)))
                lastDay = day
            }
            // Time under the last bubble of a run (same side, within 5 minutes).
            var showsTime = true
            if i + 1 < messages.count {
                let next = messages[i + 1]
                let nextDate = next.date ?? date
                if next.side == m.side && nextDate.timeIntervalSince(date) < 300 && cal.isDate(nextDate, inSameDayAs: date) {
                    showsTime = false
                }
            } else if !pending.isEmpty && m.isMine {
                showsTime = false
            }
            out.append(.message(m, showsTime: showsTime))
        }
        if !pending.isEmpty {
            let today = cal.startOfDay(for: Date())
            if lastDay == nil || lastDay! != today {
                out.append(.day(id: String(Int(today.timeIntervalSince1970)), label: InboxFormat.dayLabel(Date())))
            }
            for p in pending { out.append(.pending(p)) }
        }
        return out
    }

    // MARK: Loading

    func load() async {
        if case .ready = phase, !messages.isEmpty { return }
        phase = .loading
        if isSupport {
            await loadSupport()
            return
        }
        do {
            if conversationId == nil, let brandId {
                let r = try await InboxAPI.byBrand(brandId: brandId)
                if let c = r.conversation {
                    conversationId = c.id
                    apply(conversation: c)
                } else {
                    newThreadInteraction = r.interaction
                }
            }
            if let id = conversationId {
                let t = try await InboxAPI.thread(id: id)
                apply(conversation: t.conversation)
                messages = Self.merged([], t.messages)
                hasMore = t.hasMore
            }
            phase = .ready
            Task { @MainActor in await self.markReadIfNeeded() }
            Task { @MainActor in await self.loadBrandInfo() }
            Task { @MainActor in await self.loadProductImages() }
        } catch {
            if let api = error as? APIError, api.isCancelled { return }
            phase = .failed(APIError.message(for: error))
        }
    }

    /// Yard Support: GET /api/support/conversation, then the thread once it exists (it is created by
    /// the first message, so a shopper who never wrote gets the intro and an empty composer).
    private func loadSupport() async {
        do {
            if conversationId == nil, let c = try await SupportAPI.conversation(), c.lastMessage != nil {
                conversationId = c.id
                apply(conversation: c)
            }
            if conversationId != nil {
                do {
                    let t = try await SupportAPI.thread()
                    apply(conversation: t.conversation)
                    applyReceipts(t.receipts)
                    messages = Self.merged([], t.messages)
                    hasMore = t.hasMore
                } catch let api as APIError where api.isNotFound {
                    // No message yet (404 before the first one): start fresh.
                    conversationId = nil
                    conversation = nil
                }
            }
            phase = .ready
            Task { @MainActor in await self.markReadIfNeeded() }
        } catch {
            if let api = error as? APIError, api.isCancelled { return }
            phase = .failed(APIError.message(for: error))
        }
    }

    /// The thread read for this model (brand inbox or Yard Support).
    private func fetchThread(id: String, before: Int? = nil, after: Int? = nil, limit: Int = 50) async throws -> InboxThread {
        if isSupport {
            return try await SupportAPI.thread(before: before, after: after, limit: limit)
        }
        return try await InboxAPI.thread(id: id, before: before, after: after, limit: limit)
    }

    private func applyReceipts(_ r: InboxReceipts?) {
        guard let r else { return }
        receiptsEnabled = r.enabled
        if let seq = r.theirsUpToSeq {
            theirReadUpToSeq = max(theirReadUpToSeq ?? 0, seq)
        }
    }

    /// Fetches what's new since the newest message we hold (5 s while the thread is open).
    func poll() async {
        guard let id = conversationId, case .ready = phase, !isPolling else { return }
        isPolling = true
        defer { isPolling = false }
        do {
            let after = messages.map(\.seq).max() ?? 0
            let t = try await fetchThread(id: id, after: after, limit: 100)
            apply(conversation: t.conversation)
            applyReceipts(t.receipts)
            if !t.messages.isEmpty {
                messages = Self.merged(messages, t.messages)
                // A confirmed send that the poll returned first: drop its pending copy.
                let confirmed = Set(t.messages.map(\.clientId))
                pending.removeAll { confirmed.contains($0.id) && !$0.isFailed }
                await markReadIfNeeded()
                await loadProductImages()
            }
        } catch {
            // Polling is best-effort; the next tick tries again.
        }
    }

    func loadOlder() async {
        guard let id = conversationId, hasMore, !isLoadingOlder, let first = messages.map(\.seq).min() else { return }
        isLoadingOlder = true
        defer { isLoadingOlder = false }
        do {
            let t = try await fetchThread(id: id, before: first)
            messages = Self.merged(messages, t.messages)
            hasMore = t.hasMore
            await loadProductImages()
        } catch {
            // Keep hasMore; the button stays to retry.
        }
    }

    private func apply(conversation c: InboxConversation) {
        // List reads don't carry `interaction`; keep the one we have.
        if c.interaction == nil, let old = conversation?.interaction {
            conversation = c.withInteraction(old)
        } else {
            conversation = c
        }
        // Yard Support's counterpart isn't a brand: no storefront, no block.
        if isSupport { return }
        brandId = c.brand.id
        if brandName.isEmpty || !loadedBrandInfo { brandName = c.brand.name }
        if !c.brand.handle.isEmpty { brandHandle = c.brand.handle }
        brandVerified = c.brand.verified
    }

    /// The brand's name, handle and logo from its public storefront (one cached GET).
    func loadBrandInfo() async {
        guard !loadedBrandInfo, !isSupport, let brandId else { return }
        loadedBrandInfo = true
        do {
            let b = try await InboxAPI.brand(idOrHandle: brandId)
            if brandName.isEmpty { brandName = b.name }
            if brandHandle == nil || brandHandle?.isEmpty == true { brandHandle = b.handle }
            brandLogoURL = b.logoURL
            if conversation == nil { brandVerified = b.verified }
        } catch {
            loadedBrandInfo = false
        }
    }

    /// One batched catalogue read for shared product cards we have no photo for yet.
    private func loadProductImages() async {
        let ids = Set(messages.compactMap { $0.product?.productId }).subtracting(requestedProductIds)
        guard !ids.isEmpty else { return }
        requestedProductIds.formUnion(ids)
        do {
            let products = try await InboxAPI.products(ids: Array(ids))
            for p in products {
                if let url = p.coverURL { productImages[p.id] = url }
            }
        } catch {
            requestedProductIds.subtract(ids)
        }
    }

    // MARK: Read receipts

    /// POST read up to the newest message when something from the brand is unread.
    func markReadIfNeeded() async {
        guard let id = conversationId, let maxSeq = messages.map(\.seq).max(), maxSeq > lastMarkedSeq else { return }
        let incoming = messages.contains { !$0.isMine && $0.seq > lastMarkedSeq }
        guard incoming || (conversation?.isUnread ?? false) else {
            lastMarkedSeq = maxSeq
            return
        }
        let previous = lastMarkedSeq
        lastMarkedSeq = maxSeq
        do {
            if isSupport {
                try await SupportAPI.markRead(upToSeq: maxSeq)
            } else {
                try await InboxAPI.markRead(id: id, upToSeq: maxSeq)
            }
            if let c = conversation { conversation = c.markingRead() }
        } catch {
            lastMarkedSeq = previous
        }
    }

    // MARK: Sending

    /// Sends text and/or photos. Optimistic: the bubble shows at once and settles when confirmed.
    func send(text: String, photos: [Data]) {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        // Yard Support: the attached order goes with this message (photos go as their own kind).
        let order: SupportOrderChip? = isSupport && photos.isEmpty ? supportOrder : nil
        guard !body.isEmpty || !photos.isEmpty || order != nil else { return }
        let p = InboxPendingMessage(id: UUID().uuidString.lowercased(), text: body, photos: photos, createdAt: Date(), failedMessage: nil, attachmentIds: [], order: order)
        // Any send drops the chip (as the web composer and Android do), photos included.
        if isSupport { supportOrder = nil }
        withAnimation(Motion.spring) { pending.append(p) }
        Task { @MainActor in await self.deliver(p) }
    }

    func retry(_ p: InboxPendingMessage) {
        guard let i = pending.firstIndex(where: { $0.id == p.id }) else { return }
        pending[i].failedMessage = nil
        let item = pending[i]
        Task { @MainActor in await self.deliver(item) }
    }

    func discard(_ p: InboxPendingMessage) {
        withAnimation(Motion.spring) { pending.removeAll { $0.id == p.id } }
    }

    private func deliver(_ p: InboxPendingMessage) async {
        if isSupport {
            await deliverSupport(p)
            return
        }
        do {
            guard let brandId = brandId ?? conversation?.brand.id else {
                throw APIError(status: 0, code: "client", message: "Something went wrong. Try again.")
            }
            // Reuse photos uploaded by an earlier attempt; upload only the rest.
            var attachmentIds: [String] = pending.first(where: { $0.id == p.id })?.attachmentIds ?? p.attachmentIds
            if attachmentIds.count > p.photos.count { attachmentIds = Array(attachmentIds.prefix(p.photos.count)) }
            for jpeg in p.photos.dropFirst(attachmentIds.count) {
                let mediaId = try await InboxAPI.uploadPhoto(jpeg: jpeg, conversationId: conversationId, brandId: brandId)
                attachmentIds.append(mediaId)
                if let i = pending.firstIndex(where: { $0.id == p.id }) {
                    pending[i].attachmentIds = attachmentIds
                }
            }
            var body = InboxSendBody(clientId: p.id, kind: attachmentIds.isEmpty ? "text" : "image")
            if !p.text.isEmpty { body.body = p.text }
            if !attachmentIds.isEmpty { body.attachmentIds = attachmentIds }
            if let id = conversationId {
                body.conversationId = id
            } else {
                body.brandId = brandId
                body.origin = "inbox"
            }
            let r = try await InboxAPI.send(body)
            // The first send of a new thread creates the conversation; from here on the model
            // talks to it by id (no route swap needed: this screen keeps working as that thread).
            conversationId = r.conversation.id
            apply(conversation: r.conversation)
            if conversation?.interaction == nil, let fresh = newThreadInteraction {
                // A new conversation keeps the composer state by-brand gave us.
                conversation = r.conversation.withInteraction(fresh)
            }
            withAnimation(Motion.spring) {
                pending.removeAll { $0.id == p.id }
                messages = Self.merged(messages, [r.message])
            }
            lastMarkedSeq = max(lastMarkedSeq, r.message.seq)
        } catch {
            if let api = error as? APIError, api.isCancelled { return }
            if let i = pending.firstIndex(where: { $0.id == p.id }) {
                pending[i].failedMessage = APIError.message(for: error)
            }
        }
    }

    /// Yard Support: POST /api/support/messages (text, photos once the thread exists, or an order).
    private func deliverSupport(_ p: InboxPendingMessage) async {
        do {
            var attachmentIds: [String] = pending.first(where: { $0.id == p.id })?.attachmentIds ?? p.attachmentIds
            if !p.photos.isEmpty {
                // Photos upload into the thread, so they need it to exist (the composer only offers them then).
                guard let id = conversationId else {
                    throw APIError(status: 400, code: "validation", message: "Send a message first, then add photos.")
                }
                if attachmentIds.count > p.photos.count { attachmentIds = Array(attachmentIds.prefix(p.photos.count)) }
                for jpeg in p.photos.dropFirst(attachmentIds.count) {
                    let mediaId = try await InboxAPI.uploadPhoto(jpeg: jpeg, conversationId: id, brandId: "")
                    attachmentIds.append(mediaId)
                    if let i = pending.firstIndex(where: { $0.id == p.id }) {
                        pending[i].attachmentIds = attachmentIds
                    }
                }
            }
            var body = SupportSendBody(clientId: p.id, kind: "text")
            if !attachmentIds.isEmpty {
                body.kind = "image"
                body.attachmentIds = attachmentIds
            } else if let order = p.order {
                body.kind = "order"
                body.orderRefId = order.orderId
            }
            if !p.text.isEmpty { body.body = p.text }
            let r = try await SupportAPI.send(body)
            conversationId = r.conversation.id
            apply(conversation: r.conversation)
            withAnimation(Motion.spring) {
                pending.removeAll { $0.id == p.id }
                messages = Self.merged(messages, [r.message])
            }
            lastMarkedSeq = max(lastMarkedSeq, r.message.seq)
        } catch {
            if let api = error as? APIError, api.isCancelled { return }
            if let i = pending.firstIndex(where: { $0.id == p.id }) {
                pending[i].failedMessage = APIError.message(for: error)
            }
        }
    }

    // MARK: Conversation actions

    func setArchived(_ archived: Bool) async throws {
        guard let id = conversationId else { return }
        let c = try await InboxAPI.patch(id: id, archived: archived)
        apply(conversation: c)
    }

    func setMuted(_ muted: Bool) async throws {
        guard let id = conversationId else { return }
        let c = try await InboxAPI.patch(id: id, muted: muted)
        apply(conversation: c)
    }

    func setBlocked(_ on: Bool) async throws {
        guard let brandId = brandId ?? conversation?.brand.id else { return }
        try await InboxAPI.setBlocked(on, brandId: brandId)
        // The composer state changes with the block: re-read the thread (or by-brand).
        if let id = conversationId {
            let t = try await InboxAPI.thread(id: id, limit: 1)
            conversation = t.conversation
        } else {
            newThreadInteraction = try await InboxAPI.byBrand(brandId: brandId).interaction
        }
    }

    // MARK: Helpers

    /// Union by id, oldest first (by seq, then time).
    static func merged(_ a: [InboxMessage], _ b: [InboxMessage]) -> [InboxMessage] {
        var byId: [String: InboxMessage] = [:]
        for m in a { byId[m.id] = m }
        for m in b { byId[m.id] = m }
        return byId.values.sorted { x, y in
            if x.seq != y.seq { return x.seq < y.seq }
            return x.createdAt < y.createdAt
        }
    }
}

/// Photo preparation for uploads: JPEG, longest side ≤ 2048 px, under the 8 MB inbox cap.
enum InboxPhotoPrep {
    static let maxBytes = 8 * 1024 * 1024

    static func jpeg(from data: Data) -> Data? {
        guard let image = UIImage(data: data) else { return nil }
        let longest = max(image.size.width, image.size.height)
        let scale = longest > 2048 ? 2048 / longest : 1
        let size = CGSize(width: floor(image.size.width * scale), height: floor(image.size.height * scale))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        let resized = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        var quality: CGFloat = 0.82
        var out = resized.jpegData(compressionQuality: quality)
        while let d = out, d.count > maxBytes, quality > 0.3 {
            quality -= 0.15
            out = resized.jpegData(compressionQuality: quality)
        }
        guard let result = out, result.count <= maxBytes else { return nil }
        return result
    }
}
