import Foundation
import Observation

/// The /drops calendar: live, upcoming and ended are read as three separate pages (each with
/// its own "Load more"), like the website's LiveDropsBoard, and grouped on the shopper's clock.
@Observable
@MainActor
final class DropsViewModel {
    enum Source: String, CaseIterable, Sendable {
        case live
        case upcoming
        case ended
    }

    enum LoadState {
        case loading
        case loaded
        case failed(Error)
    }

    struct Feed {
        var items: [Drop] = []
        var cursor: String? = nil
        var isLoadingMore: Bool = false
    }

    struct Day: Identifiable {
        let day: Date
        let drops: [Drop]
        var id: Date { day }
    }

    struct Groups {
        var live: [Drop] = []
        var entriesOpen: [Drop] = []
        var upcoming: [Drop] = []
        var past: [Drop] = []

        var isEmpty: Bool { live.isEmpty && entriesOpen.isEmpty && upcoming.isEmpty && past.isEmpty }
    }

    static let pageSize = 24

    var state: LoadState = .loading
    var feeds: [Source: Feed] = [:]
    /// Drops the signed-in shopper asked to be reminded about / entered (GET /api/drops/me).
    var reminderIds: Set<String> = []
    var entryIds: Set<String> = []
    var busyIds: Set<String> = []
    private var hasLoaded = false

    init() {}

    /// Preview-only: a model that already holds drops.
    init(previewDrops: [Drop]) {
        var live = Feed()
        var upcoming = Feed()
        var ended = Feed()
        let now = Date()
        for drop in previewDrops {
            switch drop.livePhase(at: now) {
            case .ended: ended.items.append(drop)
            case .upcoming: upcoming.items.append(drop)
            case .live, .entriesOpen, .earlyAccess: live.items.append(drop)
            }
        }
        feeds = [.live: live, .upcoming: upcoming, .ended: ended]
        state = .loaded
        hasLoaded = true
    }

    func feed(_ source: Source) -> Feed { feeds[source] ?? Feed() }

    func loadIfNeeded(signedIn: Bool) async {
        guard !hasLoaded else { return }
        await reload(signedIn: signedIn)
    }

    func reload(signedIn: Bool) async {
        if !hasLoaded { state = .loading }
        do {
            async let live = fetch(.live, cursor: nil)
            async let upcoming = fetch(.upcoming, cursor: nil)
            async let ended = fetch(.ended, cursor: nil)
            let pages: [DropsPage] = try await [live, upcoming, ended]
            feeds = [
                .live: Feed(items: pages[0].items, cursor: pages[0].nextCursor),
                .upcoming: Feed(items: pages[1].items, cursor: pages[1].nextCursor),
                .ended: Feed(items: pages[2].items, cursor: pages[2].nextCursor),
            ]
            state = .loaded
            hasLoaded = true
        } catch {
            // A failed pull-to-refresh keeps what is on screen; only the first load shows the error.
            if !hasLoaded { state = .failed(error) }
        }
        await loadParticipation(signedIn: signedIn)
    }

    func loadMore(_ source: Source) async {
        var current = feed(source)
        guard let cursor = current.cursor, !current.isLoadingMore else { return }
        current.isLoadingMore = true
        feeds[source] = current
        do {
            let page = try await fetch(source, cursor: cursor)
            var next = feed(source)
            let known = Set(next.items.map(\.id))
            next.items.append(contentsOf: page.items.filter { !known.contains($0.id) })
            next.cursor = page.nextCursor
            next.isLoadingMore = false
            feeds[source] = next
        } catch {
            var failed = feed(source)
            failed.isLoadingMore = false
            feeds[source] = failed
        }
    }

    /// The shopper's reminders and entries, for the bell on each upcoming row. Signed out → empty.
    func loadParticipation(signedIn: Bool) async {
        guard signedIn else {
            reminderIds = []
            entryIds = []
            return
        }
        do {
            let me: MyDropsResponse = try await APIClient.shared.get("/api/drops/me", as: MyDropsResponse.self)
            reminderIds = Set(me.reminders.map(\.dropId))
            entryIds = Set(me.entries.filter { $0.status != "withdrawn" }.map(\.drop.id))
        } catch {
            // Bells just show "off"; the drop page reads the real state.
        }
    }

    /// Toggles the reminder for `drop` and returns the toast to show.
    func toggleReminder(_ drop: Drop) async throws -> (text: String, style: Toast.Style) {
        guard !busyIds.contains(drop.id) else { return ("", .info) }
        busyIds.insert(drop.id)
        defer { busyIds.remove(drop.id) }
        let turnOn = !reminderIds.contains(drop.id)
        let outcome = try await DropActions.setReminder(turnOn, drop: drop)
        if turnOn { reminderIds.insert(drop.id) } else { reminderIds.remove(drop.id) }
        return DropActions.reminderMessage(on: turnOn, outcome: outcome)
    }

    /// Every loaded drop, de-duplicated, placed in its group on the shopper's clock.
    func groups(now: Date) -> Groups {
        var groups = Groups()
        var seen = Set<String>()
        for source in Source.allCases {
            for drop in feed(source).items where !seen.contains(drop.id) {
                seen.insert(drop.id)
                switch drop.livePhase(at: now) {
                case .ended: groups.past.append(drop)
                case .entriesOpen: groups.entriesOpen.append(drop)
                case .upcoming, .earlyAccess: groups.upcoming.append(drop)
                case .live: groups.live.append(drop)
                }
            }
        }
        let far = Date.distantFuture
        groups.live.sort { ($0.endDate ?? far) < ($1.endDate ?? far) }
        groups.entriesOpen.sort { ($0.entriesCloseDate ?? far) < ($1.entriesCloseDate ?? far) }
        groups.upcoming.sort { ($0.startDate ?? far) < ($1.startDate ?? far) }
        groups.past.sort { ($0.endDate ?? Date.distantPast) > ($1.endDate ?? Date.distantPast) }
        return groups
    }

    /// Upcoming drops as a calendar: one entry per local day, in order.
    func days(_ drops: [Drop], now: Date) -> [Day] {
        let calendar = Calendar.current
        var order: [Date] = []
        var byDay: [Date: [Drop]] = [:]
        for drop in drops {
            let date = drop.reminderOpenDate(now: now) ?? drop.startDate ?? now
            let day = calendar.startOfDay(for: date)
            if byDay[day] == nil { order.append(day) }
            byDay[day, default: []].append(drop)
        }
        return order.sorted().map { Day(day: $0, drops: byDay[$0] ?? []) }
    }

    private func fetch(_ source: Source, cursor: String?) async throws -> DropsPage {
        var query: [URLQueryItem] = [
            URLQueryItem(name: "phase", value: source.rawValue),
            URLQueryItem(name: "limit", value: String(Self.pageSize)),
        ]
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await APIClient.shared.get("/api/drops", query: query, as: DropsPage.self)
    }
}
