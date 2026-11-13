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
                .preferredColorScheme(preferredScheme)
                .tint(Color.yard.ink)
                .onOpenURL { url in
                    if !router.open(url) {
                        // Not an app destination: hand it to the system (Safari).
                        UIApplication.shared.open(url)
                    }
                }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    if let url = activity.webpageURL, !router.open(url) {
                        UIApplication.shared.open(url)
                    }
                }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { @MainActor in
                    await session.refresh()
                    await cart.load()
                }
            }
        }
    }
}
