import Foundation

/// Inbox wording and dates, matching the website (src/components/inbox/format.ts, shopper-thread.tsx).
enum InboxFormat {
    /// "Today", "Yesterday", "Wed 4 Nov" (with the year when it isn't this year).
    static func dayLabel(_ date: Date, now: Date = Date()) -> String {
        let cal = Calendar.current
        if cal.isDateInToday(date) { return "Today" }
        if cal.isDateInYesterday(date) { return "Yesterday" }
        let sameYear = cal.isDate(date, equalTo: now, toGranularity: .year)
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate(sameYear ? "EEE d MMM" : "EEE d MMM yyyy")
        return f.string(from: date)
    }

    /// "14:05".
    static func time(_ date: Date) -> String {
        Formatters.time(date)
    }

    /// List row time: "14:05" today, "Yesterday", "Wed" this week, else "4 Nov".
    static func rowTime(_ iso: String, now: Date = Date()) -> String {
        guard let d = YardDate.parse(iso) else { return "" }
        let cal = Calendar.current
        if cal.isDateInToday(d) { return time(d) }
        if cal.isDateInYesterday(d) { return "Yesterday" }
        if now.timeIntervalSince(d) < 6 * 86_400 {
            let f = DateFormatter()
            f.setLocalizedDateFormatFromTemplate("EEE")
            return f.string(from: d)
        }
        return Formatters.shortDate(d, now: now)
    }

    /// "4 Nov 2026".
    static func shortDate(_ iso: String?) -> String {
        guard let d = YardDate.parse(iso) else { return "" }
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("d MMM yyyy")
        return f.string(from: d)
    }

    /// A sentence that ends with a name: no second full stop ("Kumasi Thread Co.").
    static func sentence(_ text: String) -> String {
        let t = text.trimmingCharacters(in: .whitespaces)
        if let last = t.last, ".!?".contains(last) { return t }
        return t + "."
    }

    /// The disabled-composer line for a shopper (shopperDisabledReason on the website). Nil = can send.
    static func disabledReason(_ i: InboxInteraction?, brand: String) -> String? {
        guard let i, !i.canSend else { return nil }
        switch i.reason ?? "" {
        case "blocked_by_them":
            return sentence("You can't message \(brand)")
        case "blocked_by_me":
            return "\(sentence("You blocked \(brand)")) Unblock them from the menu to send a message."
        case "restricted":
            if let until = i.until, !shortDate(until).isEmpty {
                return "Messaging is paused on your account until \(shortDate(until))."
            }
            return "Messaging is paused on your account."
        case "locked":
            return "This conversation was closed by Yard."
        case "brand_unavailable":
            return "\(brand) isn't taking messages right now."
        default:
            return "You can't send messages here right now."
        }
    }

    /// Shopper order status labels (customerOrderStatus on the website).
    static func orderStatus(_ status: String) -> String {
        switch status {
        case "pending_payment": return "Awaiting payment"
        case "paid": return "Confirmed"
        case "processing": return "Being prepared"
        case "shipped": return "On its way"
        case "delivered": return "Delivered"
        case "cancelled": return "Cancelled"
        case "refund_requested": return "Return requested"
        case "refunded": return "Refunded"
        default: return status.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    /// Held message explanation (heldCopy.customer).
    static let heldCopy = "Held for review. Messages with several links or payment requests outside Yard are checked first."
    /// Safety notice above a scored message (safetyCopy.customer).
    static let safetyCopy = "Keep payments on Yard. Never pay a brand outside checkout."
}
