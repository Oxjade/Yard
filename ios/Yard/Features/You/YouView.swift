import SwiftUI

/// The You tab root.
/// - Signed out: an invite card (Sign in / Create account, both present SignInView) plus help and legal links.
/// - Signed in: profile header (initials avatar, name, email), quick tiles (Orders, Saved, Following,
///   Inbox, Drop reminders, Notifications), links (Settings, Sell on Yard), Help (Message Yard Support,
///   Help centre) and legal (Terms, Privacy, Refunds).
@MainActor
struct YouView: View {
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @Environment(SavedStore.self) private var saved
    @Environment(FollowStore.self) private var follows

    @State private var webPage: YouWebPage? = nil

    init() {}

    var body: some View {
        ScrollView {
            TabPillScrollSensor()
            VStack(alignment: .leading, spacing: Spacing.xl) {
                topBar
                if session.isSignedIn, let shopper = session.shopper {
                    profileHeader(shopper)
                    tiles
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
            if session.isSignedIn {
                await saved.load()
                await follows.load()
            }
        }
        .youWebPage($webPage)
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
        HStack(spacing: Spacing.l) {
            Text(shopper.initials)
                .font(.yardDisplay(30))
                .foregroundStyle(Color.yard.onAcid)
                .frame(width: 72, height: 72)
                .background(Color.yard.acid, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text("\(greeting()),")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.violet)
                Text(shopper.name.isEmpty ? "Your World" : shopper.name)
                    .yardDisplay(30)
                    .foregroundStyle(Color.yard.ink)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                if !shopper.email.isEmpty {
                    Text(shopper.email)
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.ink2)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    private var loadingHeader: some View {
        HStack(spacing: Spacing.l) {
            Skeleton(shape: .circle).frame(width: 72, height: 72)
            VStack(alignment: .leading, spacing: Spacing.s) {
                Skeleton(cornerRadius: 4).frame(width: 160, height: 20)
                Skeleton(cornerRadius: 4).frame(width: 120, height: 12)
            }
            Spacer()
        }
    }

    // MARK: Tiles

    private var tiles: some View {
        let columns: [GridItem] = Array(repeating: GridItem(.flexible(), spacing: Spacing.s), count: 3)
        return LazyVGrid(columns: columns, spacing: Spacing.s) {
            YouTile(title: "Orders", systemImage: "shippingbox", count: nil, route: .orders)
            YouTile(title: "Saved", systemImage: "heart", count: saved.items.count, route: .saved)
            YouTile(title: "Following", systemImage: "person.2", count: follows.items.count, route: .following)
            YouTile(title: "Inbox", systemImage: "bubble.left.and.bubble.right", count: nil, route: .inbox)
            YouTile(title: "Drop reminders", systemImage: "bell.badge", count: nil, route: .myDrops)
            YouTile(title: "Updates", systemImage: "bell", count: nil, route: .notifications)
        }
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
            Button { webPage = .sell } label: {
                SettingsRow("Sell on Yard", systemImage: "storefront")
            }
            .buttonStyle(.plain)
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

/// A quick tile: icon, title, optional real count.
private struct YouTile: View {
    let title: String
    let systemImage: String
    let count: Int?
    let route: Route

    var body: some View {
        NavigationLink(value: route) {
            VStack(alignment: .leading, spacing: Spacing.s) {
                HStack(alignment: .top) {
                    Image(systemName: systemImage)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Color.yard.ink)
                        .frame(width: 36, height: 36)
                        .background(Color.yard.surface2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    Spacer(minLength: 0)
                    if let count, count > 0 {
                        Text(Formatters.count(count))
                            .font(.yardNumber(15))
                            .foregroundStyle(Color.yard.ink)
                    }
                }
                Text(title)
                    .font(.yardCaptionEmphasis)
                    .foregroundStyle(Color.yard.ink)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, minHeight: 32, alignment: .topLeading)
            }
            .padding(Spacing.m)
            .frame(maxWidth: .infinity, alignment: .leading)
            .yardCard()
            .contentShape(RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityLabel(Text(count.map { "\(title), \($0)" } ?? title))
    }
}

#Preview("YouView — dark") {
    NavigationStack { YouView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("YouView — light") {
    NavigationStack { YouView() }
        .yardPreviewEnvironment(signedIn: false)
        .preferredColorScheme(.light)
}
