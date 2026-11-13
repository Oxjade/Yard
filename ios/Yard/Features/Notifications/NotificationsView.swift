import SwiftUI

/// In-app notifications: orders, drops, messages and news from followed brands.
/// Grouped Today / Earlier, unread dots, tap → the page it is about, Mark all read.
/// Wording from the website's /notifications page (src/app/(market)/notifications/page.tsx).
@MainActor
struct NotificationsView: View {
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @Environment(ToastCenter.self) private var toast
    @Environment(\.openURL) private var openURL

    @State private var model: NotificationsViewModel
    @State private var markAllTick: Int = 0

    init() {
        _model = State(initialValue: NotificationsViewModel())
    }

    /// Previews only.
    init(previewItems: [ShopperNotification]) {
        _model = State(initialValue: NotificationsViewModel(items: previewItems))
    }

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .yardScreenBackground()
            .navigationTitle("Notifications")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if session.isSignedIn && !model.items.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            markAllRead()
                        } label: {
                            Label("Mark all read", systemImage: "checkmark.circle")
                        }
                        .disabled(model.unreadCount == 0 || model.isMarkingAll)
                        .accessibilityLabel("Mark all as read")
                    }
                }
            }
            .task(id: session.shopper?.id ?? "signed-out") {
                if session.isSignedIn {
                    await model.load()
                } else {
                    model.reset()
                }
            }
            .sensoryFeedback(.success, trigger: markAllTick)
    }

    // MARK: - States

    @ViewBuilder
    private var content: some View {
        if !session.isSignedIn {
            if session.hasLoaded {
                EmptyState(
                    title: "Sign in to see your notifications",
                    message: "Order updates and drop alerts are tied to your account.",
                    systemImage: "bell",
                    actionTitle: "Sign in",
                    action: { router.present(.signIn) }
                )
            } else {
                NotificationsSkeleton()
            }
        } else {
            switch model.phase {
            case .idle, .loading:
                NotificationsSkeleton()
            case .failed(let message):
                EmptyState.error(message: message) { await model.load() }
            case .loaded:
                list
            }
        }
    }

    private var list: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                header

                if !model.items.isEmpty {
                    SegmentedPill(selection: $model.filter, options: NotificationsViewModel.Filter.allCases) { filter in
                        switch filter {
                        case .all: return "All \(model.items.count)"
                        case .unread: return "Unread \(model.unreadCount)"
                        }
                    }
                }

                if model.visible.isEmpty {
                    emptyList
                        .padding(.top, Spacing.xl)
                } else {
                    ForEach(model.sections) { section in
                        VStack(alignment: .leading, spacing: Spacing.s) {
                            Text(section.title)
                                .font(.yardHeadline)
                                .foregroundStyle(Color.yard.ink2)
                                .padding(.leading, Spacing.xs)
                                .accessibilityAddTraits(.isHeader)
                            Card(padding: 0) {
                                LazyVStack(spacing: 0) {
                                    ForEach(Array(section.items.enumerated()), id: \.element.id) { index, item in
                                        if index > 0 {
                                            Divider()
                                                .overlay(Color.yard.line)
                                                .padding(.leading, 64)
                                        }
                                        row(item)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.s)
            .padding(.bottom, Spacing.xxl)
            .animation(Motion.spring, value: model.filter)
        }
        .refreshable { await model.load() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text("Notifications").yardDisplay(40)
                .foregroundStyle(Color.yard.ink)
            Text("Orders, drops and news from the brands you follow.")
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var emptyList: some View {
        if model.filter == .unread && !model.items.isEmpty {
            EmptyState(
                title: "Nothing unread",
                message: "You're all caught up.",
                systemImage: "checkmark.circle",
                actionTitle: "Show all",
                action: { model.filter = .all }
            )
        } else {
            EmptyState(
                title: "No notifications here yet",
                message: "When something happens that needs you, it shows up here: orders, drops and news from the brands you follow.",
                systemImage: "bell.slash"
            )
        }
    }

    private func row(_ item: ShopperNotification) -> some View {
        Button {
            open(item)
        } label: {
            NotificationsListRow(notification: item)
        }
        .buttonStyle(PressableButtonStyle())
        .contextMenu {
            Button {
                toggleRead(item)
            } label: {
                if item.read {
                    Label("Mark as unread", systemImage: "envelope.badge")
                } else {
                    Label("Mark as read", systemImage: "envelope.open")
                }
            }
        }
    }

    // MARK: - Actions

    private func open(_ item: ShopperNotification) {
        if !item.read {
            Task { @MainActor in
                // A failed mark-read shouldn't block navigation; the dot comes back on failure.
                try? await model.setRead(true, for: item)
            }
        }
        if let route = item.route {
            if route == .notifications { return }
            router.push(route)
        } else if let href = item.href, href.hasPrefix("/"), !href.hasPrefix("//") {
            // A Yard page the app doesn't have: open it on the website.
            openURL(Config.webURL(href))
        }
    }

    private func toggleRead(_ item: ShopperNotification) {
        Task { @MainActor in
            do {
                try await model.setRead(!item.read, for: item)
            } catch {
                toast.show(error)
            }
        }
    }

    private func markAllRead() {
        Task { @MainActor in
            do {
                try await model.markAllRead()
                markAllTick += 1
            } catch {
                toast.show(error)
            }
        }
    }
}

// MARK: - Row

/// Icon tile (per kind), title, body, time and an unread dot.
struct NotificationsListRow: View {
    let notification: ShopperNotification

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.m) {
            Image(systemName: notification.kind.systemImage)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(notification.read ? Color.yard.ink2 : Color.yard.ink)
                .frame(width: 40, height: 40)
                .background(Color.yard.surface2, in: RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(notification.title)
                    .font(notification.read ? .yardBody : .yardBodyEmphasis)
                    .foregroundStyle(Color.yard.ink)
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)
                if !notification.body.isEmpty {
                    Text(notification.body)
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.ink2)
                        .multilineTextAlignment(.leading)
                        .lineLimit(3)
                }
                HStack(spacing: Spacing.xs) {
                    Text(notification.kind.label)
                    if let date = notification.date {
                        Text("·")
                        Text(Formatters.relative(date))
                    }
                }
                .font(.yardCaption)
                .foregroundStyle(Color.yard.ink3)
                .padding(.top, Spacing.xxs)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Circle()
                .fill(Color.yard.violet)
                .frame(width: 8, height: 8)
                .opacity(notification.read ? 0 : 1)
                .padding(.top, Spacing.s)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, Spacing.m)
        .padding(.vertical, Spacing.m)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityValue(notification.read ? "" : "Unread")
    }
}

// MARK: - Skeleton

private struct NotificationsSkeleton: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                Skeleton(cornerRadius: Radius.small)
                    .frame(width: 220, height: 36)
                Skeleton(shape: .capsule)
                    .frame(height: 44)
                Card(padding: 0) {
                    VStack(spacing: 0) {
                        ForEach(0..<6, id: \.self) { _ in
                            HStack(alignment: .top, spacing: Spacing.m) {
                                Skeleton(cornerRadius: Radius.small)
                                    .frame(width: 40, height: 40)
                                VStack(alignment: .leading, spacing: Spacing.s) {
                                    Skeleton(cornerRadius: 6).frame(height: 14)
                                    Skeleton(cornerRadius: 6).frame(width: 180, height: 12)
                                    Skeleton(cornerRadius: 6).frame(width: 80, height: 10)
                                }
                            }
                            .padding(Spacing.m)
                        }
                    }
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.s)
        }
        .scrollDisabled(true)
        .accessibilityLabel("Loading notifications")
    }
}

// MARK: - Previews

private enum NotificationsPreviewData {
    static var items: [ShopperNotification] {
        let now = Date()
        let iso = ISO8601DateFormatter()
        func at(_ offset: TimeInterval) -> String { iso.string(from: now.addingTimeInterval(offset)) }
        return [
            ShopperNotification(id: "nt_1", key: "drop.live:drp_1", category: "drop_update", title: "Night Shift is live", body: "Acme Studio just released it.", href: "/drops/night-shift", at: at(-600), read: false),
            ShopperNotification(id: "nt_2", key: "msg:cv_1", category: "new_message", title: "Acme Studio replied", body: "Open your inbox to read it.", href: "/inbox?thread=cv_1", at: at(-3_600), read: false),
            ShopperNotification(id: "nt_3", key: "shipped:ord_1", category: "delivery_update", title: "Acme Studio shipped your order", body: "Estimated arrival 14–18 Nov.", href: "/you/orders/ord_1", at: at(-90_000), read: true),
            ShopperNotification(id: "nt_4", key: "price_drop:prd_1", category: "price_drop", title: "Price drop: Boxy tee", body: "Now $35, was $45.", href: "/products/boxy-tee", at: at(-300_000), read: true),
        ]
    }
}

#Preview("NotificationsView — dark") {
    NavigationStack { NotificationsView(previewItems: NotificationsPreviewData.items) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("NotificationsView — light") {
    NavigationStack { NotificationsView(previewItems: NotificationsPreviewData.items) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}

#Preview("NotificationsView — signed out") {
    NavigationStack { NotificationsView() }
        .yardPreviewEnvironment(signedIn: false)
        .preferredColorScheme(.dark)
}
