import Foundation

/// Shared formatting helpers. Prices always go through here (or `PriceText` / `Money.formatted`).
enum Formatters {
    /// "$45" / "$45.50" from minor units + currency code.
    static func price(minor: Int, currency: String, showCents: Bool? = nil) -> String {
        MoneyFormatter.format(minor: minor, currency: currency, showCents: showCents)
    }

    /// "1.2K", "24K", "3.4M" (followers, counts). Under 1,000 → plain "252".
    static func compactNumber(_ value: Double) -> String {
        let abs = Swift.abs(value)
        let sign = value < 0 ? "-" : ""
        func trim(_ v: Double, _ suffix: String) -> String {
            let rounded = (v * 10).rounded() / 10
            let text = rounded.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(rounded)) : String(format: "%.1f", rounded)
            return sign + text + suffix
        }
        if abs >= 1_000_000_000 { return trim(abs / 1_000_000_000, "B") }
        if abs >= 1_000_000 { return trim(abs / 1_000_000, "M") }
        if abs >= 1_000 { return trim(abs / 1_000, "K") }
        return sign + String(Int(abs.rounded()))
    }

    /// Integer convenience for `compactNumber`.
    static func count(_ value: Int) -> String { compactNumber(Double(value)) }

    /// "1,234".
    static func grouped(_ value: Int) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        return f.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// "2m ago", "3h ago", "Yesterday", "4d ago", then "12 Nov" / "12 Nov 2025".
    static func relative(_ date: Date, now: Date = Date()) -> String {
        let seconds = now.timeIntervalSince(date)
        if seconds < 0 { return future(date, now: now) }
        if seconds < 60 { return "Just now" }
        if seconds < 3600 { return "\(Int(seconds / 60))m ago" }
        if seconds < 86_400 { return "\(Int(seconds / 3600))h ago" }
        if Calendar.current.isDateInYesterday(date) { return "Yesterday" }
        if seconds < 7 * 86_400 { return "\(Int(seconds / 86_400))d ago" }
        return shortDate(date, now: now)
    }

    /// Relative from an API timestamp string; empty string when it can't be parsed.
    static func relative(_ iso: String?) -> String {
        guard let d = YardDate.parse(iso) else { return "" }
        return relative(d)
    }

    /// "in 5m", "in 3h", "in 2d", "Tomorrow" for future dates (drops).
    static func future(_ date: Date, now: Date = Date()) -> String {
        let seconds = date.timeIntervalSince(now)
        if seconds <= 0 { return "Now" }
        if seconds < 3600 { return "in \(max(1, Int(seconds / 60)))m" }
        if seconds < 86_400 { return "in \(Int(seconds / 3600))h" }
        if Calendar.current.isDateInTomorrow(date) { return "Tomorrow" }
        return "in \(Int(seconds / 86_400))d"
    }

    /// "12 Nov" this year, "12 Nov 2025" otherwise.
    static func shortDate(_ date: Date, now: Date = Date()) -> String {
        let sameYear = Calendar.current.isDate(date, equalTo: now, toGranularity: .year)
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate(sameYear ? "d MMM" : "d MMM yyyy")
        return f.string(from: date)
    }

    /// "Thu 12 Nov, 18:00".
    static func dateTime(_ date: Date) -> String {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("EEE d MMM HH:mm")
        return f.string(from: date)
    }

    /// "18:00".
    static func time(_ date: Date) -> String {
        let f = DateFormatter()
        f.timeStyle = .short
        f.dateStyle = .none
        return f.string(from: date)
    }

    /// Countdown "2d 04:12:09" / "04:12:09" from a time interval (clamped at 0).
    static func countdown(_ interval: TimeInterval) -> String {
        let total = max(0, Int(interval))
        let d = total / 86_400
        let h = (total % 86_400) / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        let clock = String(format: "%02d:%02d:%02d", h, m, s)
        return d > 0 ? "\(d)d \(clock)" : clock
    }
}
