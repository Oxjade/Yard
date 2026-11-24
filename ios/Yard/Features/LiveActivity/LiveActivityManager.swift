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
// Push updates: every activity is requested with `pushType: .token`. Its APNs push token (and every
// rotation) is uploaded to `POST /api/orders/{id}/live-activity` through `LiveActivityTokenSync`, and
// removed when the activity ends, so Yard's server pushes delivery changes straight to the activity
// while the app is closed (see ios/Docs/live-activity.md). On iOS 17.2+ the phone's push-to-start
// token is uploaded too, so the server can start the activity when an order first ships; such an
// activity is picked up from `Activity.activityUpdates`. The app still updates the activity itself
// whenever it refreshes the order (`sync`).

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
    @ObservationIgnored private var stateTasks: [String: Task<Void, Never>] = [:]
    /// New activities (incl. ones the server started with push-to-start).
    @ObservationIgnored private var activityUpdatesTask: Task<Void, Never>?
    /// The phone's push-to-start token (iOS 17.2+).
    @ObservationIgnored private var startTokenTask: Task<Void, Never>?
    /// Uploads push tokens to Yard's server (and retries what failed).
    let tokenSync: LiveActivityTokenSync
    private static let tokensKey = "yard.liveActivity.pushTokens"
    /// Brand cities already resolved, so a refresh doesn't re-read the storefront.
    @ObservationIgnored private var brandCities: [String: String] = [:]
    /// Watches Settings › Yard › Live Activities so `areActivitiesEnabled` stays current.
    @ObservationIgnored private var enablementTask: Task<Void, Never>?

    /// Whether the person allows Live Activities for Yard (Settings › Yard › Live Activities).
    /// Stored (and kept current from `activityEnablementUpdates`) so views observing it re-render
    /// when the person flips the switch in Settings.
    private(set) var areActivitiesEnabled: Bool = false

    init(tokenSync: LiveActivityTokenSync? = nil) {
        self.tokenSync = tokenSync ?? LiveActivityTokenSync.live()
        if let stored = UserDefaults.standard.dictionary(forKey: LiveActivityManager.tokensKey) as? [String: String] {
            pushTokens = stored
        }
        areActivitiesEnabled = ActivityAuthorizationInfo().areActivitiesEnabled
        refreshTracked()
        enablementTask = Task { @MainActor [weak self] in
            for await enabled in ActivityAuthorizationInfo().activityEnablementUpdates {
                self?.areActivitiesEnabled = enabled
            }
        }
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
        areActivitiesEnabled = ActivityAuthorizationInfo().areActivitiesEnabled
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

    /// On launch / foreground: re-attach token observers, upload tokens that didn't reach the server
    /// yet, and refresh every running activity.
    func resume() async {
        areActivitiesEnabled = ActivityAuthorizationInfo().areActivitiesEnabled
        refreshTracked()
        startObserving()
        for activity in Activity<Attributes>.activities where isLive(activity) {
            observePushToken(of: activity)
            if !activity.attributes.brandCity.isEmpty {
                brandCities[activity.attributes.orderId] = activity.attributes.brandCity
            }
        }
        await tokenSync.retryPending()
        for orderId in trackedOrderIds {
            await sync(orderId: orderId)
        }
    }

    /// At launch (also a background launch, when the system wakes the app for an activity the server
    /// started): watch new activities, the push-to-start token and the running activities' tokens.
    func startObserving() {
        observeNewActivities()
        observePushToStartToken()
        for activity in Activity<Attributes>.activities where isLive(activity) {
            observePushToken(of: activity)
        }
    }

    /// Before signing out (needs the session): ends every activity and removes this phone's tokens
    /// from Yard's server, including the push-to-start token.
    func signOut() async {
        startTokenTask?.cancel()
        startTokenTask = nil
        await endAll()
        await tokenSync.signOut()
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
                let hex = LiveActivityManager.hex(data)
                print("[LiveActivity] push token for order \(orderId): \(hex)")
                await self?.storeToken(hex, orderId: orderId)
            }
        }
        // Ended or dismissed outside the app (a push `end`, the person swiping it away): forget it.
        stateTasks[orderId] = Task { @MainActor [weak self] in
            for await state in activity.activityStateUpdates {
                if state == .ended || state == .dismissed {
                    self?.forget(orderId: orderId)
                    return
                }
            }
        }
    }

    /// Activities that appear while the app runs or is woken, including ones the server started with
    /// a push-to-start token: watch their push token, and keep one per order.
    private func observeNewActivities() {
        guard activityUpdatesTask == nil else { return }
        activityUpdatesTask = Task { @MainActor [weak self] in
            for await activity in Activity<Attributes>.activityUpdates {
                guard let self else { return }
                let orderId = activity.attributes.orderId
                let others = Activity<Attributes>.activities.filter { $0.id != activity.id && $0.attributes.orderId == orderId && self.isLive($0) }
                if !others.isEmpty {
                    // Already tracked in the app (e.g. started offline before the server knew): keep that one.
                    await activity.end(nil, dismissalPolicy: .immediate)
                    continue
                }
                if !activity.attributes.brandCity.isEmpty { self.brandCities[orderId] = activity.attributes.brandCity }
                self.observePushToken(of: activity)
                self.refreshTracked()
            }
        }
    }

    /// iOS 17.2+: the token that lets Yard's server start an activity when an order first ships.
    private func observePushToStartToken() {
        guard startTokenTask == nil else { return }
        if #available(iOS 17.2, *) {
            startTokenTask = Task { @MainActor [weak self] in
                for await data in Activity<Attributes>.pushToStartTokenUpdates {
                    let hex = LiveActivityManager.hex(data)
                    print("[LiveActivity] push-to-start token: \(hex)")
                    await self?.tokenSync.startTokenChanged(hex)
                }
            }
        }
    }

    private static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    private func storeToken(_ hex: String, orderId: String) async {
        pushTokens[orderId] = hex
        UserDefaults.standard.set(pushTokens, forKey: LiveActivityManager.tokensKey)
        await tokenSync.tokenChanged(orderId: orderId, token: hex)
    }

    private func forget(orderId: String) {
        tokenTasks[orderId]?.cancel()
        tokenTasks[orderId] = nil
        stateTasks[orderId]?.cancel()
        stateTasks[orderId] = nil
        pushTokens[orderId] = nil
        UserDefaults.standard.set(pushTokens, forKey: LiveActivityManager.tokensKey)
        refreshTracked()
        // The server stops pushing to this activity.
        Task { @MainActor [weak self] in
            await self?.tokenSync.activityEnded(orderId: orderId)
        }
    }

    private func refreshTracked() {
        trackedOrderIds = Set(Activity<Attributes>.activities.filter { isLive($0) }.map { $0.attributes.orderId })
    }
}
