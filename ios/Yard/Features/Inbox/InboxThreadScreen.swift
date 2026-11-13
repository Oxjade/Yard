import SwiftUI

/// Photos opened in the lightbox.
private struct InboxPhotoSelection: Identifiable {
    let id = UUID()
    let attachments: [InboxAttachment]
    let index: Int
}

/// The thread UI shared by `ConversationView(id:)` and `BrandConversationView(brandId:)`:
/// header (brand + menu), pinned order context, bubbles with day separators, composer.
/// Polls every 5 s while open and active; marks read on open and as replies arrive.
@MainActor
struct InboxThreadScreen: View {
    let model: InboxThreadModel

    @Environment(Router.self) private var router
    @Environment(ToastCenter.self) private var toast
    @Environment(\.scenePhase) private var scenePhase

    @FocusState private var composerFocused: Bool
    @State private var photoSelection: InboxPhotoSelection?
    @State private var confirmBlock = false

    private static let bottomId = "inbox-thread-bottom"

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.yard.bg.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) { header }
                ToolbarItem(placement: .topBarTrailing) { menu }
            }
            .toolbarBackground(Color.yard.bg, for: .navigationBar)
            .task { await model.load() }
            .task(id: model.conversationId) {
                guard model.conversationId != nil else { return }
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                    if Task.isCancelled { break }
                    if scenePhase == .active { await model.poll() }
                }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { @MainActor in await model.poll() } }
            }
            .fullScreenCover(item: $photoSelection) { selection in
                InboxPhotoViewer(attachments: selection.attachments, index: selection.index)
            }
            .confirmationDialog(
                model.isBlockedByMe ? "Unblock \(model.displayName)?" : "Block \(model.displayName)?",
                isPresented: $confirmBlock,
                titleVisibility: .visible
            ) {
                if model.isBlockedByMe {
                    Button("Unblock") { toggleBlock() }
                } else {
                    Button("Block", role: .destructive) { toggleBlock() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(model.isBlockedByMe ? "They'll be able to message you again." : "They can't message you. Find this conversation under Blocked.")
            }
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            InboxThreadSkeleton()
        case .failed(let message):
            EmptyState(
                title: "Couldn't load this conversation.",
                message: message,
                systemImage: "wifi.exclamationmark",
                actionTitle: "Retry",
                action: { Task { @MainActor in await model.load() } }
            )
        case .ready:
            thread
        }
    }

    private var thread: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: Spacing.s) {
                    if model.hasMore {
                        olderButton
                    }
                    if model.isEmpty {
                        intro
                    }
                    ForEach(model.items) { item in
                        row(item)
                            .id(item.id)
                            .transition(.asymmetric(insertion: .move(edge: .bottom).combined(with: .opacity), removal: .opacity))
                    }
                    Color.clear.frame(height: 1).id(Self.bottomId)
                }
                .padding(.horizontal, Spacing.gutter)
                .padding(.top, Spacing.s)
                .padding(.bottom, Spacing.m)
            }
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .top, spacing: 0) {
                if let order = model.contextOrder {
                    InboxOrderContextBar(card: order) { router.push(.order(id: order.orderId)) }
                        .padding(.horizontal, Spacing.gutter)
                        .padding(.vertical, Spacing.s)
                        .background(Color.yard.bg)
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                InboxComposer(
                    placeholder: "Message \(model.displayName)",
                    disabledReason: model.disabledReason,
                    allowsPhotos: model.conversationId != nil || model.brandId != nil,
                    focus: $composerFocused
                ) { text, photos in
                    model.send(text: text, photos: photos)
                }
            }
            .onAppear { scrollToBottom(proxy, animated: false) }
            .onChange(of: model.items.last?.id) { _, _ in
                scrollToBottom(proxy, animated: true)
            }
            .onChange(of: composerFocused) { _, focused in
                guard focused else { return }
                // Wait for the keyboard to lift the composer, then keep the newest message in view.
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    scrollToBottom(proxy, animated: true)
                }
            }
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy, animated: Bool) {
        if animated {
            withAnimation(Motion.spring) { proxy.scrollTo(Self.bottomId, anchor: .bottom) }
        } else {
            proxy.scrollTo(Self.bottomId, anchor: .bottom)
        }
    }

    @ViewBuilder
    private func row(_ item: InboxThreadItem) -> some View {
        switch item {
        case .day(_, let label):
            InboxDaySeparator(label: label)
        case .message(let m, let showsTime):
            InboxMessageRow(
                message: m,
                showsTime: showsTime,
                productImage: m.product.flatMap { model.productImages[$0.productId] },
                onOpenPhotos: { attachments, index in
                    photoSelection = InboxPhotoSelection(attachments: attachments, index: index)
                }
            )
        case .pending(let p):
            InboxPendingRow(pending: p, onRetry: { model.retry(p) }, onDiscard: { model.discard(p) })
        }
    }

    private var olderButton: some View {
        Group {
            if model.isLoadingOlder {
                ProgressView().tint(Color.yard.ink2)
            } else {
                YardButton("Load earlier messages", style: .ghost, size: .small, fullWidth: false) {
                    Task { @MainActor in await model.loadOlder() }
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, Spacing.s)
    }

    private var intro: some View {
        VStack(spacing: Spacing.s) {
            BrandAvatar(name: model.displayName, logoURL: model.brandLogoURL, size: 72, verified: model.brandVerified)
            Text("Ask \(model.displayName) anything")
                .font(.yardHeadline)
                .foregroundStyle(Color.yard.ink)
                .multilineTextAlignment(.center)
            Text("Sizing, stock, delivery or their next drop. Replies arrive here and in your notifications. Refunds and returns have their own steps on the order page.")
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 300)
        }
        .padding(.vertical, Spacing.xxxl)
        .frame(maxWidth: .infinity)
    }

    // MARK: Header & menu

    private var header: some View {
        Button {
            if let handle = model.brandHandle, !handle.isEmpty { router.push(.brand(handle: handle)) }
        } label: {
            HStack(spacing: Spacing.s) {
                BrandAvatar(name: model.displayName, logoURL: model.brandLogoURL, size: 32, verified: false)
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: Spacing.xs) {
                        Text(model.brandName.isEmpty ? " " : model.brandName)
                            .font(.yardHeadline)
                            .foregroundStyle(Color.yard.ink)
                            .lineLimit(1)
                        if model.brandVerified {
                            Image(systemName: "checkmark.seal.fill")
                                .font(.yardCaption)
                                .foregroundStyle(Color.yard.violet)
                                .accessibilityLabel(Text("Verified brand"))
                        }
                    }
                    if model.conversation?.status == "resolved" {
                        Text("Resolved. Writing again reopens it.")
                            .font(.yardMicro)
                            .foregroundStyle(Color.yard.ink3)
                            .lineLimit(1)
                    } else if model.conversation?.muted == true {
                        Text("Muted")
                            .font(.yardMicro)
                            .foregroundStyle(Color.yard.ink3)
                    }
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityHint(Text("Opens the storefront"))
    }

    private var menu: some View {
        Menu {
            if let handle = model.brandHandle, !handle.isEmpty {
                Button {
                    router.push(.brand(handle: handle))
                } label: {
                    Label("View storefront", systemImage: "storefront")
                }
            }
            if let c = model.conversation {
                Button {
                    let mute = !c.muted
                    run(mute ? "Muted \(model.displayName)" : "Unmuted \(model.displayName)") { try await model.setMuted(mute) }
                } label: {
                    Label(c.muted ? "Unmute" : "Mute", systemImage: c.muted ? "bell" : "bell.slash")
                }
                Button {
                    let archive = !c.archived
                    run(archive ? "Archived" : "Moved back to your inbox") { try await model.setArchived(archive) }
                } label: {
                    Label(c.archived ? "Unarchive" : "Archive", systemImage: c.archived ? "tray.and.arrow.up" : "archivebox")
                }
            }
            Divider()
            Button(role: model.isBlockedByMe ? nil : .destructive) {
                confirmBlock = true
            } label: {
                Label(model.isBlockedByMe ? "Unblock \(model.displayName)" : "Block \(model.displayName)", systemImage: "nosign")
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.yard.ink)
                .frame(width: 36, height: 36)
                .background(Circle().fill(Color.yard.surface2))
                .accessibilityLabel(Text("More"))
        }
    }

    private func toggleBlock() {
        let on = !model.isBlockedByMe
        run(on ? "Blocked \(model.displayName)" : "Unblocked \(model.displayName)") { try await model.setBlocked(on) }
    }

    private func run(_ success: String, _ work: @escaping @MainActor () async throws -> Void) {
        Task { @MainActor in
            do {
                try await work()
                toast.show(success, style: .success)
            } catch {
                toast.show(error)
            }
        }
    }
}

// MARK: - Previews

enum InboxThreadPreviewData {
    static func iso(_ offset: TimeInterval) -> String {
        ISO8601DateFormatter().string(from: Date().addingTimeInterval(offset))
    }

    @MainActor
    static func model() -> InboxThreadModel {
        let brand = InboxBrandRef(id: "brd_preview", handle: "acme", name: "Acme Studio", verified: true)
        let conversation = InboxConversation(id: "cv_preview", brand: brand, createdAt: iso(-200_000), interaction: InboxInteraction(canSend: true))
        let order = InboxOrderCard(orderId: "ord_1", reference: "YD-4821", status: "shipped", placedAt: iso(-300_000), total: InboxMoney(amount: 12000, currency: "USD"), itemCount: 2)
        let messages: [InboxMessage] = [
            InboxMessage(id: "m1", seq: 1, side: "customer", kind: "order", body: "Hi! Any update on this order?", order: order, createdAt: iso(-100_000)),
            InboxMessage(id: "m2", seq: 2, side: "brand", body: "Yes — it left our studio this morning. Tracking is on the order page.", createdAt: iso(-99_000)),
            InboxMessage(id: "m3", seq: 3, side: "customer", body: "Amazing, thank you.", createdAt: iso(-600)),
            InboxMessage(id: "m4", seq: 4, side: "brand", body: "Any time. Shout if the fit isn't right.", safetyNotice: false, createdAt: iso(-300)),
        ]
        return InboxThreadModel(preview: conversation, messages: messages)
    }
}

#Preview("Thread — dark") {
    NavigationStack { InboxThreadScreen(model: InboxThreadPreviewData.model()) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("Thread — light") {
    NavigationStack { InboxThreadScreen(model: InboxThreadPreviewData.model()) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
