import SwiftUI
import Observation

/// Studio › Inbox: conversations shoppers started with the brand.
@MainActor
struct StudioInboxView: View {
    @Environment(StudioStore.self) private var studio
    @State private var filter: String = "open"
    @State private var items: [StudioConversation] = []
    @State private var loaded = false
    @State private var error: String?

    private let filters: [String] = ["open", "unread", "resolved"]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.m) {
                HStack(spacing: Spacing.s) {
                    ForEach(filters, id: \.self) { f in
                        Chip(f.capitalized, isSelected: filter == f) {
                            Haptics.selection()
                            filter = f
                        }
                    }
                }
                if !loaded && error == nil {
                    StudioRowsSkeleton()
                } else if let error, items.isEmpty {
                    EmptyState.error(message: error) { await load() }
                } else if items.isEmpty {
                    EmptyState(title: "No conversations", message: "Messages from shoppers show here.", systemImage: "bubble.left.and.bubble.right")
                } else {
                    LazyVStack(spacing: Spacing.s) {
                        ForEach(items) { conversation in
                            Button {
                                Haptics.selection()
                                studio.push(.thread(.conversation(conversation.id)))
                            } label: {
                                row(conversation)
                            }
                            .buttonStyle(PressableButtonStyle())
                        }
                    }
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.vertical, Spacing.l)
        }
        .yardScreenBackground()
        .navigationTitle("Inbox")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task(id: "\(filter)|\(studio.dataVersion)") { await load() }
    }

    private func load() async {
        do {
            let f = filter
            let page = try await studio.call { try await StudioAPI.conversations(filter: f) }
            items = page.items
            error = nil
        } catch {
            if (error as? APIError)?.isCancelled != true {
                self.error = APIError.message(for: error)
            }
        }
        loaded = true
    }

    private func row(_ c: StudioConversation) -> some View {
        HStack(spacing: Spacing.m) {
            PersonAvatar(initials: YardArtwork.initials(c.title), photoURL: Config.url(for: c.customer?.photoSrc), size: 44)
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(c.title)
                        .font(c.unread > 0 ? .yardBodyEmphasis : .yardBody)
                        .foregroundStyle(Color.yard.ink)
                        .lineLimit(1)
                    Spacer()
                    if let at = c.lastMessage?.at {
                        Text(Formatters.relative(at))
                            .font(.yardCaption)
                            .foregroundStyle(Color.yard.ink3)
                    }
                }
                HStack {
                    Text(c.lastMessage?.preview ?? "No messages yet")
                        .font(.yardCallout)
                        .foregroundStyle(c.unread > 0 ? Color.yard.ink : Color.yard.ink2)
                        .lineLimit(1)
                    Spacer()
                    if c.unread > 0 {
                        StudioBadge(count: c.unread)
                    }
                }
            }
        }
        .padding(Spacing.m)
        .yardCard()
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// A Studio chat: a shopper conversation or the brand's Yard Support thread. Reads on open,
/// replies with text.
@MainActor
struct StudioThreadView: View {
    let source: StudioThreadSource

    @Environment(StudioStore.self) private var studio
    @State private var messages: [InboxMessage] = []
    @State private var conversation: StudioConversation?
    @State private var loaded = false
    @State private var error: String?
    @State private var draft: String = ""
    @State private var sending = false
    @FocusState private var composerFocused: Bool

    init(source: StudioThreadSource) {
        self.source = source
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: Spacing.s) {
                    if !loaded && error == nil {
                        ProgressView().tint(Color.yard.ink).padding(.top, Spacing.xxl)
                    } else if let error, messages.isEmpty, !isEmptySupport {
                        EmptyState.error(message: error) { await load() }
                    } else if messages.isEmpty {
                        EmptyState(title: isSupport ? "Message Yard Support" : "No messages yet", message: isSupport ? "Questions about your shop, payouts or an order? Yard's team replies here." : nil, systemImage: "bubble.left.and.bubble.right")
                    }
                    ForEach(messages) { message in
                        bubble(message)
                            .id(message.id)
                    }
                }
                .padding(.horizontal, Spacing.gutter)
                .padding(.vertical, Spacing.l)
            }
            .defaultScrollAnchor(.bottom)
            .onChange(of: messages.count) { _, _ in
                if let last = messages.last { withAnimation(Motion.spring) { proxy.scrollTo(last.id, anchor: .bottom) } }
            }
        }
        .safeAreaInset(edge: .bottom) { composer }
        .yardScreenBackground()
        .navigationTitle(isSupport ? "Yard Support" : (conversation?.title ?? "Conversation"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private var isSupport: Bool { source == .support }
    private var isEmptySupport: Bool { isSupport && (error != nil) && messages.isEmpty }
    private var canReply: Bool {
        if isSupport { return true }
        return studio.can(StudioPermission.inboxReply) && (conversation?.canSend ?? true)
    }

    private func load() async {
        do {
            let s = source
            let thread = try await studio.call { try await StudioAPI.thread(s) }
            messages = thread.messages
            conversation = thread.conversation
            error = nil
            if let last = thread.messages.last {
                await StudioAPI.markRead(s, upToSeq: last.seq)
            }
        } catch let api as APIError where api.isNotFound && isSupport {
            // No support thread before the first message.
            messages = []
            error = nil
        } catch {
            if (error as? APIError)?.isCancelled != true {
                self.error = APIError.message(for: error)
            }
        }
        loaded = true
    }

    private func bubble(_ m: InboxMessage) -> some View {
        let mine = m.side == "brand"
        return Group {
            if m.isSystem {
                Text(m.body ?? "")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink3)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Spacing.xs)
            } else {
                HStack {
                    if mine { Spacer(minLength: 48) }
                    VStack(alignment: mine ? .trailing : .leading, spacing: 4) {
                        if let body = m.body, !body.isEmpty {
                            Text(body)
                                .font(.yardBody)
                                .foregroundStyle(mine ? Color.yard.onAcid : Color.yard.ink)
                                .padding(.horizontal, Spacing.m)
                                .padding(.vertical, 10)
                                .background(mine ? Color.yard.acid : Color.yard.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                                .textSelection(.enabled)
                        }
                        ForEach(m.attachments, id: \.mediaId) { a in
                            RemoteImage(url: a.url, contentMode: .fill, maxPixelSize: 600)
                                .frame(width: 180, height: 180)
                                .clipShape(RoundedRectangle(cornerRadius: Radius.image, style: .continuous))
                        }
                        if let order = m.order {
                            Label("Order \(order.reference)", systemImage: "shippingbox")
                                .font(.yardCaptionEmphasis)
                                .foregroundStyle(Color.yard.ink)
                                .padding(Spacing.s)
                                .background(Color.yard.surface2, in: Capsule())
                        }
                        if let date = m.date {
                            Text(Formatters.time(date))
                                .font(.yardMicro)
                                .foregroundStyle(Color.yard.ink3)
                        }
                    }
                    if !mine { Spacer(minLength: 48) }
                }
            }
        }
    }

    @ViewBuilder
    private var composer: some View {
        if canReply {
            HStack(spacing: Spacing.s) {
                TextField("Reply", text: $draft, axis: .vertical)
                    .lineLimit(1...5)
                    .font(.yardBody)
                    .focused($composerFocused)
                    .padding(.horizontal, Spacing.m)
                    .padding(.vertical, 10)
                    .background(Color.yard.surface2, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                Button {
                    send()
                } label: {
                    Group {
                        if sending {
                            ProgressView().tint(Color.yard.onAcid)
                        } else {
                            Image(systemName: "arrow.up").font(.system(size: 17, weight: .bold))
                        }
                    }
                    .foregroundStyle(Color.yard.onAcid)
                    .frame(width: 44, height: 44)
                    .background(Color.yard.acid, in: Circle())
                }
                .buttonStyle(PressableButtonStyle(scale: Motion.pressScale))
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
                .accessibilityLabel(Text("Send"))
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.vertical, Spacing.s)
            .yardGlassBar()
        }
    }

    private func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 2000 else { return }
        sending = true
        Haptics.impact(.light)
        let s = source
        Task { @MainActor in
            defer { sending = false }
            do {
                let clientId = UUID().uuidString
                if let message = try await studio.call({ try await StudioAPI.reply(s, text: text, clientId: clientId) }) {
                    if !messages.contains(where: { $0.id == message.id }) { messages.append(message) }
                } else {
                    await load()
                }
                draft = ""
                Haptics.success()
            } catch {
                Haptics.error()
                self.error = APIError.message(for: error)
            }
        }
    }
}
