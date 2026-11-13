import Foundation

/// An amount in integer minor units (cents, kobo…) plus an ISO currency code, as the API sends it.
/// Note the API's field names vary: products use `priceMinor` + `currency`, the wishlist uses
/// `{ amount, currency }` (decoded straight into `Money`), carts use `unitMinor`/`lineMinor`.
struct Money: Codable, Hashable, Sendable {
    /// Minor units (e.g. 4500 = $45.00; JPY/KRW have no minor unit).
    let amount: Int
    /// ISO 4217 code, e.g. "USD", "NGN".
    let currency: String

    init(amount: Int, currency: String) {
        self.amount = amount
        self.currency = currency
    }

    /// "$45", "$45.50", "₦12,000", "MX$640" — same rules as the website's `formatMoney`.
    var formatted: String { MoneyFormatter.format(minor: amount, currency: currency) }
}

/// Port of the website's `src/lib/money.ts` + `src/config/markets.ts` currency table.
enum MoneyFormatter {
    struct CurrencyInfo: Sendable {
        let symbol: String
        let minor: Int
        let locale: String
    }

    /// The website's currencies. Unknown codes fall back to 2 minor digits and the code as symbol.
    static let currencies: [String: CurrencyInfo] = [
        "USD": CurrencyInfo(symbol: "$", minor: 2, locale: "en_US"),
        "NGN": CurrencyInfo(symbol: "₦", minor: 2, locale: "en_NG"),
        "GBP": CurrencyInfo(symbol: "£", minor: 2, locale: "en_GB"),
        "EUR": CurrencyInfo(symbol: "€", minor: 2, locale: "de_DE"),
        "GHS": CurrencyInfo(symbol: "GH₵", minor: 2, locale: "en_GH"),
        "KES": CurrencyInfo(symbol: "KSh", minor: 2, locale: "en_KE"),
        "ZAR": CurrencyInfo(symbol: "R", minor: 2, locale: "en_ZA"),
        "JPY": CurrencyInfo(symbol: "¥", minor: 0, locale: "ja_JP"),
        "KRW": CurrencyInfo(symbol: "₩", minor: 0, locale: "ko_KR"),
        "MXN": CurrencyInfo(symbol: "MX$", minor: 2, locale: "es_MX"),
    ]

    static func info(for currency: String) -> CurrencyInfo {
        currencies[currency.uppercased()] ?? CurrencyInfo(symbol: currency.uppercased(), minor: 2, locale: "en_US")
    }

    /// Minor units → major units (4500 USD → 45.0).
    static func toMajor(_ minor: Int, currency: String) -> Double {
        let digits = info(for: currency).minor
        var divisor = 1.0
        for _ in 0..<digits { divisor *= 10 }
        return Double(minor) / divisor
    }

    /// Formats minor units. Cents show only when the amount has them (unless `showCents`).
    /// `compact` gives "$1.2K".
    static func format(minor: Int, currency: String, showCents: Bool? = nil, compact: Bool = false) -> String {
        let code = currency.uppercased()
        let c = info(for: code)
        let major = toMajor(minor, currency: code)
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.locale = Locale(identifier: c.locale)
        f.currencyCode = code
        f.currencySymbol = c.symbol
        if compact {
            return c.symbol + Formatters.compactNumber(major)
        }
        let wantsCents = showCents ?? (major.rounded(.towardZero) != major)
        f.minimumFractionDigits = wantsCents ? c.minor : 0
        f.maximumFractionDigits = c.minor
        var out = f.string(from: NSNumber(value: major)) ?? "\(c.symbol)\(major)"
        // A prefix symbol sits against the number ("KSh8,296", not "KSh 8,296").
        if out.hasPrefix(c.symbol) {
            let rest = out.dropFirst(c.symbol.count)
            let trimmed = rest.drop(while: { $0 == " " || $0 == "\u{00A0}" || $0 == "\u{202F}" })
            out = c.symbol + trimmed
        }
        return out
    }
}
