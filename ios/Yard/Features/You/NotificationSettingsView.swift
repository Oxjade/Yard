import SwiftUI
import UIKit
import Observation

// You › Settings › Notifications. Mirrors the website's settings (src/components/market/account/settings-view.tsx):
//   GET/PATCH /api/notifications/preferences?as=shopper  { preferences: { email: {…}, inApp: {…} } }
//   categories: drops, price_drops, back_in_stock, brand_news
//   GET/PATCH /api/inbox/settings { readReceipts }
// Each switch saves at once; a topic writes its email flag only while Email is on, so switching a
// topic on never restarts email the shopper turned off. Email off stops every topic's email.

/// One set of optional-category flags. All optional so a PATCH only sends what changed.
struct YouPrefFlags: Codable, Sendable, Equatable {
    var drops: Bool?
    var priceDrops: Bool?
    var backInStock: Bool?
    var brandNews: Bool?

    enum CodingKeys: String, CodingKey {
        case drops
        case priceDrops = "price_drops"
        case backInStock = "back_in_stock"
        case brandNews = "brand_news"
    }

    init(drops: Bool? = nil, priceDrops: Bool? = nil, backInStock: Bool? = nil, brandNews: Bool? = nil) {
        self.drops = drops
        self.priceDrops = priceDrops
        self.backInStock = backInStock
        self.brandNews = brandNews
    }

    var anyOn: Bool { drops == true || priceDrops == true || backInStock == true || brandNews == true }
}

struct YouPreferences: Codable, Sendable, Equatable {
    var email: YouPrefFlags
    var inApp: YouPrefFlags
}

private struct YouPreferencesResponse: Decodable, Sendable {
    let preferences: YouPreferences
}

private struct YouPreferencesPatch: Encodable, Sendable {
    var email: YouPrefFlags?
    var inApp: YouPrefFlags?
}

private struct YouInboxSettings: Codable, Sendable {
    let readReceipts: Bool
}

/// The topics a shopper can switch, each one server category.
enum YouNotifyTopic: String, CaseIterable, Identifiable, Sendable {
    case drops
    case brandNews
    case priceDrops
    case backInStock

    var id: String { rawValue }

    var title: String {
        switch self {
        case .drops: return "Drops"
        case .brandNews: return "New products and collections"
        case .priceDrops: return "Promotions"
        case .backInStock: return "Back in stock"
        }
    }

    var detail: String {
        switch self {
        case .drops: return "Announcements from brands you follow, and the reminders you set with Notify me."
        case .brandNews: return "When a brand you follow adds new pieces or a new collection."
        case .priceDrops: return "Sales and offers from brands you follow. Never from brands you don't."
        case .backInStock: return "When a piece you saved is available again."
        }
    }

    var systemImage: String {
        switch self {
        case .drops: return "bolt"
        case .brandNews: return "sparkles"
        case .priceDrops: return "tag"
        case .backInStock: return "shippingbox"
        }
    }

    func value(in flags: YouPrefFlags) -> Bool {
        switch self {
        case .drops: return flags.drops ?? false
        case .brandNews: return flags.brandNews ?? false
        case .priceDrops: return flags.priceDrops ?? false
        case .backInStock: return flags.backInStock ?? false
        }
    }

    func flags(_ value: Bool) -> YouPrefFlags {
        switch self {
        case .drops: return YouPrefFlags(drops: value)
        case .brandNews: return YouPrefFlags(brandNews: value)
        case .priceDrops: return YouPrefFlags(priceDrops: value)
        case .backInStock: return YouPrefFlags(backInStock: value)
        }
    }
}

@Observable
@MainActor
final class YouNotificationsModel {
    enum Phase: Equatable {
        case loading
        case loaded
        case failed(String)
    }

    private(set) var phase: Phase = .loading
    private(set) var prefs = YouPreferences(email: YouPrefFlags(), inApp: YouPrefFlags())
    private(set) var readReceipts: Bool? = nil
    private(set) var isSaving = false
    /// "Drops off. Saved." under the list, like the website's quiet note.
    private(set) var lastChange: String? = nil

    private let query = [URLQueryItem(name: "as", value: "shopper")]

    /// Email reads on while any topic still sends email.
    var emailOn: Bool { prefs.email.anyOn }

    func load() async {
        if phase != .loaded { phase = .loading }
        do {
            let r: YouPreferencesResponse = try await APIClient.shared.get("/api/notifications/preferences", query: query)
            prefs = r.preferences
            phase = .loaded
        } catch {
            if let api = error as? APIError, api.isCancelled { return }
            phase = .failed(APIError.message(for: error))
            return
        }
        // Read receipts are a separate inbox setting; a failure here only hides that row.
        do {
            let s: YouInboxSettings = try await APIClient.shared.get("/api/inbox/settings")
            readReceipts = s.readReceipts
        } catch {
            readReceipts = nil
        }
    }

    func setTopic(_ topic: YouNotifyTopic, _ value: Bool, toast: ToastCenter) async {
        let before = prefs
        var patch = YouPreferencesPatch(email: nil, inApp: topic.flags(value))
        if emailOn { patch.email = topic.flags(value) }
        apply(patch)
        await save(patch, rollback: before, note: "\(topic.title) \(value ? "on" : "off"). Saved.", toast: toast)
    }

    func setEmail(_ value: Bool, toast: ToastCenter) async {
        let before = prefs
        let email: YouPrefFlags = value
            ? YouPrefFlags(
                drops: prefs.inApp.drops ?? false,
                priceDrops: prefs.inApp.priceDrops ?? false,
                backInStock: prefs.inApp.backInStock ?? true,
                brandNews: prefs.inApp.brandNews ?? false
            )
            : YouPrefFlags(drops: false, priceDrops: false, backInStock: false, brandNews: false)
        let patch = YouPreferencesPatch(email: email, inApp: nil)
        apply(patch)
        await save(patch, rollback: before, note: "Email notifications \(value ? "on" : "off"). Saved.", toast: toast)
    }

    func setReadReceipts(_ value: Bool, toast: ToastCenter) async {
        let before = readReceipts
        readReceipts = value
        do {
            let s: YouInboxSettings = try await APIClient.shared.patch("/api/inbox/settings", body: YouInboxSettings(readReceipts: value))
            readReceipts = s.readReceipts
            lastChange = "Read receipts \(value ? "on" : "off"). Saved."
        } catch {
            readReceipts = before
            toast.show(error)
        }
    }

    private func apply(_ patch: YouPreferencesPatch) {
        if let e = patch.email { prefs.email = merged(prefs.email, e) }
        if let i = patch.inApp { prefs.inApp = merged(prefs.inApp, i) }
    }

    private func merged(_ a: YouPrefFlags, _ b: YouPrefFlags) -> YouPrefFlags {
        YouPrefFlags(
            drops: b.drops ?? a.drops,
            priceDrops: b.priceDrops ?? a.priceDrops,
            backInStock: b.backInStock ?? a.backInStock,
            brandNews: b.brandNews ?? a.brandNews
        )
    }

    private func save(_ patch: YouPreferencesPatch, rollback: YouPreferences, note: String, toast: ToastCenter) async {
        isSaving = true
        defer { isSaving = false }
        do {
            let r: YouPreferencesResponse = try await APIClient.shared.patch("/api/notifications/preferences", body: patch, query: query)
            prefs = r.preferences
            lastChange = note
        } catch {
            prefs = rollback
            if let api = error as? APIError, api.isCancelled { return }
            toast.show("Notification settings weren't saved. Try again.", style: .error)
        }
    }
}

@MainActor
struct NotificationSettingsView: View {
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @Environment(ToastCenter.self) private var toast
    @Environment(FollowStore.self) private var follows
    @State private var model = YouNotificationsModel()

    init() {}

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .yardScreenBackground()
            .navigationTitle("Notifications")
            .navigationBarTitleDisplayMode(.inline)
            .task(id: session.shopper?.id) {
                if session.isSignedIn { await model.load() }
            }
    }

    @ViewBuilder
    private var content: some View {
        if !session.isSignedIn {
            EmptyState.signedOut(message: "Sign in to choose what you hear about from the brands you follow.") {
                router.present(.signIn)
            }
        } else {
            switch model.phase {
            case .loading:
                ScrollView {
                    VStack(spacing: Spacing.xl) {
                        YouSettingsGroup("Tell me about") {
                            ForEach(0..<4, id: \.self) { _ in YouSkeletonRow() }
                        }
                        YouSettingsGroup("Send them by") {
                            YouSkeletonRow()
                        }
                    }
                    .padding(.horizontal, Spacing.gutter)
                    .padding(.top, Spacing.m)
                }
            case .failed(let message):
                EmptyState.error(message: message) { await model.load() }
            case .loaded:
                loaded
            }
        }
    }

    private var followingNote: String {
        let n = follows.items.count
        return n == 1 ? "Right now that covers 1 brand." : "Right now that covers \(n) brands."
    }

    private var loaded: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                Card {
                    HStack(alignment: .top, spacing: Spacing.m) {
                        Image(systemName: "bell.badge")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(Color.yard.violet)
                        VStack(alignment: .leading, spacing: Spacing.xs) {
                            Text("Brands you follow and the drop reminders you set only reach you for the topics, and through the channels, switched on below.")
                                .font(.yardCallout)
                                .foregroundStyle(Color.yard.ink)
                            if !follows.items.isEmpty {
                                Text(followingNote)
                                    .font(.yardCaption)
                                    .foregroundStyle(Color.yard.ink2)
                            }
                        }
                    }
                }

                YouSettingsGroup("Tell me about") {
                    ForEach(YouNotifyTopic.allCases) { topic in
                        YouToggleRow(
                            title: topic.title,
                            detail: topic.detail,
                            systemImage: topic.systemImage,
                            isOn: Binding(
                                get: { topic.value(in: model.prefs.inApp) },
                                set: { v in Task { @MainActor in await model.setTopic(topic, v, toast: toast) } }
                            )
                        )
                    }
                }

                YouSettingsGroup(
                    "Send them by",
                    footer: model.emailOn
                        ? "Account, order and payout emails are always sent."
                        : "Email is off. Updates still appear in Notifications and your Following feed, but nothing will be emailed to you."
                ) {
                    YouToggleRow(
                        title: "Email",
                        detail: "Sent to \(session.shopper?.email ?? "the address on your account").",
                        systemImage: "envelope",
                        isOn: Binding(
                            get: { model.emailOn },
                            set: { v in Task { @MainActor in await model.setEmail(v, toast: toast) } }
                        )
                    )
                    Button {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            UIApplication.shared.open(url)
                        }
                    } label: {
                        SettingsRow("Push on this iPhone", systemImage: "iphone", value: "iOS Settings")
                    }
                    .buttonStyle(.plain)
                }

                if let receipts = model.readReceipts {
                    YouSettingsGroup("Messages", footer: "Refunds, returns and delivery problems stay on each order page.") {
                        YouToggleRow(
                            title: "Send read receipts",
                            detail: "Brands see \u{201C}Seen\u{201D} when you've read their reply. Turn it off and you won't see when they've read yours either.",
                            systemImage: "checkmark.message",
                            isOn: Binding(
                                get: { receipts },
                                set: { v in Task { @MainActor in await model.setReadReceipts(v, toast: toast) } }
                            )
                        )
                    }
                }

                HStack(spacing: Spacing.xs) {
                    if let note = model.lastChange {
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(Color.yard.violet)
                        Text(note)
                            .foregroundStyle(Color.yard.ink2)
                    } else {
                        Text("Changes save as you switch.")
                            .foregroundStyle(Color.yard.ink3)
                    }
                }
                .font(.yardCaption)
                .padding(.horizontal, Spacing.xs)
                .animation(Motion.fade, value: model.lastChange)
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.m)
            .padding(.bottom, Spacing.xxl)
        }
        .sensoryFeedback(.selection, trigger: model.prefs)
    }
}

#Preview("NotificationSettingsView — dark") {
    NavigationStack { NotificationSettingsView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("NotificationSettingsView — light") {
    NavigationStack { NotificationSettingsView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
