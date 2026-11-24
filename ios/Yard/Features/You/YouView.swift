import SwiftUI

/// The You tab root.
/// - Signed out: an invite card (Sign in / Create account, both present SignInView) plus help and legal links.
/// - Signed in: profile header (photo or initials avatar, greeting, name, email), one quick-links panel
///   (Orders, Saved, Following, Inbox, Drop reminders, Updates, each with a real badge when known), links (Settings, Sell on Yard), Help (Message Yard Support,
///   Help centre) and legal (Terms, Privacy, Refunds).
@MainActor
struct YouView: View {
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @Environment(SavedStore.self) private var saved
    @Environment(FollowStore.self) private var follows
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var webPage: YouWebPage? = nil
    @State private var badges: YouBadgesModel

    init() {
        _badges = State(initialValue: YouBadgesModel())
    }

    /// Previews only.
    fileprivate init(badges: YouBadgesModel) {
        _badges = State(initialValue: badges)
    }

    var body: some View {
        ScrollView {
            TabPillScrollSensor()
            VStack(alignment: .leading, spacing: Spacing.xl) {
                topBar
                if session.isSignedIn, let shopper = session.shopper {
                    VStack(alignment: .leading, spacing: Spacing.l) {
                        profileHeader(shopper)
                        quickLinks
                    }
                    // Studio: switch to a brand, the application's status, or Sell on Yard.
                    StudioYouSection()
                } else if !session.hasLoaded {
                    loadingHeader
                } else {
                    inviteCard
                }
                links
                help
                legal
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.s)
            .padding(.bottom, Spacing.xl)
        }
        .yardScreenBackground()
        .toolbar(.hidden, for: .navigationBar)
        .refreshable {
            await session.refresh()
            if let id = session.shopper?.id, session.isSignedIn {
                await loadBadges(id, force: true)
                await saved.load()
                await follows.load()
            }
        }
        // Real counts for the quick links: on sign-in change (forced), and on coming back here.
        // Tabs stay alive in RootView's ZStack, so a tab switch doesn't fire onAppear: watch
        // the selected tab too. onAppear covers popping back from Inbox, Updates or Orders.
        // Unforced reloads are throttled to 1.5 s (as Android), so a read item clears its badge.
        .task(id: session.shopper?.id ?? "signed-out") {
            if session.isSignedIn, let id = session.shopper?.id { await loadBadges(id, force: true) } else { badges.reset() }
        }
        .onAppear { refreshBadgesIfVisible() }
        .onChange(of: router.selectedTab) { _, tab in
            if tab == .you { refreshBadgesIfVisible() }
        }
        .youWebPage($webPage)
    }

    /// Loads the badges. The panel animates the change via `.animation` (a plain fade under Reduce Motion).
    private func loadBadges(_ accountId: String, force: Bool) async {
        await badges.load(accountId: accountId, force: force)
    }

    private func refreshBadgesIfVisible() {
        guard session.isSignedIn, let id = session.shopper?.id else { return }
        // The model drops results that arrive after an account change or reset, so this
        // short-lived task can't write a previous account's counts.
        Task { @MainActor in await loadBadges(id, force: false) }
    }

    // MARK: Header

    private var topBar: some View {
        HStack {
            Text("You").yardDisplay(40).foregroundStyle(Color.yard.ink)
            Spacer()
            GlassIconButton(systemImage: "gearshape", accessibilityLabel: "Settings", size: 40) {
                router.push(.settings)
            }
        }
    }

    private func greeting(_ date: Date = Date()) -> String {
        let hour = Calendar.current.component(.hour, from: date)
        if hour < 5 { return "Up late" }
        if hour < 12 { return "Good morning" }
        if hour < 18 { return "Good afternoon" }
        return "Good evening"
    }

    private func profileHeader(_ shopper: Shopper) -> some View {
        HStack(alignment: .center, spacing: Spacing.m + Spacing.xs) {
            PersonAvatar(initials: shopper.initials, photoURL: session.photoURL, localImage: session.pendingPhoto, size: 60)
                .padding(3)
                .overlay(Circle().strokeBorder(Color.yard.line, lineWidth: 1))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(greeting().uppercased())
                    .font(.yardMicro)
                    .tracking(1.1)
                    .foregroundStyle(Color.yard.violet)
                Text(shopper.name.isEmpty ? "Your World" : shopper.name)
                    .yardDisplay(28)
                    .foregroundStyle(Color.yard.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if !shopper.email.isEmpty {
                    Text(shopper.email)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink3)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.top, Spacing.xs)
        .accessibilityElement(children: .combine)
    }

    private var loadingHeader: some View {
        HStack(spacing: Spacing.l) {
            Skeleton(shape: .circle).frame(width: 66, height: 66)
            VStack(alignment: .leading, spacing: Spacing.s) {
                Skeleton(cornerRadius: 4).frame(width: 160, height: 20)
                Skeleton(cornerRadius: 4).frame(width: 120, height: 12)
            }
            Spacer()
        }
    }

    // MARK: Quick links

    /// One panel, six cells. Badges only from data the app loaded; hidden when unknown or zero.
    private var quickLinks: some View {
        func attentionBadge(_ n: Int?) -> YouQuickLink.Badge {
            guard let n, n > 0 else { return .none }
            return .attention(n)
        }
        func totalBadge(_ n: Int?) -> YouQuickLink.Badge {
            guard let n, n > 0 else { return .none }
            return .total(n)
        }
        func dotBadge(_ n: Int?) -> YouQuickLink.Badge {
            guard let n, n > 0 else { return .none }
            return .dot(n)
        }
        let savedCount: Int? = saved.hasLoaded ? saved.items.count : nil
        let followingCount: Int? = follows.hasLoaded ? follows.items.count : nil
        let links: [YouQuickLink] = [
            YouQuickLink(title: "Orders", systemImage: "shippingbox", route: .orders,
                         badge: attentionBadge(badges.ordersInProgress),
                         accessibilityValue: (badges.ordersInProgress ?? 0) > 0 ? "\(badges.ordersInProgress ?? 0) in progress" : nil),
            YouQuickLink(title: "Saved", systemImage: "heart", route: .saved,
                         badge: totalBadge(savedCount),
                         accessibilityValue: (savedCount ?? 0) > 0 ? "\(savedCount ?? 0) saved" : nil),
            YouQuickLink(title: "Following", systemImage: "person.2", route: .following,
                         badge: totalBadge(followingCount),
                         accessibilityValue: (followingCount ?? 0) > 0 ? "\(followingCount ?? 0) brands" : nil),
            YouQuickLink(title: "Inbox", systemImage: "bubble.left.and.bubble.right", route: .inbox,
                         badge: dotBadge(badges.inboxUnread),
                         accessibilityValue: (badges.inboxUnread ?? 0) > 0 ? "\(badges.inboxUnread ?? 0) unread" : nil),
            YouQuickLink(title: "Drop reminders", systemImage: "bell.badge", route: .myDrops,
                         badge: totalBadge(badges.dropReminders),
                         accessibilityValue: (badges.dropReminders ?? 0) > 0 ? "\(badges.dropReminders ?? 0) set" : nil),
            YouQuickLink(title: "Updates", systemImage: "bell", route: .notifications,
                         badge: attentionBadge(badges.updatesUnread),
                         accessibilityValue: (badges.updatesUnread ?? 0) > 0 ? "\(badges.updatesUnread ?? 0) unread" : nil),
        ]
        return YouQuickLinksPanel(links: links)
            .animation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion), value: links.map(\.badge))
    }

    // MARK: Invite (signed out)

    private var inviteCard: some View {
        Card(padding: Spacing.xl) {
            VStack(alignment: .leading, spacing: Spacing.m) {
                YardLogo(color: Color.yard.acid)
                    .frame(height: 28)
                    .accessibilityHidden(true)
                Text("Your World").yardDisplay(36).foregroundStyle(Color.yard.ink)
                Text("Sign in to see drops from the brands you follow, everything you've saved and every order, across every brand, in one place.")
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                VStack(spacing: Spacing.s) {
                    YardButton("Sign in") { router.present(.signIn) }
                    YardButton("Create account", style: .secondary) { router.present(.signIn) }
                }
                .padding(.top, Spacing.xs)
            }
        }
    }

    // MARK: Links

    private var links: some View {
        YouSettingsGroup(nil) {
            NavigationLink(value: Route.settings) {
                SettingsRow("Settings", systemImage: "gearshape")
            }
            .buttonStyle(.plain)
            if !session.isSignedIn {
                Button { webPage = .sell } label: {
                    SettingsRow("Sell on Yard", systemImage: "storefront")
                }
                .buttonStyle(.plain)
            }
        }
    }

    /// Help: the native Yard Support thread, and the website's help centre.
    private var help: some View {
        YouSettingsGroup("Help", footer: "Questions about an order, a payment or your account? Yard's team replies in the app and in your notifications.") {
            NavigationLink(value: Route.support(orderId: nil, orderReference: nil)) {
                SettingsRow("Message Yard Support", systemImage: "bubble.left.and.bubble.right")
            }
            .buttonStyle(.plain)
            Button { webPage = .help } label: {
                SettingsRow("Help centre", systemImage: "questionmark.circle")
            }
            .buttonStyle(.plain)
        }
    }

    private var legal: some View {
        YouSettingsGroup("Legal") {
            ForEach([LegalPage.terms, LegalPage.privacy, LegalPage.refunds]) { page in
                NavigationLink(value: Route.legal(page)) {
                    SettingsRow(page.title, systemImage: YouLegalIcon.systemImage(for: page))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

#Preview("YouView — dark") {
    NavigationStack { YouView(badges: YouBadgesModel(preview: 2, inbox: 1, updates: 4, reminders: 3)) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("YouView — light") {
    NavigationStack { YouView() }
        .yardPreviewEnvironment(signedIn: false)
        .preferredColorScheme(.light)
}
