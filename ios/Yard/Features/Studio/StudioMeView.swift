import SwiftUI
import UserNotifications
import Observation

/// Studio › Me: the brand (and brand picker), balance, payouts, inbox, Yard Support, share,
/// notifications, Switch to shopping, Sign out.
@MainActor
struct StudioMeView: View {
    @Environment(StudioStore.self) private var studio
    @Environment(SessionStore.self) private var session
    @Environment(ToastCenter.self) private var toast

    @State private var payouts: StudioPayouts?
    @State private var payoutsError: String?
    @State private var showsBrandPicker = false
    @State private var signingOut = false
    @State private var webPage: YouWebPage?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                Text("Me")
                    .yardDisplay(40)
                    .foregroundStyle(Color.yard.ink)
                if let brand = studio.activeBrand {
                    brandHeader(brand)
                    if brand.canSeePayouts {
                        balanceCard
                    }
                }
                StudioGroup("Shop") {
                    if studio.can(StudioPermission.inboxRead) {
                        Button { open(.inbox) } label: {
                            SettingsRow("Inbox", systemImage: "bubble.left.and.bubble.right", value: studio.unreadCount > 0 ? "\(studio.unreadCount) unread" : nil)
                        }
                        .buttonStyle(.plain)
                        divider
                    }
                    Button { open(.thread(.support)) } label: {
                        SettingsRow("Yard Support", systemImage: "lifepreserver")
                    }
                    .buttonStyle(.plain)
                    divider
                    if let brand = studio.activeBrand {
                        ShareLink(item: Config.webURL("/brands/\(brand.handle)")) {
                            SettingsRow("Share shop", systemImage: "square.and.arrow.up")
                        }
                        .buttonStyle(.plain)
                        divider
                    }
                    Button { open(.websitePieces) } label: {
                        SettingsRow("New from your website", systemImage: "globe", value: studio.websitePieces > 0 ? "\(studio.websitePieces)" : nil)
                    }
                    .buttonStyle(.plain)
                }
                StudioGroup("Settings") {
                    Button { open(.notificationSettings) } label: {
                        SettingsRow("Notifications", systemImage: "bell.badge")
                    }
                    .buttonStyle(.plain)
                    divider
                    Button {
                        webPage = YouWebPage(url: Config.webURL("/studio"))
                    } label: {
                        SettingsRow("Studio on the web", systemImage: "safari")
                    }
                    .buttonStyle(.plain)
                }
                VStack(spacing: Spacing.s) {
                    YardButton("Switch to shopping", systemImage: "bag", style: .inverted) {
                        Haptics.impact(.medium)
                        studio.enterShopping()
                    }
                    YardButton("Sign out", style: .ghost, isLoading: signingOut) {
                        signOut()
                    }
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.s)
            .padding(.bottom, Spacing.xl)
        }
        .yardScreenBackground()
        .toolbar(.hidden, for: .navigationBar)
        .refreshable { await loadPayouts() }
        .task(id: "\(studio.activeBrandId ?? "")|\(studio.dataVersion)") { await loadPayouts() }
        .sheet(isPresented: $showsBrandPicker) {
            StudioBrandPicker()
                .yardSheet(detents: [.medium, .large])
        }
        .youWebPage($webPage)
    }

    private var divider: some View {
        Divider().overlay(Color.yard.line).padding(.leading, 60)
    }

    private func open(_ route: StudioRoute) {
        Haptics.selection()
        studio.push(route)
    }

    private func loadPayouts() async {
        guard studio.activeBrand?.canSeePayouts ?? false else { return }
        do {
            payouts = try await studio.call { try await StudioAPI.payouts() }
            payoutsError = nil
        } catch {
            if (error as? APIError)?.isCancelled != true {
                payoutsError = APIError.message(for: error)
            }
        }
    }

    private func brandHeader(_ brand: ShopperBrand) -> some View {
        HStack(spacing: Spacing.m) {
            StudioBrandMark(brand: brand, size: 56, sessionOpen: studio.profile != nil)
            VStack(alignment: .leading, spacing: 4) {
                Text(brand.name)
                    .font(.yardTitle)
                    .foregroundStyle(Color.yard.ink)
                    .lineLimit(1)
                HStack(spacing: Spacing.s) {
                    Text("@\(brand.handle)")
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                    Tag(brand.statusLabel, style: brand.isApproved ? .success : .violet)
                }
            }
            Spacer()
            if studio.studioBrands.count > 1 {
                Button {
                    Haptics.selection()
                    showsBrandPicker = true
                } label: {
                    Label("Switch", systemImage: "arrow.left.arrow.right")
                        .font(.yardCaptionEmphasis)
                        .foregroundStyle(Color.yard.ink)
                        .padding(.horizontal, Spacing.m)
                        .frame(height: 34)
                        .background(Color.yard.surface2, in: Capsule())
                }
                .buttonStyle(PressableButtonStyle(scale: Motion.pressScale))
                .accessibilityLabel(Text("Switch brand"))
            }
        }
        .padding(Spacing.l)
        .yardCard()
    }

    @ViewBuilder
    private var balanceCard: some View {
        StudioInkCard {
            VStack(alignment: .leading, spacing: Spacing.m) {
                HStack {
                    Text("Available balance")
                        .font(.yardCallout.weight(.semibold))
                        .foregroundStyle(Color.yard.onPhoto.opacity(0.7))
                    Spacer()
                    Button {
                        open(.payouts)
                    } label: {
                        Text("Payouts")
                            .font(.yardCaptionEmphasis)
                            .foregroundStyle(Color.yard.onAcid)
                            .padding(.horizontal, Spacing.m)
                            .frame(height: 30)
                            .background(Color.yard.acid, in: Capsule())
                    }
                    .buttonStyle(PressableButtonStyle(scale: Motion.pressScale))
                }
                if let balance = payouts?.balance {
                    Text(Formatters.price(minor: balance.availableMinor, currency: balance.currency))
                        .font(.system(size: 40, weight: .black).width(.compressed))
                        .monospacedDigit()
                        .foregroundStyle(Color.yard.onPhoto)
                        .contentTransition(.numericText())
                    HStack(spacing: Spacing.l) {
                        miniStat("Pending", Formatters.price(minor: balance.pendingMinor, currency: balance.currency))
                        miniStat("In payout", Formatters.price(minor: balance.inPayoutMinor, currency: balance.currency))
                        if balance.reserveMinor > 0 {
                            miniStat("Reserve", Formatters.price(minor: balance.reserveMinor, currency: balance.currency))
                        }
                    }
                    accountLine
                } else if let error = payoutsError {
                    Text(error)
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.onPhoto.opacity(0.75))
                } else {
                    Skeleton(cornerRadius: 6).frame(width: 160, height: 36).opacity(0.3)
                }
            }
        }
    }

    @ViewBuilder
    private var accountLine: some View {
        if let account = payouts?.account {
            Label("\(account.bankName ?? "Bank") ••\(account.accountLast4 ?? "")\(account.verified ? "" : " · checking")", systemImage: account.verified ? "checkmark.seal.fill" : "clock")
                .font(.yardCaptionEmphasis)
                .foregroundStyle(Color.yard.acid)
        } else if payouts != nil {
            Button {
                webPage = YouWebPage(url: Config.webURL("/studio/payouts"))
            } label: {
                Label("Add a payout account on the website", systemImage: "plus.circle.fill")
                    .font(.yardCaptionEmphasis)
                    .foregroundStyle(Color.yard.acid)
            }
            .buttonStyle(.plain)
        }
    }

    private func miniStat(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.yardCaption)
                .foregroundStyle(Color.yard.onPhoto.opacity(0.6))
            Text(value)
                .font(.yardCallout.weight(.semibold))
                .foregroundStyle(Color.yard.onPhoto)
        }
    }

    private func signOut() {
        signingOut = true
        Haptics.impact(.medium)
        Task { @MainActor in
            studio.gate.reset()
            await session.signOut()
            signingOut = false
            toast.show("Signed out")
        }
    }
}

/// Pick the brand to run (several memberships).
@MainActor
struct StudioBrandPicker: View {
    @Environment(StudioStore.self) private var studio
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            YardSheetHeader("Your brands") { dismiss() }
            ScrollView {
                VStack(spacing: Spacing.s) {
                    ForEach(studio.brands) { brand in
                        Button {
                            guard brand.canOpenStudio else { return }
                            Haptics.selection()
                            studio.selectBrand(brand.id)
                            dismiss()
                        } label: {
                            HStack(spacing: Spacing.m) {
                                StudioBrandMark(brand: brand, size: 44, sessionOpen: brand.id == studio.activeBrandId && studio.profile != nil)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(brand.name)
                                        .font(.yardBodyEmphasis)
                                        .foregroundStyle(Color.yard.ink)
                                    Text(brand.statusLabel)
                                        .font(.yardCaption)
                                        .foregroundStyle(Color.yard.ink2)
                                }
                                Spacer()
                                if brand.id == studio.activeBrandId {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(Color.yard.studio)
                                }
                            }
                            .padding(Spacing.m)
                            .yardCard()
                            .opacity(brand.canOpenStudio ? 1 : 0.5)
                        }
                        .buttonStyle(PressableButtonStyle())
                        .disabled(!brand.canOpenStudio)
                    }
                }
                .padding(.horizontal, Spacing.gutter)
            }
        }
        .padding(.top, Spacing.l)
        .yardScreenBackground()
    }
}

// MARK: - Payouts

/// Studio › Payouts: balances, the payout account, why payouts are paused, recent payouts.
@MainActor
struct StudioPayoutsView: View {
    @Environment(StudioStore.self) private var studio
    @State private var data: StudioPayouts?
    @State private var error: String?
    @State private var webPage: YouWebPage?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                if let data {
                    if let balance = data.balance {
                        StudioInkCard {
                            VStack(alignment: .leading, spacing: Spacing.s) {
                                Text("Available")
                                    .font(.yardCallout)
                                    .foregroundStyle(Color.yard.onPhoto.opacity(0.7))
                                Text(Formatters.price(minor: balance.availableMinor, currency: balance.currency))
                                    .font(.system(size: 40, weight: .black).width(.compressed))
                                    .foregroundStyle(Color.yard.onPhoto)
                                Text("Pending \(Formatters.price(minor: balance.pendingMinor, currency: balance.currency)) · In payout \(Formatters.price(minor: balance.inPayoutMinor, currency: balance.currency))")
                                    .font(.yardCaption)
                                    .foregroundStyle(Color.yard.acid)
                            }
                        }
                    }
                    if let rules = data.rules, rules.onHold {
                        Label(rules.holdReason ?? "Payouts are paused by Yard for now.", systemImage: "pause.circle.fill")
                            .font(.yardCallout)
                            .foregroundStyle(Color.yard.danger)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    StudioGroup("Payout account") {
                        if let account = data.account {
                            SettingsRow(account.bankName ?? "Bank account", systemImage: "building.columns", value: "••\(account.accountLast4 ?? "")", showsChevron: false)
                            Divider().overlay(Color.yard.line).padding(.leading, 60)
                            SettingsRow(account.verified ? "Verified" : "Being checked", systemImage: account.verified ? "checkmark.seal" : "clock", showsChevron: false)
                        } else {
                            Button {
                                webPage = YouWebPage(url: Config.webURL("/studio/payouts"))
                            } label: {
                                SettingsRow("Add a payout account", systemImage: "plus.circle", value: "On the website")
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    StudioGroup("Recent payouts") {
                        if data.payouts.isEmpty {
                            Text("Your payouts show here.")
                                .font(.yardCallout)
                                .foregroundStyle(Color.yard.ink2)
                                .padding(Spacing.m)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        } else {
                            ForEach(data.payouts) { payout in
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(payout.amount)
                                            .font(.yardBodyEmphasis)
                                            .foregroundStyle(Color.yard.ink)
                                        if let date = YardDate.parse(payout.paidAt ?? payout.requestedAt) {
                                            Text(Formatters.shortDate(date))
                                                .font(.yardCaption)
                                                .foregroundStyle(Color.yard.ink3)
                                        }
                                    }
                                    Spacer()
                                    Tag(payout.status.replacingOccurrences(of: "_", with: " ").capitalized, style: payout.status == "paid" ? .success : (payout.status == "failed" || payout.status == "rejected" ? .danger : .neutral))
                                }
                                .padding(.horizontal, Spacing.m)
                                .frame(minHeight: 56)
                            }
                        }
                    }
                } else if let error {
                    EmptyState.error(message: error) { await load() }
                } else {
                    Skeleton(cornerRadius: 24).frame(height: 140)
                    StudioRowsSkeleton(count: 3)
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.vertical, Spacing.l)
        }
        .yardScreenBackground()
        .navigationTitle("Payouts")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
        .youWebPage($webPage)
    }

    private func load() async {
        do {
            data = try await studio.call { try await StudioAPI.payouts() }
            error = nil
        } catch {
            if (error as? APIError)?.isCancelled != true {
                self.error = APIError.message(for: error)
            }
        }
    }
}

// MARK: - Notification settings

/// Studio › Notifications: the four push switches (per person and brand) and a test push.
@MainActor
struct StudioNotificationSettingsView: View {
    @Environment(StudioStore.self) private var studio
    @Environment(ToastCenter.self) private var toast

    @State private var prefs: StudioPushPrefs?
    @State private var error: String?
    @State private var testing = false
    @State private var systemAllowed = true

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                if !systemAllowed {
                    VStack(alignment: .leading, spacing: Spacing.s) {
                        Text("Notifications are off for Yard on this iPhone.")
                            .font(.yardBodyEmphasis)
                            .foregroundStyle(Color.yard.ink)
                        YardButton("Turn on", systemImage: "bell", style: .primary, size: .medium) {
                            Task { @MainActor in
                                if await NotificationsPermission.status() == .denied {
                                    NotificationsPermission.openSystemSettings()
                                } else {
                                    systemAllowed = await NotificationsPermission.request()
                                }
                            }
                        }
                    }
                    .padding(Spacing.l)
                    .yardCard()
                }
                if let prefs {
                    StudioGroup("Push notifications") {
                        toggle("New orders", "shippingbox", \.orders, prefs)
                        divider
                        toggle("Messages", "bubble.left", \.messages, prefs)
                        divider
                        toggle("Low stock", "exclamationmark.triangle", \.lowStock, prefs)
                        divider
                        toggle("Payouts", "banknote", \.payouts, prefs)
                    }
                } else if let error {
                    EmptyState.error(message: error) { await load() }
                } else {
                    StudioRowsSkeleton(count: 2)
                }
                YardButton("Send a test notification", systemImage: "paperplane", style: .secondary, isLoading: testing) {
                    test()
                }
                Text("Switches are yours alone and for this brand only.")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink3)
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.vertical, Spacing.l)
        }
        .yardScreenBackground()
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            let status = await NotificationsPermission.status()
            systemAllowed = status == .authorized || status == .provisional || status == .ephemeral
            await load()
        }
    }

    private var divider: some View {
        Divider().overlay(Color.yard.line).padding(.leading, 60)
    }

    private func toggle(_ title: String, _ icon: String, _ key: WritableKeyPath<StudioPushPrefs, Bool>, _ current: StudioPushPrefs) -> some View {
        SettingsRow(title, systemImage: icon) {
            Toggle("", isOn: Binding(
                get: { (prefs ?? current)[keyPath: key] },
                set: { value in save(key, value) }
            ))
            .labelsHidden()
            .tint(Color.yard.acid)
        }
    }

    private func load() async {
        do {
            prefs = try await studio.call { try await StudioAPI.pushPrefs() }
            error = nil
        } catch {
            if (error as? APIError)?.isCancelled != true {
                self.error = APIError.message(for: error)
            }
        }
    }

    private func save(_ key: WritableKeyPath<StudioPushPrefs, Bool>, _ value: Bool) {
        guard var next = prefs else { return }
        let previous = next
        next[keyPath: key] = value
        prefs = next
        Haptics.selection()
        Task { @MainActor in
            do {
                prefs = try await studio.call { try await StudioAPI.savePushPrefs(next) }
            } catch {
                prefs = previous
                Haptics.error()
                toast.show(APIError.message(for: error), style: .error)
            }
        }
    }

    private func test() {
        testing = true
        Haptics.impact(.light)
        Task { @MainActor in
            defer { testing = false }
            // Make sure this iPhone is registered as a Studio device first.
            if await NotificationsPermission.request() {
                await YardPushCenter.shared.uploadTokenIfPossible()
            }
            do {
                let result = try await studio.call { try await StudioAPI.testPush() }
                if result.devices == 0 {
                    Haptics.warning()
                    toast.show("This iPhone isn't registered for Studio notifications yet.", style: .error)
                } else if !result.delivered {
                    Haptics.warning()
                    toast.show("Yard can't send notifications right now.", style: .error)
                } else {
                    Haptics.success()
                    toast.show("Test sent. It should arrive in a moment.", style: .success)
                }
            } catch {
                Haptics.error()
                toast.show(APIError.message(for: error), style: .error)
            }
        }
    }
}
