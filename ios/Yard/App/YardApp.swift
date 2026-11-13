import SwiftUI
import UIKit

/// App entry: creates the shared stores once, injects them, applies the appearance choice.
@main
@MainActor
struct YardApp: App {
    @State private var session = SessionStore()
    @State private var cart = CartStore()
    @State private var follows = FollowStore()
    @State private var saved = SavedStore()
    @State private var router = Router()
    @State private var toast = ToastCenter()

    /// Notification-center delegate and APNs token (Features/Notifications/NotificationsPush.swift).
    @UIApplicationDelegateAdaptor(YardPushAppDelegate.self) private var pushDelegate

    /// "system" | "light" | "dark" (`AppearancePreference`), set in You › Settings › Appearance.
    @AppStorage(AppearancePreference.storageKey) private var appearance: String = AppearancePreference.system.rawValue

    @Environment(\.scenePhase) private var scenePhase

    private var preferredScheme: ColorScheme? {
        (AppearancePreference(rawValue: appearance) ?? .system).colorScheme
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(cart)
                .environment(follows)
                .environment(saved)
                .environment(router)
                .environment(toast)
                // After the environment: it reads the router, follow store and session from it.
                .yardPushNotifications()
                .preferredColorScheme(preferredScheme)
                .tint(Color.yard.ink)
                .task {
                    // The ship-to country chosen in You › Settings, before the first cart load.
                    YouRegion.restore(into: cart)
                }
                .onOpenURL { url in
                    // Email sign-in and verification links are consumed in the app.
                    if AuthEmailLinks.canHandle(url) {
                        Task { @MainActor in
                            if let message = await AuthEmailLinks.handle(url, session: session) { toast.show(message) }
                        }
                        return
                    }
                    if !router.open(url) {
                        // Not an app destination: hand it to the system (Safari).
                        UIApplication.shared.open(url)
                    }
                }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    guard let url = activity.webpageURL else { return }
                    if AuthEmailLinks.canHandle(url) {
                        Task { @MainActor in
                            if let message = await AuthEmailLinks.handle(url, session: session) { toast.show(message) }
                        }
                        return
                    }
                    if !router.open(url) {
                        UIApplication.shared.open(url)
                    }
                }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { @MainActor in
                    await session.refresh()
                    await cart.load()
                    // Re-attach running order Live Activities and refresh their state.
                    await LiveActivityManager.shared.resume()
                }
            }
        }
    }
}
