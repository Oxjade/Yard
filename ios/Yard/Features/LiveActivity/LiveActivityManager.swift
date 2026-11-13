import ActivityKit
import Foundation
import Observation

// MARK: - Order-tracking Live Activity: app side
//
// Start / update / end the Lock Screen + Dynamic Island activity for one brand's part of an order.
//
//   // Orders screen, after loading an order (starts it once shipped, updates it, ends it on delivery):
//   Task { @MainActor in await LiveActivityManager.shared.sync(orderId: order.id) }
//
//   // App launch / foreground (re-attach push-token observers and refresh what's running):
//   Task { @MainActor in await LiveActivityManager.shared.resume() }
//
//   // Sign out:
//   Task { @MainActor in await LiveActivityManager.shared.endAll() }
//
// Push updates: every activity is requested with `pushType: .token`. Its APNs push token is printed
// and kept in `pushTokens` (and UserDefaults). Yard's server has no endpoint to receive it yet, so
// today the app updates the activity itself whenever it refreshes the order. Once the server sends
// `liveactivity` APNs pushes (see ios/Docs/live-activity.md), POST the token where it says.

@Observable
@MainActor
final class LiveActivityManager {
    typealias Attributes = YardOrderActivityAttributes
    typealias State = YardOrderActivityAttributes.ContentState

    static let shared = LiveActivityManager()

    /// APNs push tokens (hex) by order id, for the server to send updates to.
    private(set) var pushTokens: [String: String] = [:]
    /// Order ids with a running activity (observable for "Tracking on Lock Screen" UI).
    private(set) var trackedOrderIds: Set<String> = []
    /// The last error from ActivityKit or the API, for diagnostics.
    private(set) var lastError: String?

    @ObservationIgnored private var tokenTasks: [String: Task<Void, Never>] = [:]
    private static let tokensKey = "yard.liveActivity.pushTokens"
    /// Brand cities already resolved, so a refresh doesn't re-read the storefront.
    @ObservationIgnored private var brandCities: [String: String] = [:]

    init() {
        if let stored = UserDefaults.standard.dictionary(forKey: LiveActivityManager.tokensKey) as? [String: String] {
            pushTokens = stored
        }
        refreshTracked()
    }

    /// Whether the person allows Live Activities for Yard (Settings › Yard › Live Activities).
    var areActivitiesEnabled: Bool {
        ActivityAuthorizationInfo().areActivitiesEnabled
    }

    func isTracking(orderId: String) -> Bool {
        runningActivity(for: orderId) != nil
    }

    // MARK: Start / update / end

    /// Starts (or, if one is running, updates) the activity for `order`. Returns false when it
    /// couldn't start (Live Activities off, nothing to show, or ActivityKit refused).
    @discardableResult
    func start(for order: LiveActivityOrder) -> Bool {
        guard let state = order.state else { return false }
        if let existing = runningActivity(for: order.orderId) {
            Task { @MainActor in await self.update(existing, state: state) }
            return true
        }
        guard areActivitiesEnabled else { return false }
        if !order.brandCity.isEmpty { brandCities[order.orderId] = order.brandCity }

        let content = ActivityContent(state: state, staleDate: staleDate(for: state))
        let activity: Activity<Attributes>
        do {
            activity = try Activity<Attributes>.request(attributes: order.attributes, content: content, pushType: .token)
        } catch {
            // No push entitlement yet (or APNs unavailable): run it as a local-only activity.
            print("[LiveActivity] push-token request failed (\(error.localizedDescription)); starting without push")
            do {
                activity = try Activity<Attributes>.request(attributes: order.attributes, content: content, pushType: nil)
            } catch {
                lastError = error.localizedDescription
                print("[LiveActivity] could not start for order \(order.orderId): \(error.localizedDescription)")
                return false
            }
        }
        observePushToken(of: activity)
        refreshTracked()
        return true
    }

    /// Updates the running activity of `orderId` with `state` (no-op when none is running).
    func update(orderId: String, state: State) async {
        guard let activity = runningActivity(for: orderId) else { return }
        await update(activity, state: state)
    }

    /// Ends the activity of `orderId`. With a final state it stays on the Lock Screen a while
    /// (delivered: 2 hours) unless `immediately`.
    func end(orderId: String, finalState: State? = nil, immediately: Bool = false) async {
        guard let activity = runningActivity(for: orderId) else { return }
        let content: ActivityContent<State>? = finalState.map { ActivityContent(state: $0, staleDate: nil) }
        let policy: ActivityUIDismissalPolicy = immediately ? .immediate : .after(Date().addingTimeInterval(2 * 3_600))
        await activity.end(content, dismissalPolicy: policy)
        forget(orderId: orderId)
    }

    /// Ends every Yard activity (sign out).
    func endAll() async {
        for activity in Activity<Attributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
            forget(orderId: activity.attributes.orderId)
        }
        refreshTracked()
    }

    // MARK: Sync with the API

    /// Reads the order and does the right thing: starts the activity once it has shipped, updates
    /// a running one, ends it when delivered (kept 2 h) or cancelled/returned (removed).
    func sync(orderId: String) async {
        let order: LiveActivityOrder
        do {
            order = try await LiveActivityOrder.load(orderId: orderId, brandCity: brandCities[orderId])
        } catch {
            if APIError.message(for: error).isEmpty == false { lastError = APIError.message(for: error) }
            if let apiError = error as? APIError, apiError.isNotFound || apiError.isUnauthorized {
                await end(orderId: orderId, immediately: true)
            }
            return
        }
        await apply(order)
    }

    /// Applies an already-loaded snapshot (e.g. from the Orders screen's own data).
    func apply(_ order: LiveActivityOrder) async {
        if !order.brandCity.isEmpty { brandCities[order.orderId] = order.brandCity }
        if order.isClosed {
            await end(orderId: order.orderId, immediately: true)
            return
        }
        guard let state = order.state else { return }
        let running = runningActivity(for: order.orderId)
        switch state.step {
        case .delivered:
            if running != nil { await end(orderId: order.orderId, finalState: state) }
        case .packed:
            // Never auto-start before it ships; keep a running one current.
            if let running { await update(running, state: state) }
        case .shipped, .outForDelivery, .arrivingSoon:
            if let running {
                await update(running, state: state)
            } else {
                start(for: order)
            }
        }
    }

    /// On launch / foreground: re-attach token observers and refresh every running activity.
    func resume() async {
        refreshTracked()
        for activity in Activity<Attributes>.activities where isLive(activity) {
            observePushToken(of: activity)
            if !activity.attributes.brandCity.isEmpty {
                brandCities[activity.attributes.orderId] = activity.attributes.brandCity
            }
        }
        for orderId in trackedOrderIds {
            await sync(orderId: orderId)
        }
    }

    // MARK: Private

    private func runningActivity(for orderId: String) -> Activity<Attributes>? {
        Activity<Attributes>.activities.first { $0.attributes.orderId == orderId && isLive($0) }
    }

    private func isLive(_ activity: Activity<Attributes>) -> Bool {
        activity.activityState == .active || activity.activityState == .stale
    }

    private func update(_ activity: Activity<Attributes>, state: State) async {
        await activity.update(ActivityContent(state: state, staleDate: staleDate(for: state)))
    }

    /// Marks the activity stale when the app hasn't refreshed it for 8 hours (the widget then says so).
    private func staleDate(for state: State) -> Date? {
        state.step == .delivered ? nil : Date().addingTimeInterval(8 * 3_600)
    }

    private func observePushToken(of activity: Activity<Attributes>) {
        let orderId = activity.attributes.orderId
        guard tokenTasks[orderId] == nil else { return }
        tokenTasks[orderId] = Task { @MainActor [weak self] in
            for await data in activity.pushTokenUpdates {
                let hex = data.map { String(format: "%02x", $0) }.joined()
                print("[LiveActivity] push token for order \(orderId): \(hex)")
                self?.storeToken(hex, orderId: orderId)
            }
        }
    }

    private func storeToken(_ hex: String, orderId: String) {
        pushTokens[orderId] = hex
        UserDefaults.standard.set(pushTokens, forKey: LiveActivityManager.tokensKey)
        // TODO(server): POST { orderId, token: hex, kind: "liveactivity" } once Yard has an endpoint
        // for it, so order.shipment events become APNs Live Activity pushes.
    }

    private func forget(orderId: String) {
        tokenTasks[orderId]?.cancel()
        tokenTasks[orderId] = nil
        pushTokens[orderId] = nil
        UserDefaults.standard.set(pushTokens, forKey: LiveActivityManager.tokensKey)
        refreshTracked()
    }

    private func refreshTracked() {
        trackedOrderIds = Set(Activity<Attributes>.activities.filter { isLive($0) }.map { $0.attributes.orderId })
    }
}
