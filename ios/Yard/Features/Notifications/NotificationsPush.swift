import SwiftUI
import UIKit
import UserNotifications
import Observation

// Push notifications: permission, APNs registration, device-token storage, tap routing.
//
// Wiring (foundation adds TWO lines to App/YardApp.swift):
//
//   @UIApplicationDelegateAdaptor(YardPushAppDelegate.self) private var pushDelegate   // in YardApp
//   .yardPushNotifications()      // on RootView(), after the .environment(...) calls
//
// The modifier needs Router, FollowStore and SessionStore from the environment, so it must sit
// below the `.environment(...)` calls (anywhere after them in the modifier chain is fine).
//
// Device registration (docs/APP.md › Push notifications): `POST /api/devices { platform: "ios",
// token, appVersion, studio }` once signed in, `DELETE /api/devices { token }` before sign-out.
// `studio: true` when the account can open Studio, so the device also gets Studio pushes.
// GAP: the token sent is the APNs device token (hex). The server's sender is FCM (Firebase), which
// needs an FCM registration token; the app has no Firebase SDK (no third-party packages), so
// pushes reach iOS only once the server sends to APNs directly (or the Firebase iOS SDK is added
// and its FCM token is sent here instead). See ios/Docs/studio.md.

// MARK: - Permission

/// Asks for notification permission at good moments (never on launch):
/// after the shopper's first follow (automatic, via `.yardPushNotifications()`), and after they
/// set a drop reminder (`NotificationsPermission.didSetDropReminder()`, for the Drops screen).
@MainActor
enum NotificationsPermission {
    /// The current system authorization status.
    static func status() async -> UNAuthorizationStatus {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        return settings.authorizationStatus
    }

    /// True while the system prompt has never been shown.
    static func canAsk() async -> Bool {
        await status() == .notDetermined
    }

    /// Shows the system prompt (only does anything while `.notDetermined`) and registers for
    /// remote notifications when allowed. Returns whether notifications are allowed.
    @discardableResult
    static func request() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let current = await status()
        switch current {
        case .authorized, .provisional, .ephemeral:
            UIApplication.shared.registerForRemoteNotifications()
            return true
        case .denied:
            return false
        case .notDetermined:
            break
        @unknown default:
            break
        }
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .badge, .sound])
            if granted {
                UIApplication.shared.registerForRemoteNotifications()
            }
            return granted
        } catch {
            return false
        }
    }

    /// Call after the shopper turns on a drop reminder: offers notifications if never asked.
    static func didSetDropReminder() {
        YardPushCenter.shared.offerPermission(reason: .dropReminder(nil))
    }

    /// Call after a drop reminder with the drop name for nicer wording.
    static func didSetDropReminder(dropName: String) {
        YardPushCenter.shared.offerPermission(reason: .dropReminder(dropName))
    }

    /// Opens the app's page in the Settings app (for a "Turn on in Settings" link when denied).
    static func openSystemSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }
}

// MARK: - Push center (shared state between the app delegate and SwiftUI)

@Observable
@MainActor
final class YardPushCenter {
    static let shared = YardPushCenter()

    /// UserDefaults key holding the APNs device token as lowercase hex.
    nonisolated static let tokenDefaultsKey = "yard.push.apnsToken"
    /// UserDefaults key: when the soft prompt was last dismissed with "Not now".
    nonisolated static let declinedAtDefaultsKey = "yard.push.softPromptDeclinedAt"

    enum PrimingReason: Equatable {
        case follow
        case dropReminder(String?)
    }

    /// The APNs device token (hex) once registered.
    private(set) var deviceToken: String?
    /// The last registration error, if any (simulator without push entitlement, etc.).
    private(set) var registrationError: String?
    /// A notification href the user tapped, waiting for the UI to route it.
    var pendingHref: String?
    /// A tapped Studio push (`data.scope == "studio"`): its link and brand, waiting for the UI.
    var pendingStudio: StudioPushTap?
    /// Whether this account can open Studio (sent as `studio` when registering the device).
    private(set) var studioCapable: Bool = false
    /// What was last registered, so it isn't re-sent on every foreground.
    @ObservationIgnored private var registered: (token: String, studio: Bool)?
    /// The soft prompt ("Get drop alerts?") shown before the system prompt.
    var primingReason: PrimingReason?

    private init() {
        deviceToken = UserDefaults.standard.string(forKey: Self.tokenDefaultsKey)
    }

    // Tokens

    func didRegister(deviceToken data: Data) {
        let hex = data.map { String(format: "%02x", $0) }.joined()
        registrationError = nil
        if hex != deviceToken {
            deviceToken = hex
            UserDefaults.standard.set(hex, forKey: Self.tokenDefaultsKey)
        }
        Task { @MainActor in await self.uploadTokenIfPossible() }
    }

    func didFailToRegister(_ error: Error) {
        registrationError = error.localizedDescription
    }

    /// Sends the device token to Yard (`POST /api/devices`, needs the shopper session; 401 when
    /// signed out is ignored). Called on sign-in, on a new token and when Studio access changes.
    func uploadTokenIfPossible() async {
        guard let token = deviceToken, !token.isEmpty else { return }
        if let registered, registered.token == token, registered.studio == studioCapable { return }
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let body = YardDeviceBody(platform: "ios", token: token, appVersion: version, studio: studioCapable)
        do {
            try await APIClient.shared.send(.post, "/api/devices", body: body)
            registered = (token, studioCapable)
        } catch {
            // Signed out or offline: tried again on the next sign-in or foreground.
        }
    }

    /// Studio access changed for the signed-in account: re-register with `studio`.
    func setStudioCapable(_ capable: Bool) {
        guard capable != studioCapable else { return }
        studioCapable = capable
        if capable {
            Task { @MainActor in await self.uploadTokenIfPossible() }
        }
    }

    /// `DELETE /api/devices { token }`: call before signing out (it needs the session).
    func unregisterDevice() async {
        guard let token = deviceToken, !token.isEmpty else { return }
        try? await APIClient.shared.send(.delete, "/api/devices", body: YardDeviceTokenBody(token: token))
        registered = nil
    }

    // Soft prompt

    /// Offers notifications (soft prompt, then the system one) if the system has never asked and
    /// the shopper didn't say "Not now" in the last 7 days.
    func offerPermission(reason: PrimingReason) {
        Task { @MainActor in
            guard await NotificationsPermission.canAsk() else { return }
            let declinedAt = UserDefaults.standard.double(forKey: Self.declinedAtDefaultsKey)
            if declinedAt > 0, Date().timeIntervalSince1970 - declinedAt < 7 * 86_400 { return }
            self.primingReason = reason
        }
    }

    func acceptPriming() {
        primingReason = nil
        Task { @MainActor in
            _ = await NotificationsPermission.request()
        }
    }

    func declinePriming() {
        primingReason = nil
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: Self.declinedAtDefaultsKey)
    }

    // Taps

    /// Records a tapped push's destination. Payload contract (for the server, once it sends pushes):
    /// `{ "aps": { "alert": { "title", "body" } }, "href": "/you/orders/ord_1", "key": "<event key>" }`.
    func handleTap(userInfo: [AnyHashable: Any]) {
        // Studio push (docs/APP.md › Push for brands): `scope: "studio"`, `brandId`, `link`, `url`.
        if (userInfo["scope"] as? String) == "studio" {
            let raw = (userInfo["link"] as? String) ?? (userInfo["url"] as? String) ?? "yard://studio"
            let link = URL(string: raw).flatMap { StudioLink(url: $0) } ?? StudioLink(path: raw) ?? .home
            pendingStudio = StudioPushTap(link: link, brandId: userInfo["brandId"] as? String)
            return
        }
        if let url = userInfo["url"] as? String, !url.isEmpty, (userInfo["href"] as? String)?.isEmpty ?? true {
            pendingHref = url
            return
        }
        if let href = userInfo["href"] as? String, !href.isEmpty {
            pendingHref = href
        } else {
            pendingHref = "/notifications"
        }
    }
}

/// A tapped Studio push waiting to be opened.
struct StudioPushTap: Equatable, Sendable {
    let link: StudioLink
    let brandId: String?
}

/// POST /api/devices body.
struct YardDeviceBody: Encodable, Sendable {
    let platform: String
    let token: String
    let appVersion: String?
    let studio: Bool
}

/// DELETE /api/devices body.
struct YardDeviceTokenBody: Encodable, Sendable {
    let token: String
}

// MARK: - App delegate

/// Registers the notification-center delegate and receives the APNs token.
/// Attach with `@UIApplicationDelegateAdaptor(YardPushAppDelegate.self)` in `YardApp`.
@MainActor
final class YardPushAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        // Live Activities: the server may wake the app for an activity it started (push-to-start)
        // so the app can upload that activity's push token (Features/LiveActivity).
        Task { @MainActor in LiveActivityManager.shared.startObserving() }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        YardPushCenter.shared.didRegister(deviceToken: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        YardPushCenter.shared.didFailToRegister(error)
    }

    // Show banners while the app is open (the in-app list refreshes on its own).
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let userInfo = response.notification.request.content.userInfo
        // Copy the string fields the router needs (the dictionary itself isn't Sendable).
        var fields: [String: String] = [:]
        for key in ["href", "url", "scope", "brandId", "link", "kind", "id"] {
            if let value = userInfo[key] as? String, !value.isEmpty { fields[key] = value }
        }
        Task { @MainActor in
            YardPushCenter.shared.handleTap(userInfo: fields)
        }
        completionHandler()
    }
}

// MARK: - SwiftUI hook

extension View {
    /// Push wiring for the root: re-registers when already allowed, offers notifications after
    /// the first follow, routes tapped pushes, and hosts the soft prompt. Attach once, in YardApp.
    @MainActor
    func yardPushNotifications() -> some View {
        modifier(YardPushNotificationsModifier())
    }
}

@MainActor
private struct YardPushNotificationsModifier: ViewModifier {
    @Environment(Router.self) private var router
    @Environment(FollowStore.self) private var follows
    @Environment(SessionStore.self) private var session
    @Environment(StudioStore.self) private var studio

    private let center = YardPushCenter.shared

    func body(content: Content) -> some View {
        content
            .task {
                // Apple recommends registering on every launch once allowed (tokens can change).
                let status = await NotificationsPermission.status()
                if status == .authorized || status == .provisional || status == .ephemeral {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
            .task(id: session.shopper?.id ?? "signed-out") {
                if session.isSignedIn {
                    await center.uploadTokenIfPossible()
                }
            }
            .onChange(of: follows.followedIds) { oldValue, newValue in
                // A tap on Follow inserts exactly one id after the list has loaded; a load
                // happens while `isLoading` is true, so it never counts as a follow.
                guard follows.hasLoaded, !follows.isLoading else { return }
                guard newValue.count == oldValue.count + 1, oldValue.isSubset(of: newValue) else { return }
                center.offerPermission(reason: .follow)
            }
            .onChange(of: center.pendingStudio) { _, tap in
                guard let tap else { return }
                center.pendingStudio = nil
                if !studio.open(tap.link, brandId: tap.brandId) {
                    // E.g. "Your shop is ready": the brand isn't in this session yet. Re-read it.
                    Task { @MainActor in
                        await session.refresh()
                        studio.sync(shopper: session.shopper)
                        if !studio.open(tap.link, brandId: tap.brandId) {
                            router.show(.notifications, in: .you)
                        }
                    }
                }
            }
            .onChange(of: center.pendingHref) { _, href in
                guard let href else { return }
                center.pendingHref = nil
                route(href)
            }
            .sheet(isPresented: primingBinding) {
                NotificationsPrimingSheet(
                    reason: center.primingReason ?? .follow,
                    onAccept: { center.acceptPriming() },
                    onDecline: { center.declinePriming() }
                )
                .yardSheet(detents: [.medium], showsGrabber: true)
            }
    }

    private var primingBinding: Binding<Bool> {
        Binding<Bool>(
            get: { center.primingReason != nil && router.sheet == nil },
            set: { presented in
                if !presented && center.primingReason != nil {
                    center.declinePriming()
                }
            }
        )
    }

    private func route(_ href: String) {
        if href == "/notifications" {
            router.show(.notifications, in: .you)
            return
        }
        guard let route = NotificationsRouting.route(for: href) else {
            router.show(.notifications, in: .you)
            return
        }
        switch route {
        case .order, .orders, .conversation, .inbox, .support, .myDrops, .notifications:
            router.show(route, in: .you)
        default:
            router.show(route, in: .home)
        }
    }
}

// MARK: - Soft prompt

/// "Get drop alerts?" — shown right after the first follow or a drop reminder, before the system
/// prompt, so the one-time system dialog appears when it makes sense.
private struct NotificationsPrimingSheet: View {
    let reason: YardPushCenter.PrimingReason
    let onAccept: () -> Void
    let onDecline: () -> Void

    private var title: String {
        switch reason {
        case .follow: return "Never miss a drop"
        case .dropReminder: return "Get your reminder"
        }
    }

    private var message: String {
        switch reason {
        case .follow:
            return "Turn on notifications for drops from the brands you follow, order updates and replies from brands."
        case .dropReminder(let name):
            if let name, !name.isEmpty {
                return "Turn on notifications so we can tell you the moment \(name) drops, plus order updates and replies from brands."
            }
            return "Turn on notifications so we can tell you the moment it drops, plus order updates and replies from brands."
        }
    }

    var body: some View {
        VStack(spacing: Spacing.l) {
            Image(systemName: "bell.badge")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(Color.yard.onAcid)
                .frame(width: 72, height: 72)
                .background(Color.yard.acid, in: Circle())
                .accessibilityHidden(true)
                .padding(.top, Spacing.xl)

            VStack(spacing: Spacing.s) {
                Text(title).yardDisplay(34)
                    .foregroundStyle(Color.yard.ink)
                    .multilineTextAlignment(.center)
                Text(message)
                    .font(.yardBody)
                    .foregroundStyle(Color.yard.ink2)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)

            VStack(spacing: Spacing.s) {
                YardButton("Turn on notifications", systemImage: "bell", style: .primary, action: onAccept)
                YardButton("Not now", style: .ghost, action: onDecline)
            }
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.bottom, Spacing.l)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.yard.bg.ignoresSafeArea())
    }
}

#Preview("Push soft prompt — dark") {
    NotificationsPrimingSheet(reason: .follow, onAccept: {}, onDecline: {})
        .preferredColorScheme(.dark)
}

#Preview("Push soft prompt — light") {
    NotificationsPrimingSheet(reason: .dropReminder("Night Shift"), onAccept: {}, onDecline: {})
        .preferredColorScheme(.light)
}
