import Foundation
import SwiftUI
import UserNotifications

// Drops feature helpers: the shopper-clock phase (port of src/lib/api/drops.ts `dropPhaseAt`),
// the wording the website uses (live-drops-board.tsx, live-drop-detail.tsx), the shopper's own
// drops (GET /api/drops/me), reminder / entry writes, and the local "10 minutes before" alert.

// MARK: - Phase on the shopper's clock

/// The phase a drop is in at a given moment, recomputed on device so a drop moves section
/// (and the detail page reloads) the second it opens. Mirrors `dropPhaseAt` on the website.
enum DropLivePhase: String, Hashable, Sendable {
    case upcoming
    case entriesOpen
    case earlyAccess
    case live
    case ended
}

extension Drop {
    func livePhase(at now: Date) -> DropLivePhase {
        let end: Date = endDate ?? Date.distantFuture
        if status == "ended" || status == "cancelled" || now >= end { return .ended }
        let start: Date = startDate ?? Date.distantFuture
        let drawn: Bool = (drawnAt ?? "").isEmpty == false
        if access == "draw" && !drawn {
            let opens: Date = YardDate.parse(entryOpensAt) ?? Date.distantPast
            let closes: Date = YardDate.parse(entryClosesAt) ?? start
            if now >= opens && now < closes { return .entriesOpen }
        }
        if access == "early_access", let early = YardDate.parse(earlyAccessAt), now >= early, now < start {
            return .earlyAccess
        }
        if now >= start { return .live }
        return .upcoming
    }

    /// When a draw's entries close (entryClosesAt, else the release).
    var entriesCloseDate: Date? { YardDate.parse(entryClosesAt) ?? startDate }

    /// A released draw: its window belongs to the drawn winners ("Winners buying").
    func isWinnersWindow(_ phase: DropLivePhase) -> Bool { phase == .live && isDraw }

    /// A draw whose entries haven't opened yet.
    func isDrawWaiting(_ phase: DropLivePhase, now: Date) -> Bool {
        guard isDraw, phase == .upcoming, let opens = YardDate.parse(entryOpensAt) else { return false }
        return opens > now
    }

    /// "Live now", "Entries open", "Winners buying", "Upcoming", "Ended"… (website badges).
    func statusLabel(_ phase: DropLivePhase) -> String {
        switch phase {
        case .entriesOpen: return "Entries open"
        case .earlyAccess: return "Early access"
        case .live: return isDraw ? "Winners buying" : "Live now"
        case .ended: return isDraw ? "Draw closed" : "Ended"
        case .upcoming: return "Upcoming"
        }
    }

    /// Acid badge (and the live pulse) for what a shopper can act on right now.
    func isHot(_ phase: DropLivePhase) -> Bool {
        (phase == .live && !isDraw) || phase == .entriesOpen
    }

    /// "Releases Thu 14 Nov, 18:00" etc., in the shopper's time zone.
    func timingText(_ phase: DropLivePhase, now: Date) -> String {
        func at(_ date: Date?) -> String { date.map { Formatters.dateTime($0) } ?? "" }
        switch phase {
        case .live:
            return isDraw ? "Winners and the waitlist can buy until \(at(endDate))" : "Closes \(at(endDate))"
        case .ended:
            return "Closed \(at(endDate))"
        case .entriesOpen:
            return "Entries close \(at(entriesCloseDate))"
        case .earlyAccess:
            return "Early access · public release \(at(startDate))"
        case .upcoming:
            if isDrawWaiting(phase, now: now) { return "Entries open \(at(YardDate.parse(entryOpensAt)))" }
            return "Releases \(at(startDate))"
        }
    }

    /// The moment the big countdown counts to, with its label; nil once ended.
    func countdownTarget(_ phase: DropLivePhase, now: Date) -> (label: String, date: Date)? {
        switch phase {
        case .upcoming:
            if isDrawWaiting(phase, now: now), let opens = YardDate.parse(entryOpensAt) { return ("Entries open in", opens) }
            if isDraw, let closes = entriesCloseDate { return ("Entries close in", closes) }
            if let start = startDate { return ("Opens in", start) }
            return nil
        case .entriesOpen:
            if let closes = entriesCloseDate { return ("Entries close in", closes) }
            return nil
        case .earlyAccess:
            if let start = startDate { return ("Public release in", start) }
            return nil
        case .live:
            if let end = endDate { return (isDraw ? "Window closes in" : "Closes in", end) }
            return nil
        case .ended:
            return nil
        }
    }

    /// The date a "10 minutes before" local alert is built from: entries opening for a waiting
    /// draw, otherwise the release.
    func reminderOpenDate(now: Date) -> Date? {
        let phase = livePhase(at: now)
        if isDrawWaiting(phase, now: now) { return YardDate.parse(entryOpensAt) }
        return startDate
    }

    /// "Draw release" / "Early access release" / "Limited release".
    var releaseKindLabel: String {
        switch access {
        case "draw": return "Draw release"
        case "early_access": return "Early access release"
        default: return "Limited release"
        }
    }

    /// "1 piece" / "40 pieces".
    var runText: String { DropText.pluralize(totalUnits, "piece") }

    var brandName: String { brand.name ?? "Independent brand" }

    /// What a drop offers before release: a reminder, or (only while entries are open) a draw entry.
    func actionMode(_ phase: DropLivePhase) -> DropActionMode? {
        if phase == .entriesOpen && isDraw { return .entry }
        if phase == .upcoming { return .reminder }
        return nil
    }

    /// Website path, for share links and notification deep links.
    var webPath: String { "/drops/\(slug)" }
}

enum DropActionMode: Sendable {
    case reminder
    case entry
}

enum DropText {
    static func pluralize(_ n: Int, _ word: String) -> String {
        "\(Formatters.grouped(n)) \(word)\(n == 1 ? "" : "s")"
    }

    /// "1 day" / "2 hours" / "45 minutes" (a draw winner's purchase window).
    static func windowLength(_ minutes: Int) -> String {
        if minutes % 1440 == 0 { return pluralize(minutes / 1440, "day") }
        if minutes % 60 == 0 { return pluralize(minutes / 60, "hour") }
        return pluralize(minutes, "minute")
    }

    /// A draw entry's status as shoppers read it (never the raw code).
    static func entryStatus(_ status: String) -> (label: String, style: Tag.Style) {
        switch status {
        case "won": return ("Winner", .success)
        case "purchased": return ("Purchased", .violet)
        case "waitlisted": return ("Waitlisted", .acid)
        case "expired": return ("Window expired", .neutral)
        case "lost": return ("Not selected", .neutral)
        case "withdrawn": return ("Withdrawn", .neutral)
        default: return ("Entered", .violet)
        }
    }

    /// "Today" / "Tomorrow" / "Thursday 14 Nov".
    static func dayTitle(_ day: Date, now: Date = Date()) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(day) { return "Today" }
        if calendar.isDateInTomorrow(day) { return "Tomorrow" }
        let f = DateFormatter()
        let sameYear = calendar.isDate(day, equalTo: now, toGranularity: .year)
        f.setLocalizedDateFormatFromTemplate(sameYear ? "EEEE d MMM" : "EEEE d MMM yyyy")
        return f.string(from: day)
    }
}

// MARK: - The shopper's drops (GET /api/drops/me)

struct MyDropsResponse: Decodable, Sendable {
    struct Entry: Decodable, Sendable, Identifiable {
        let drop: Drop
        let status: String
        let rank: Int?
        let windowOpensAt: String?
        let windowEndsAt: String?
        let enteredAt: String?
        var id: String { drop.id }
    }

    struct Reminder: Decodable, Sendable, Identifiable {
        let dropId: String
        let setAt: String?
        let drop: Drop?
        var id: String { dropId }
    }

    let entries: [Entry]
    let reminders: [Reminder]

    enum CodingKeys: String, CodingKey { case entries, reminders }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        entries = c.lenient(.entries, [Entry]())
        reminders = c.lenient(.reminders, [Reminder]())
    }

    init(entries: [Entry], reminders: [Reminder]) {
        self.entries = entries
        self.reminders = reminders
    }
}

// MARK: - Writes

@MainActor
enum DropActions {
    private static func path(_ id: String, _ tail: String) -> String {
        let safe = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return "/api/drops/\(safe)/\(tail)"
    }

    /// POST/DELETE /api/drops/{id}/reminder, then the local alert on this iPhone.
    static func setReminder(_ on: Bool, drop: Drop) async throws -> DropLocalReminder.Outcome {
        try await APIClient.shared.send(on ? .post : .delete, path(drop.id, "reminder"))
        if on { return await DropLocalReminder.schedule(drop: drop, prompt: true) }
        DropLocalReminder.cancel(dropId: drop.id)
        return .removed
    }

    /// POST/DELETE /api/drops/{id}/entry (draws, while entries are open).
    static func setEntry(_ on: Bool, dropId: String) async throws {
        try await APIClient.shared.send(on ? .post : .delete, path(dropId, "entry"))
    }

    /// The toast after a reminder change.
    static func reminderMessage(on: Bool, outcome: DropLocalReminder.Outcome) -> (text: String, style: Toast.Style) {
        guard on else { return ("Reminder removed", .info) }
        switch outcome {
        case .scheduled: return ("Reminder set. We'll alert you 10 minutes before it opens.", .success)
        case .denied: return ("Reminder set. Turn on notifications for Yard in Settings to get an alert on this iPhone.", .success)
        case .failed: return ("Reminder set. We couldn't schedule an alert on this iPhone.", .success)
        case .tooSoon, .removed: return ("Reminder set", .success)
        }
    }
}

// MARK: - Local notification 10 minutes before opening

@MainActor
enum DropLocalReminder {
    enum Outcome: Sendable {
        case scheduled
        case denied
        case tooSoon
        case removed
        /// Notifications are allowed but iOS refused to schedule the alert.
        case failed
    }

    static let identifierPrefix = "yard.drop-reminder."

    static let leadTime: TimeInterval = 10 * 60

    static func identifier(for dropId: String) -> String { "\(identifierPrefix)\(dropId)" }

    /// Schedules (or reschedules: same identifier replaces) the alert. `prompt` asks for
    /// notification permission when it hasn't been asked yet; syncing passes false.
    @discardableResult
    static func schedule(drop: Drop, prompt: Bool) async -> Outcome {
        let now = Date()
        guard let opens = drop.reminderOpenDate(now: now) else { return .tooSoon }
        let fireDate = opens.addingTimeInterval(-leadTime)
        guard fireDate.timeIntervalSince(now) > 5 else { return .tooSoon }

        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        var allowed: Bool
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            allowed = true
        case .notDetermined:
            if prompt {
                let granted: Bool? = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
                allowed = granted ?? false
            } else {
                allowed = false
            }
        case .denied:
            allowed = false
        @unknown default:
            allowed = false
        }
        guard allowed else { return .denied }

        let waiting = drop.isDrawWaiting(drop.livePhase(at: now), now: now)
        let content = UNMutableNotificationContent()
        content.title = waiting ? "Entries open in 10 minutes" : "\(drop.name) opens in 10 minutes"
        content.body = waiting
            ? "\(drop.name) by \(drop.brandName). Open Yard to enter the draw."
            : "\(drop.brandName) · \(drop.accessLabel). Open Yard to be ready."
        content.sound = UNNotificationSound.default
        content.userInfo = [
            "path": drop.webPath,
            "href": drop.webPath,
            "url": Config.webURL(drop.webPath).absoluteString,
            "dropId": drop.id,
        ]

        let components = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: fireDate)
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        let request = UNNotificationRequest(identifier: identifier(for: drop.id), content: content, trigger: trigger)
        do {
            try await center.add(request)
            return .scheduled
        } catch {
            return .failed
        }
    }

    static func cancel(dropId: String) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [identifier(for: dropId)])
    }

    /// Removes every pending drop alert (sign out: they belong to the previous account).
    static func cancelAll() async {
        let center = UNUserNotificationCenter.current()
        let pending: [UNNotificationRequest] = await center.pendingNotificationRequests()
        let ids: [String] = pending.map { $0.identifier }.filter { $0.hasPrefix(identifierPrefix) }
        if !ids.isEmpty {
            center.removePendingNotificationRequests(withIdentifiers: ids)
        }
    }

    /// Keeps the local alert in line with the server's reminder (set on the web, or moved by the brand).
    static func sync(drop: Drop, reminderOn: Bool) async {
        if reminderOn && drop.livePhase(at: Date()) == .upcoming {
            await schedule(drop: drop, prompt: false)
        } else if !reminderOn {
            cancel(dropId: drop.id)
        }
    }
}

// MARK: - Live pulse

/// The pulsing "live" dot: a solid dot with a ring that grows and fades, on repeat.
struct DropLivePulse: View {
    var color: Color = Color.yard.onAcid
    var size: CGFloat = 7

    var body: some View {
        ZStack {
            PhaseAnimator([false, true]) { expanded in
                Circle()
                    .fill(color)
                    .frame(width: size, height: size)
                    .scaleEffect(expanded ? 2.6 : 1)
                    .opacity(expanded ? 0 : 0.55)
            } animation: { expanded in
                expanded ? Animation.easeOut(duration: 1.1) : nil
            }
            Circle()
                .fill(color)
                .frame(width: size, height: size)
        }
        .frame(width: size * 2.6, height: size * 2.6)
        .accessibilityHidden(true)
    }
}

/// Status badge: acid with the live pulse when the shopper can act now, neutral otherwise.
struct DropStatusBadge: View {
    let drop: Drop
    let phase: DropLivePhase
    var onPhoto: Bool = false

    var body: some View {
        if drop.isHot(phase) {
            HStack(spacing: 4) {
                DropLivePulse(color: Color.yard.onAcid, size: 6)
                    .frame(width: 12, height: 12)
                Text(drop.statusLabel(phase).uppercased())
                    .font(.yardMicro)
                    .lineLimit(1)
            }
            .foregroundStyle(Color.yard.onAcid)
            .padding(.leading, 6)
            .padding(.trailing, 9)
            .padding(.vertical, 5)
            .background(Capsule().fill(Color.yard.acid))
        } else {
            Tag(drop.statusLabel(phase), style: onPhoto ? .onPhoto : .neutral)
        }
    }
}

// MARK: - Preview fixtures (previews only, never shown in the app)

enum DropsPreviewFixtures {
    private static func iso(_ offset: TimeInterval) -> String {
        let f = ISO8601DateFormatter()
        return f.string(from: Date().addingTimeInterval(offset))
    }

    static let brand = Drop.BrandRef(id: "brd_preview", handle: "acme", name: "Acme Studio")

    static let live = Drop(id: "drp_live", slug: "night-shift", brand: brand, name: "Night Shift", description: "Heavyweight fleece in washed black, cut and sewn in Lagos.", status: "live", phase: "live", startsAt: iso(-3600), endsAt: iso(7200), totalUnits: 40, productIds: ["prd_0", "prd_1"])
    static let draw = Drop(id: "drp_draw", slug: "the-draw", brand: brand, name: "Archive Draw", description: "Twelve archive jackets by draw.", access: "draw", phase: "entries_open", startsAt: iso(86_400), endsAt: iso(172_800), entryOpensAt: iso(-3600), entryClosesAt: iso(80_000), purchaseWindowMinutes: 1440, winners: 12, totalUnits: 12)
    static let upcoming = Drop(id: "drp_up", slug: "spring-capsule", brand: brand, name: "Spring Capsule", description: "Six pieces for the new season.", startsAt: iso(5400), endsAt: iso(90_000), totalUnits: 60)
    static let tomorrow = Drop(id: "drp_up2", slug: "denim-02", brand: Drop.BrandRef(id: "brd_2", handle: "blue", name: "Blue Hour"), name: "Denim 02", startsAt: iso(100_000), endsAt: iso(190_000), totalUnits: 25)
    static let past = Drop(id: "drp_past", slug: "winter-run", brand: brand, name: "Winter Run", status: "ended", phase: "ended", startsAt: iso(-400_000), endsAt: iso(-300_000), totalUnits: 30)
}
