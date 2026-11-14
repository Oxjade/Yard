import SwiftUI

// MARK: - Model

/// The shopper's conversation list (GET /api/inbox/conversations), newest activity first.
@Observable @MainActor
final class InboxListModel {
    enum Phase {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    var items: [InboxConversation] = []
    var nextCursor: String?
    var phase: Phase = .idle
    var isLoadingMore = false
    var filter: InboxAPI.Filter = .inbox
    var query: String = ""
    /// Ids with a swipe action in flight (row dims).
    var busyIds: Set<String> = []
    /// The shopper's Yard Support thread (GET /api/support/conversation); not in the list endpoint.
    var support: InboxConversation?

    private var generation = 0

    /// Yard Support, pinned above the inbox once it has a message (not under Archived/Blocked or a search).
    var pinnedSupport: InboxConversation? {
        guard filter == .inbox, query.isEmpty, let s = support, s.lastMessage != nil else { return nil }
        return s
    }

    /// GET /api/support/conversation (best effort: the list works without it).
    func loadSupport() async {
        do {
            support = try await SupportAPI.conversation()
        } catch {
            // Keep what we had; the next refresh tries again.
        }
    }

    var hasLoaded: Bool {
        if case .loaded = phase { return true }
        return false
    }

    /// First load (skeleton) or a reload after the filter/query changed.
    func load() async {
        generation += 1
        let gen = generation
        if !hasLoaded || items.isEmpty { phase = .loading }
        await loadSupport()
        do {
            let page = try await InboxAPI.conversations(filter: filter, query: query, cursor: nil)
            guard gen == generation else { return }
            items = Self.sorted(page.items)
            nextCursor = page.nextCursor
            phase = .loaded
        } catch {
            guard gen == generation else { return }
            if let api = error as? APIError, api.isCancelled { return }
            if hasLoaded && !items.isEmpty { return } // keep showing what we have
            phase = .failed(APIError.message(for: error))
        }
    }

    /// Silent refresh (coming back from a thread, pull to refresh): never shows the skeleton.
    func refresh() async {
        generation += 1
        let gen = generation
        await loadSupport()
        do {
            let page = try await InboxAPI.conversations(filter: filter, query: query, cursor: nil)
            guard gen == generation else { return }
            items = Self.sorted(page.items)
            nextCursor = page.nextCursor
            phase = .loaded
        } catch {
            guard gen == generation else { return }
            if !hasLoaded, !((error as? APIError)?.isCancelled ?? false) {
                phase = .failed(APIError.message(for: error))
            }
        }
    }

    func loadMore() async {
        guard let cursor = nextCursor, !isLoadingMore, hasLoaded else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        let gen = generation
        do {
            let page = try await InboxAPI.conversations(filter: filter, query: query, cursor: cursor)
            guard gen == generation else { return }
            let known = Set(items.map(\.id))
            items.append(contentsOf: page.items.filter { !known.contains($0.id) })
            nextCursor = page.nextCursor
        } catch {
            // Leave the cursor; the next appearance of the last row retries.
        }
    }

    /// Whether a conversation belongs in the current list (website `belongs`).
    private func belongs(_ c: InboxConversation) -> Bool {
        switch filter {
        case .inbox: return !c.archived && !c.blockedByMe
        case .archived: return c.archived && !c.blockedByMe
        case .blocked: return c.blockedByMe
        }
    }

    private func replace(_ c: InboxConversation) {
        if belongs(c) {
            if let i = items.firstIndex(where: { $0.id == c.id }) { items[i] = c }
        } else {
            items.removeAll { $0.id == c.id }
        }
    }

    func setArchived(_ archived: Bool, for c: InboxConversation) async throws {
        busyIds.insert(c.id)
        defer { busyIds.remove(c.id) }
        let updated = try await InboxAPI.patch(id: c.id, archived: archived)
        withAnimation(Motion.spring) { replace(updated) }
    }

    func setMuted(_ muted: Bool, for c: InboxConversation) async throws {
        busyIds.insert(c.id)
        defer { busyIds.remove(c.id) }
        let updated = try await InboxAPI.patch(id: c.id, muted: muted)
        withAnimation(Motion.spring) { replace(updated) }
    }

    func markRead(_ c: InboxConversation) async throws {
        busyIds.insert(c.id)
        defer { busyIds.remove(c.id) }
        try await InboxAPI.markReadLatest(id: c.id)
        if let i = items.firstIndex(where: { $0.id == c.id }) {
            items[i] = items[i].markingRead()
        }
    }

    func unblock(_ c: InboxConversation) async throws {
        busyIds.insert(c.id)
        defer { busyIds.remove(c.id) }
        try await InboxAPI.setBlocked(false, brandId: c.brand.id)
        withAnimation(Motion.spring) { items.removeAll { $0.id == c.id } }
    }

    static func sorted(_ list: [InboxConversation]) -> [InboxConversation] {
        list.sorted { a, b in
            if a.sortAt != b.sortAt { return a.sortAt > b.sortAt }
            return a.id > b.id
        }
    }
}

// MARK: - View

/// Inbox: the shopper's conversations with brands. Swipe to mark read, mute or archive.
@MainActor
struct InboxView: View {
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @Environment(ToastCenter.self) private var toast

    @State private var model = InboxListModel()
    @State private var searchText = ""

    init() {}

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.yard.bg.ignoresSafeArea())
            .navigationTitle("Inbox")
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if session.isSignedIn { filterMenu }
                }
            }
            .modifier(InboxSearchModifier(enabled: session.isSignedIn, text: $searchText))
            .task(id: session.shopper?.id) {
                guard session.isSignedIn else { return }
                await model.load()
            }
            .task(id: searchText) {
                let term = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
                guard term != model.query, session.isSignedIn else { return }
                try? await Task.sleep(nanoseconds: 250_000_000)
                guard !Task.isCancelled else { return }
                model.query = term
                await model.load()
            }
            .onAppear {
                // Back from a thread: unread dots and previews settle without a skeleton.
                guard session.isSignedIn, model.hasLoaded else { return }
                Task { @MainActor in await model.refresh() }
            }
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        if !session.isSignedIn {
            if session.hasLoaded {
                EmptyState.signedOut(title: "Your inbox", message: "Sign in to message brands about sizing, stock and delivery.") {
                    router.present(.signIn)
                }
            } else {
                InboxListSkeleton()
            }
        } else {
            switch model.phase {
            case .idle, .loading:
                InboxListSkeleton()
            case .failed(let message):
                EmptyState(
                    title: "Couldn't load your messages.",
                    message: message,
                    systemImage: "wifi.exclamationmark",
                    actionTitle: "Retry",
                    action: { Task { @MainActor in await model.load() } }
                )
            case .loaded:
                if model.items.isEmpty && model.pinnedSupport == nil {
                    emptyState
                        .refreshable { await model.refresh() }
                } else {
                    list
                }
            }
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        ScrollView {
            Group {
                if !model.query.isEmpty {
                    EmptyState(title: "No conversations match “\(model.query)”", message: "Search looks at brand names and the messages you can see.", systemImage: "magnifyingglass")
                } else {
                    switch model.filter {
                    case .blocked:
                        EmptyState(title: "No blocked brands", message: "Brands you block can't message you. They'd show here.", systemImage: "nosign")
                    case .archived:
                        EmptyState(title: "No archived conversations", message: "Archive a conversation to tidy your inbox. It comes back when someone writes.", systemImage: "archivebox")
                    case .inbox:
                        VStack(spacing: Spacing.m) {
                            EmptyState(title: "No messages yet", message: "Ask a brand about sizing, stock or delivery — start from any storefront or product.", systemImage: "bubble.left.and.bubble.right", actionTitle: "Browse brands") {
                                router.push(.brandsDirectory)
                            }
                            supportLink
                        }
                    }
                }
            }
            .padding(.top, Spacing.xxxl)
            .frame(maxWidth: .infinity)
        }
        .scrollContentBackground(.hidden)
    }

    private var list: some View {
        List {
            if model.filter != .inbox {
                filterBanner
                    .listRowInsets(EdgeInsets(top: Spacing.s, leading: Spacing.gutter, bottom: Spacing.s, trailing: Spacing.gutter))
                    .listRowBackground(Color.yard.bg)
                    .listRowSeparator(.hidden)
            }
            if let support = model.pinnedSupport {
                Button {
                    router.push(.support(orderId: nil, orderReference: nil))
                } label: {
                    InboxConversationRow(conversation: support)
                }
                .buttonStyle(.plain)
                .listRowInsets(EdgeInsets(top: Spacing.m, leading: Spacing.gutter, bottom: Spacing.m, trailing: Spacing.gutter))
                .listRowBackground(Color.yard.bg)
                .listRowSeparatorTint(Color.yard.line)
                .alignmentGuide(.listRowSeparatorLeading) { _ in 64 }
            }
            ForEach(model.items) { c in
                Button {
                    router.push(.conversation(id: c.id))
                } label: {
                    InboxConversationRow(conversation: c)
                        .opacity(model.busyIds.contains(c.id) ? 0.5 : 1)
                }
                .buttonStyle(.plain)
                .listRowInsets(EdgeInsets(top: Spacing.m, leading: Spacing.gutter, bottom: Spacing.m, trailing: Spacing.gutter))
                .listRowBackground(Color.yard.bg)
                .listRowSeparatorTint(Color.yard.line)
                .alignmentGuide(.listRowSeparatorLeading) { _ in 64 }
                .swipeActions(edge: .leading, allowsFullSwipe: true) { leadingActions(c) }
                .swipeActions(edge: .trailing, allowsFullSwipe: true) { trailingActions(c) }
                .onAppear {
                    if c.id == model.items.last?.id {
                        Task { @MainActor in await model.loadMore() }
                    }
                }
            }
            if model.isLoadingMore {
                HStack { Spacer(); ProgressView().tint(Color.yard.ink2); Spacer() }
                    .listRowBackground(Color.yard.bg)
                    .listRowSeparator(.hidden)
            }
            if model.filter == .inbox && model.query.isEmpty && model.pinnedSupport == nil && model.nextCursor == nil {
                supportLink
                    .listRowInsets(EdgeInsets(top: Spacing.l, leading: Spacing.gutter, bottom: Spacing.l, trailing: Spacing.gutter))
                    .listRowBackground(Color.yard.bg)
                    .listRowSeparator(.hidden)
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Color.yard.bg)
        .refreshable { await model.refresh() }
        .animation(Motion.spring, value: model.items.map(\.id))
    }

    /// "Message Yard Support" until the shopper's support thread exists (then it's the pinned row).
    private var supportLink: some View {
        Button {
            router.push(.support(orderId: nil, orderReference: nil))
        } label: {
            HStack(spacing: Spacing.s) {
                InboxSupportMark(size: 28)
                Text("Message Yard Support")
                    .font(.yardCaptionEmphasis)
                    .foregroundStyle(Color.yard.ink)
                Image(systemName: "chevron.right")
                    .font(.yardMicro)
                    .foregroundStyle(Color.yard.ink3)
            }
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(Text("Opens a conversation with Yard's team"))
    }

    private var filterBanner: some View {
        HStack(spacing: Spacing.s) {
            Text(model.filter == .blocked ? "Brands you've blocked" : "Archived conversations")
                .font(.yardCaption)
                .foregroundStyle(Color.yard.ink2)
            Spacer()
            Button("Back to inbox") { setFilter(.inbox) }
                .font(.yardCaptionEmphasis)
                .foregroundStyle(Color.yard.ink)
                .buttonStyle(.borderless)
        }
    }

    // MARK: Swipe actions

    @ViewBuilder
    private func leadingActions(_ c: InboxConversation) -> some View {
        if c.isUnread && model.filter != .blocked {
            Button {
                run { try await model.markRead(c) }
            } label: {
                Label("Mark read", systemImage: "envelope.open")
            }
            .tint(Color.yard.purple)
        }
    }

    @ViewBuilder
    private func trailingActions(_ c: InboxConversation) -> some View {
        switch model.filter {
        case .blocked:
            Button {
                run(success: "Unblocked \(c.brand.name)") { try await model.unblock(c) }
            } label: {
                Label("Unblock", systemImage: "hand.raised.slash")
            }
            .tint(Color.yard.purple)
        case .inbox, .archived:
            Button {
                let archive = !c.archived
                run(success: archive ? "Archived" : "Moved back to your inbox") { try await model.setArchived(archive, for: c) }
            } label: {
                Label(c.archived ? "Unarchive" : "Archive", systemImage: c.archived ? "tray.and.arrow.up" : "archivebox")
            }
            .tint(Color.yard.ink3)
            Button {
                let mute = !c.muted
                run(success: mute ? "Muted \(c.brand.name)" : "Unmuted \(c.brand.name)") { try await model.setMuted(mute, for: c) }
            } label: {
                Label(c.muted ? "Unmute" : "Mute", systemImage: c.muted ? "bell" : "bell.slash")
            }
            .tint(Color.yard.purple)
        }
    }

    private func run(success: String? = nil, _ work: @escaping @MainActor () async throws -> Void) {
        Task { @MainActor in
            do {
                try await work()
                if let success { toast.show(success, style: .success) }
            } catch {
                toast.show(error)
            }
        }
    }

    // MARK: Filter

    private var filterMenu: some View {
        Menu {
            Picker("Show", selection: Binding(get: { model.filter }, set: { setFilter($0) })) {
                ForEach(InboxAPI.Filter.allCases, id: \.self) { f in
                    Label(f.title, systemImage: f.systemImage).tag(f)
                }
            }
        } label: {
            Image(systemName: model.filter == .inbox ? "line.3.horizontal.decrease.circle" : "line.3.horizontal.decrease.circle.fill")
                .foregroundStyle(model.filter == .inbox ? Color.yard.ink : Color.yard.violet)
                .accessibilityLabel(Text(model.filter == .inbox ? "Filter conversations" : "Filter: \(model.filter.title)"))
        }
    }

    private func setFilter(_ f: InboxAPI.Filter) {
        guard f != model.filter else { return }
        model.filter = f
        model.items = []
        model.nextCursor = nil
        model.phase = .loading
        Task { @MainActor in await model.load() }
    }
}

/// `.searchable` only when signed in (a search field over the sign-in invite reads oddly).
private struct InboxSearchModifier: ViewModifier {
    let enabled: Bool
    @Binding var text: String

    @ViewBuilder
    func body(content: Content) -> some View {
        if enabled {
            content.searchable(text: $text, placement: .navigationBarDrawer(displayMode: .automatic), prompt: Text("Search brands and messages"))
        } else {
            content
        }
    }
}

// MARK: - Row

/// One conversation: brand avatar, name, time, preview, state tags, unread dot.
struct InboxConversationRow: View {
    let conversation: InboxConversation

    var body: some View {
        let c = conversation
        HStack(alignment: .top, spacing: Spacing.m) {
            if c.isSupport {
                InboxSupportMark(size: 52)
            } else {
                BrandAvatar(name: c.brand.name, size: 52, verified: c.brand.verified)
            }
            VStack(alignment: .leading, spacing: Spacing.xs) {
                HStack(alignment: .firstTextBaseline, spacing: Spacing.s) {
                    Text(c.brand.name)
                        .font(c.isUnread ? .yardBodyEmphasis : .yardBody)
                        .foregroundStyle(Color.yard.ink)
                        .lineLimit(1)
                    if c.muted {
                        Image(systemName: "bell.slash.fill")
                            .font(.yardCaption)
                            .foregroundStyle(Color.yard.ink3)
                            .accessibilityLabel(Text("Muted"))
                    }
                    Spacer(minLength: Spacing.s)
                    Text(c.lastMessage.map { InboxFormat.rowTime($0.at) } ?? "")
                        .font(.yardCaption)
                        .foregroundStyle(c.isUnread ? Color.yard.ink : Color.yard.ink3)
                        .monospacedDigit()
                }
                HStack(alignment: .top, spacing: Spacing.s) {
                    Text(c.previewText)
                        .font(.yardCallout)
                        .fontWeight(c.isUnread ? .medium : .regular)
                        .foregroundStyle(c.isUnread ? Color.yard.ink : Color.yard.ink2)
                        .lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Circle()
                        .fill(Color.yard.violet)
                        .frame(width: 10, height: 10)
                        .padding(.top, 5)
                        .opacity(c.isUnread ? 1 : 0)
                        .accessibilityHidden(true)
                }
                if c.status == "resolved" || c.blockedByMe || c.archived {
                    HStack(spacing: Spacing.xs) {
                        if c.status == "resolved" { Tag("Resolved") }
                        if c.blockedByMe { Tag("Blocked", style: .danger) }
                        if c.archived { Tag("Archived") }
                    }
                    .padding(.top, Spacing.xxs)
                }
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint(Text(c.isUnread ? "Unread" : ""))
    }
}

/// Loading shape: rows of avatar + two text lines.
struct InboxListSkeleton: View {
    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.l) {
                ForEach(0..<7, id: \.self) { i in
                    HStack(spacing: Spacing.m) {
                        Skeleton(shape: .circle).frame(width: 52, height: 52)
                        VStack(alignment: .leading, spacing: Spacing.s) {
                            Skeleton(cornerRadius: 6).frame(width: CGFloat(110 + (i % 3) * 30), height: 14)
                            Skeleton(cornerRadius: 6).frame(height: 12)
                            Skeleton(cornerRadius: 6).frame(width: 160, height: 12)
                        }
                    }
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.l)
        }
        .scrollDisabled(true)
        .accessibilityLabel(Text("Loading your inbox"))
    }
}

// MARK: - Previews

private enum InboxPreviewData {
    static let rows: [InboxConversation] = [
        InboxConversation(id: "cv_1", brand: InboxBrandRef(id: "b1", handle: "acme", name: "Acme Studio", verified: true), lastMessage: InboxLastMessage(preview: "Yes — the M fits true to size. Restock lands Friday.", at: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-600)), side: "brand"), unread: 2, createdAt: "2026-11-01T10:00:00Z"),
        InboxConversation(id: "cv_2", brand: InboxBrandRef(id: "b2", handle: "lagos", name: "Lagos Thread"), lastMessage: InboxLastMessage(preview: "How long does delivery to London usually take?", at: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-90_000)), side: "customer"), muted: true, createdAt: "2026-11-01T10:00:00Z"),
        InboxConversation(id: "cv_3", brand: InboxBrandRef(id: "b3", handle: "kumasi", name: "Kumasi Thread Co."), status: "resolved", lastMessage: InboxLastMessage(preview: "Thanks!", at: "2026-10-02T10:00:00Z", side: "customer"), createdAt: "2026-10-01T10:00:00Z"),
        InboxConversation(id: "cv_4", brand: InboxBrandRef(id: "yard_support", handle: "support", name: "Yard Support", verified: true), lastMessage: InboxLastMessage(preview: "We've asked the brand for proof of delivery.", at: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-1_200)), side: "support"), unread: 1, createdAt: "2026-11-01T10:00:00Z", kind: "support"),
    ]
}

#Preview("Inbox rows — dark") {
    VStack(spacing: 20) {
        ForEach(InboxPreviewData.rows) { InboxConversationRow(conversation: $0) }
    }
    .padding()
    .frame(maxHeight: .infinity, alignment: .top)
    .background(Color.yard.bg)
    .preferredColorScheme(.dark)
}

#Preview("Inbox rows — light") {
    VStack(spacing: 20) {
        ForEach(InboxPreviewData.rows) { InboxConversationRow(conversation: $0) }
    }
    .padding()
    .frame(maxHeight: .infinity, alignment: .top)
    .background(Color.yard.bg)
    .preferredColorScheme(.light)
}

#Preview("InboxView — dark") {
    NavigationStack { InboxView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("InboxView — light") {
    NavigationStack { InboxView() }
        .yardPreviewEnvironment(signedIn: false)
        .preferredColorScheme(.light)
}
