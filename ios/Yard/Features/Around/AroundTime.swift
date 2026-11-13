import Foundation

// Opening hours and dates for places, computed in the PLACE's own time zone — a port of the
// website's src/lib/around/hours.ts and labels.ts so the app says the same sentences.

enum AroundOpenState: Equatable, Sendable {
    case open(closes: String)
    case closed(opensDay: String?, opensTime: String?, today: Bool, tomorrow: Bool)
}

/// One line of status for a card or the detail header, with a flag for the live / open dot.
struct AroundStatusLine: Equatable, Sendable {
    enum Tone: Equatable, Sendable { case live, open, neutral }
    let text: String
    let tone: Tone
}

enum AroundTime {
    // MARK: Clock in a zone

    static func zone(_ identifier: String) -> TimeZone {
        TimeZone(identifier: identifier) ?? TimeZone(secondsFromGMT: 0) ?? .current
    }

    private static func calendar(_ tz: String) -> Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = zone(tz)
        return cal
    }

    /// The weekday key ("mon"…"sun") and minutes after midnight at `date` in `tz`.
    static func localClock(_ date: Date, tz: String) -> (day: String, minutes: Int) {
        let cal = calendar(tz)
        let comps = cal.dateComponents([.weekday, .hour, .minute], from: date)
        // Calendar weekday: 1 = Sunday … 7 = Saturday.
        let keys: [String] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
        let index = max(1, min(7, comps.weekday ?? 2)) - 1
        let minutes = (comps.hour ?? 0) * 60 + (comps.minute ?? 0)
        return (keys[index], minutes)
    }

    static func toMinutes(_ hhmm: String) -> Int {
        let parts = hhmm.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return 0 }
        return parts[0] * 60 + parts[1]
    }

    private static func dayIndex(_ day: String) -> Int { AroundHours.dayKeys.firstIndex(of: day) ?? 0 }
    private static func prevDay(_ day: String) -> String { AroundHours.dayKeys[(dayIndex(day) + 6) % 7] }
    private static func nextDay(_ day: String) -> String { AroundHours.dayKeys[(dayIndex(day) + 1) % 7] }

    // MARK: Open now

    /// Open now? Ranges may end at 24:00 or after midnight ("22:00"–"02:00").
    static func openState(_ hours: AroundHours?, tz: String, at date: Date) -> AroundOpenState? {
        guard let hours else { return nil }
        let clock = localClock(date, tz: tz)
        for r in hours.ranges(clock.day) {
            let from = toMinutes(r[0])
            var to = toMinutes(r[1])
            if to <= from { to += 24 * 60 }
            if clock.minutes >= from && clock.minutes < to {
                return .open(closes: r[1] == "24:00" ? "midnight" : r[1])
            }
        }
        for r in hours.ranges(prevDay(clock.day)) {
            let from = toMinutes(r[0])
            let to = toMinutes(r[1])
            if to <= from && clock.minutes < to { return .open(closes: r[1]) }
        }
        var d = clock.day
        for i in 0..<8 {
            let sorted = hours.ranges(d).sorted { toMinutes($0[0]) < toMinutes($1[0]) }
            for r in sorted {
                if i == 0 && toMinutes(r[0]) <= clock.minutes { continue }
                return .closed(opensDay: d, opensTime: r[0], today: i == 0, tomorrow: i == 1)
            }
            d = nextDay(d)
        }
        return .closed(opensDay: nil, opensTime: nil, today: false, tomorrow: false)
    }

    /// "Open, closes 19:00" / "Closed, opens 10:00" / "Closed, opens tomorrow 10:00" / "Closed, opens Tue 10:00".
    static func openLine(_ state: AroundOpenState?) -> String? {
        guard let state else { return nil }
        switch state {
        case .open(let closes):
            return "Open, closes \(closes)"
        case .closed(let day, let time, let today, let tomorrow):
            guard let day, let time else { return "Closed" }
            if today { return "Closed, opens \(time)" }
            if tomorrow { return "Closed, opens tomorrow \(time)" }
            return "Closed, opens \(AroundHours.dayShort[day] ?? day) \(time)"
        }
    }

    /// The detail page's sentence: "Open now, closes 19:00" / "Closed now, opens Tuesday 10:00".
    static func openNowLine(_ state: AroundOpenState) -> String {
        switch state {
        case .open(let closes):
            return "Open now, closes \(closes)"
        case .closed(let day, let time, let today, let tomorrow):
            guard let day, let time else { return "Closed now" }
            if today { return "Closed now, opens \(time)" }
            if tomorrow { return "Closed now, opens tomorrow \(time)" }
            return "Closed now, opens \(AroundHours.dayLabels[day] ?? day) \(time)"
        }
    }

    // MARK: Dated places

    enum Timed: Sendable { case upcoming, live, ended }

    static func timedStatus(startsAt: String?, endsAt: String?, at date: Date) -> Timed? {
        guard let s = YardDate.parse(startsAt), let e = YardDate.parse(endsAt) else { return nil }
        if date >= e { return .ended }
        if date >= s { return .live }
        return .upcoming
    }

    /// The status line of a card: hours for stores and showrooms, dates for pop-ups and exhibitions.
    static func statusLine(for p: AroundPlace, at date: Date) -> AroundStatusLine? {
        if p.kind.isDated {
            guard let status = timedStatus(startsAt: p.startsAt, endsAt: p.endsAt, at: date),
                  let starts = YardDate.parse(p.startsAt), let ends = YardDate.parse(p.endsAt) else { return nil }
            switch status {
            case .live:
                let sameDay = dayIn(ends, tz: p.timeZone) == dayIn(date, tz: p.timeZone)
                let until = sameDay ? timeIn(ends, tz: p.timeZone) : "\(dayIn(ends, tz: p.timeZone)), \(timeIn(ends, tz: p.timeZone))"
                return AroundStatusLine(text: "Live now, until \(until)", tone: .live)
            case .ended:
                return AroundStatusLine(text: "Ended", tone: .neutral)
            case .upcoming:
                return AroundStatusLine(text: "Starts \(dayIn(starts, tz: p.timeZone)), \(timeIn(starts, tz: p.timeZone))", tone: .neutral)
            }
        }
        if p.byAppointment && p.hours == nil { return AroundStatusLine(text: "By appointment", tone: .neutral) }
        let state = openState(p.hours, tz: p.timeZone, at: date)
        guard let line = openLine(state) else {
            return p.byAppointment ? AroundStatusLine(text: "By appointment", tone: .neutral) : nil
        }
        var isOpen = false
        if case .open = state { isOpen = true }
        return AroundStatusLine(text: p.byAppointment ? "\(line), by appointment" : line, tone: isOpen ? .open : .neutral)
    }

    /// Whether a place is open (or a dated place live) right now.
    static func isOpenNow(_ p: AroundPlace, at date: Date) -> Bool {
        if p.kind.isDated { return timedStatus(startsAt: p.startsAt, endsAt: p.endsAt, at: date) == .live }
        if case .open = openState(p.hours, tz: p.timeZone, at: date) { return true }
        return false
    }

    /// "Drop 07: Third Mainland, on now" / "…, Sat 7 Nov 12:00".
    static func nextEventLine(for p: AroundPlace, at date: Date) -> String? {
        guard let e = p.nextEvent, !e.title.isEmpty, let starts = YardDate.parse(e.startsAt) else { return nil }
        if starts <= date { return "\(e.title), on now" }
        return "\(e.title), \(dayIn(starts, tz: p.timeZone)) \(timeIn(starts, tz: p.timeZone))"
    }

    // MARK: Formatting in a zone

    private static func formatter(_ format: String, tz: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = zone(tz)
        f.dateFormat = format
        return f
    }

    /// "Sat 7 Nov".
    static func dayIn(_ date: Date, tz: String) -> String { formatter("EEE d MMM", tz: tz).string(from: date) }
    /// "12:00".
    static func timeIn(_ date: Date, tz: String) -> String { formatter("HH:mm", tz: tz).string(from: date) }
    /// "Sat 7 Nov, 12:00".
    static func dayTimeIn(_ date: Date, tz: String) -> String { "\(dayIn(date, tz: tz)), \(timeIn(date, tz: tz))" }

    /// "Sat 7 – Sun 8 Nov", "Sat 7 Nov", "Sat 31 Oct – Sun 1 Nov". An end at midnight belongs to the day before.
    static func dateRange(_ starts: Date, _ ends: Date, tz: String) -> String {
        let endAt = ends.addingTimeInterval(-0.001)
        let cal = calendar(tz)
        let a = cal.dateComponents([.day, .month], from: starts)
        let b = cal.dateComponents([.day, .month], from: endAt)
        let wd = formatter("EEE", tz: tz)
        let mon = formatter("MMM", tz: tz)
        let d = formatter("d", tz: tz)
        if a.day == b.day && a.month == b.month { return dayIn(starts, tz: tz) }
        if a.month == b.month {
            return "\(wd.string(from: starts)) \(d.string(from: starts)) – \(wd.string(from: endAt)) \(d.string(from: endAt)) \(mon.string(from: endAt))"
        }
        return "\(dayIn(starts, tz: tz)) – \(dayIn(endAt, tz: tz))"
    }

    /// "WAT", "GMT+1".
    static func zoneShort(_ tz: String, at date: Date) -> String {
        let known: [String: String] = ["Africa/Lagos": "WAT", "Africa/Accra": "GMT", "Africa/Nairobi": "EAT", "Africa/Johannesburg": "SAST"]
        if let k = known[tz] { return k }
        return zone(tz).abbreviation(for: date) ?? tz
    }

    /// Whether the place's wall clock matches the phone's right now.
    static func sameClock(_ tz: String, at date: Date) -> Bool {
        zone(tz).secondsFromGMT(for: date) == TimeZone.current.secondsFromGMT(for: date)
    }

    // MARK: Distance

    /// "850 m", "1.2 km", "24 km" (website's formatDistance).
    static func distance(_ meters: Double) -> String {
        let km = meters / 1000
        if km < 1 {
            let m = max(50, Int((km * 1000 / 50).rounded()) * 50)
            return "\(m) m"
        }
        if km < 10 { return String(format: "%.1f km", km) }
        return "\(Formatters.grouped(Int(km.rounded()))) km"
    }
}
