import Foundation

// Delivery countries and their checkout rules, ported from the website:
//   src/config/markets.ts                       (countries + local currency)
//   src/components/market/checkout/rules.ts     (phone, region, postcode, payment methods)
// Plain values and functions so both the bag and the checkout read the same rules.

/// One delivery country Yard ships to.
struct BagCountry: Identifiable, Hashable, Sendable {
    let code: String
    let name: String
    /// The country's own currency (decides the charge currency when the display one can't be charged).
    let currency: String
    /// "+234".
    let dial: String
    /// Length of the national number, without the trunk 0.
    let phoneDigits: ClosedRange<Int>
    let phoneExample: String
    let regionLabel: String
    let regionRequired: Bool
    /// When set, the region is chosen from this list.
    let regionOptions: [String]?
    let postcodeLabel: String
    let postcodeRequired: Bool
    /// Regex the postcode must match (case-insensitive) when given.
    let postcodePattern: String
    let postcodeExample: String

    var id: String { code }
}

enum BagMarkets {
    private static let ngStates = ["Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "Federal Capital Territory", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara"]
    private static let ghRegions = ["Ahafo", "Ashanti", "Bono", "Bono East", "Central", "Eastern", "Greater Accra", "North East", "Northern", "Oti", "Savannah", "Upper East", "Upper West", "Volta", "Western", "Western North"]
    private static let zaProvinces = ["Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal", "Limpopo", "Mpumalanga", "North West", "Northern Cape", "Western Cape"]
    private static let digits5 = "^\\d{5}$"

    /// Every country, in the website's order.
    static let countries: [BagCountry] = [
        BagCountry(code: "NG", name: "Nigeria", currency: "NGN", dial: "+234", phoneDigits: 10...10, phoneExample: "0803 123 4567", regionLabel: "State", regionRequired: true, regionOptions: ngStates, postcodeLabel: "Postcode", postcodeRequired: false, postcodePattern: "^\\d{6}$", postcodeExample: "101245"),
        BagCountry(code: "GH", name: "Ghana", currency: "GHS", dial: "+233", phoneDigits: 9...9, phoneExample: "024 123 4567", regionLabel: "Region", regionRequired: true, regionOptions: ghRegions, postcodeLabel: "GhanaPost GPS address", postcodeRequired: false, postcodePattern: "^[A-Z]{2}-?\\d{1,4}-?\\d{4}$", postcodeExample: "GA-183-8164"),
        BagCountry(code: "KE", name: "Kenya", currency: "KES", dial: "+254", phoneDigits: 9...9, phoneExample: "0712 345 678", regionLabel: "County", regionRequired: true, regionOptions: nil, postcodeLabel: "Postal code", postcodeRequired: false, postcodePattern: digits5, postcodeExample: "00100"),
        BagCountry(code: "ZA", name: "South Africa", currency: "ZAR", dial: "+27", phoneDigits: 9...9, phoneExample: "082 123 4567", regionLabel: "Province", regionRequired: true, regionOptions: zaProvinces, postcodeLabel: "Postal code", postcodeRequired: true, postcodePattern: "^\\d{4}$", postcodeExample: "2001"),
        BagCountry(code: "GB", name: "United Kingdom", currency: "GBP", dial: "+44", phoneDigits: 10...10, phoneExample: "07700 900123", regionLabel: "County", regionRequired: false, regionOptions: nil, postcodeLabel: "Postcode", postcodeRequired: true, postcodePattern: "^[A-Z]{1,2}\\d[A-Z\\d]?\\s?\\d[A-Z]{2}$", postcodeExample: "E8 4DG"),
        BagCountry(code: "FR", name: "France", currency: "EUR", dial: "+33", phoneDigits: 9...9, phoneExample: "06 12 34 56 78", regionLabel: "Region", regionRequired: false, regionOptions: nil, postcodeLabel: "Postcode", postcodeRequired: true, postcodePattern: digits5, postcodeExample: "75011"),
        BagCountry(code: "DE", name: "Germany", currency: "EUR", dial: "+49", phoneDigits: 7...11, phoneExample: "01512 3456789", regionLabel: "State", regionRequired: false, regionOptions: nil, postcodeLabel: "Postcode", postcodeRequired: true, postcodePattern: digits5, postcodeExample: "10115"),
        BagCountry(code: "US", name: "United States", currency: "USD", dial: "+1", phoneDigits: 10...10, phoneExample: "(212) 555-0142", regionLabel: "State", regionRequired: true, regionOptions: nil, postcodeLabel: "ZIP code", postcodeRequired: true, postcodePattern: "^\\d{5}(-\\d{4})?$", postcodeExample: "10001"),
        BagCountry(code: "MX", name: "Mexico", currency: "MXN", dial: "+52", phoneDigits: 10...10, phoneExample: "55 1234 5678", regionLabel: "State", regionRequired: true, regionOptions: nil, postcodeLabel: "Postal code", postcodeRequired: true, postcodePattern: digits5, postcodeExample: "06700"),
        BagCountry(code: "JP", name: "Japan", currency: "JPY", dial: "+81", phoneDigits: 9...10, phoneExample: "090-1234-5678", regionLabel: "Prefecture", regionRequired: true, regionOptions: nil, postcodeLabel: "Postal code", postcodeRequired: true, postcodePattern: "^\\d{3}-?\\d{4}$", postcodeExample: "150-0001"),
        BagCountry(code: "KR", name: "South Korea", currency: "KRW", dial: "+82", phoneDigits: 9...10, phoneExample: "010-1234-5678", regionLabel: "Province or city", regionRequired: false, regionOptions: nil, postcodeLabel: "Postal code", postcodeRequired: true, postcodePattern: digits5, postcodeExample: "04524"),
    ]

    static func country(_ code: String) -> BagCountry {
        countries.first { $0.code == code.uppercased() } ?? countries[0]
    }

    static func isSupported(_ code: String) -> Bool {
        countries.contains { $0.code == code.uppercased() }
    }

    // MARK: Ship-to (persisted, like the website's session shipTo / shipToCity)

    private static let shipToKey = "yard.bag.shipTo"
    private static let shipToCityKey = "yard.bag.shipToCity"

    /// The delivery country the bag quotes shipping for. Defaults to the device region when Yard
    /// ships there, else Nigeria (the website's default).
    static var shipTo: String {
        get {
            if let saved = UserDefaults.standard.string(forKey: shipToKey), isSupported(saved) { return saved }
            let region = Locale.current.region?.identifier ?? ""
            return isSupported(region) ? region.uppercased() : "NG"
        }
        set { UserDefaults.standard.set(newValue.uppercased(), forKey: shipToKey) }
    }

    static var shipToCity: String? {
        get {
            let v = UserDefaults.standard.string(forKey: shipToCityKey)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return v.isEmpty ? nil : v
        }
        set {
            let v = newValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if v.isEmpty {
                UserDefaults.standard.removeObject(forKey: shipToCityKey)
            } else {
                UserDefaults.standard.set(String(v.prefix(60)), forKey: shipToCityKey)
            }
        }
    }

    // MARK: Phone

    /// Normalises a phone number to "+234 8031234567", or nil if it doesn't fit the country.
    static func parsePhone(_ raw: String, country: BagCountry) -> String? {
        var n = raw.filter { !" -().".contains($0) && !$0.isWhitespace }
        guard !n.isEmpty, n.range(of: "^\\+?\\d+$", options: .regularExpression) != nil else { return nil }
        if n.hasPrefix("+") {
            if n.hasPrefix(country.dial) {
                n = String(n.dropFirst(country.dial.count))
            } else {
                let intl = String(n.dropFirst())
                return (8...15).contains(intl.count) ? "+\(intl)" : nil
            }
        } else if n.hasPrefix("00") {
            return parsePhone("+" + String(n.dropFirst(2)), country: country)
        }
        if n.hasPrefix("0") { n = String(n.dropFirst()) }
        guard country.phoneDigits.contains(n.count) else { return nil }
        return "\(country.dial) \(n)"
    }

    /// "Ikeja, Lagos", or just "Lagos" when the city and region match.
    static func cityLine(city: String, region: String) -> String {
        let c = city.trimmingCharacters(in: .whitespacesAndNewlines)
        let r = region.trimmingCharacters(in: .whitespacesAndNewlines)
        return (!r.isEmpty && r.lowercased() != c.lowercased()) ? "\(c), \(r)" : c
    }

    // MARK: Charge currency and payment methods

    /// What a checkout charges in: the display currency when the provider takes it, else the
    /// delivery country's, else NGN when allowed, else the first allowed (rules.ts chargeCurrencyFor).
    static func chargeCurrency(display: String, country: BagCountry, allowed: [String]) -> String {
        let list = allowed.isEmpty ? ["NGN"] : allowed.map { $0.uppercased() }
        if list.contains(display.uppercased()) { return display.uppercased() }
        if list.contains(country.currency) { return country.currency }
        return list.contains("NGN") ? "NGN" : list[0]
    }

    /// Methods offered for a country and charge currency (rules.ts paymentMethodsFor / bachsPaymentMethodsFor).
    static func paymentMethods(country: String, currency: String, provider: String) -> [BagPaymentMethod] {
        if provider == "bachs" {
            if currency == "NGN" { return [.card, .bankTransfer] }
            if currency == "GHS" || currency == "KES" { return [.mobileMoney] }
            return [.card]
        }
        switch (country, currency) {
        case ("NG", "NGN"): return [.card, .bankTransfer, .ussd]
        case ("GH", "GHS"): return [.card, .mobileMoney]
        case ("KE", "KES"): return [.card, .mobileMoney]
        case ("ZA", "ZAR"): return [.card, .bankTransfer]
        default: return [.card]
        }
    }

    /// "Paystack" / "Bachs".
    static func providerName(_ provider: String) -> String {
        provider == "bachs" ? "Bachs" : "Paystack"
    }

    // MARK: Delivery estimates

    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "d MMM"
        return f
    }()

    private static let dayNumberFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "d"
        return f
    }()

    /// "11–16 Nov", "30 Nov – 2 Dec", "11 Nov" from calendar dates ("2026-11-11"); nil without both.
    static func arrivalRange(from: String?, to: String?) -> String? {
        guard let from, let to, let a = YardDate.parse(from), let b = YardDate.parse(to) else { return nil }
        if from == to { return dayFormatter.string(from: a) }
        if from.prefix(7) == to.prefix(7) {
            return "\(dayNumberFormatter.string(from: a))–\(dayFormatter.string(from: b))"
        }
        return "\(dayFormatter.string(from: a)) – \(dayFormatter.string(from: b))"
    }
}

/// How the shopper will pay (the server's PAYMENT_METHODS). Card details are typed on the
/// provider's hosted page, never in the app.
enum BagPaymentMethod: String, CaseIterable, Identifiable, Hashable, Sendable {
    case card
    case bankTransfer = "bank_transfer"
    case ussd
    case mobileMoney = "mobile_money"

    var id: String { rawValue }

    func title(country: String) -> String {
        switch self {
        case .card: return "Card"
        case .bankTransfer: return country == "ZA" ? "Instant EFT" : "Bank transfer"
        case .ussd: return "USSD"
        case .mobileMoney: return country == "KE" ? "M-Pesa or Airtel Money" : "Mobile money"
        }
    }

    func detail(country: String) -> String {
        switch self {
        case .card: return country == "NG" ? "Visa, Mastercard and Verve" : "Visa, Mastercard and American Express"
        case .bankTransfer: return country == "ZA" ? "Instant EFT from your banking app" : "Pay into a one-time account number"
        case .ussd: return "Dial a short code from your phone, no data needed"
        case .mobileMoney: return country == "KE" ? "Approve the prompt on your phone" : "MTN MoMo, Telecel Cash or AirtelTigo Money"
        }
    }

    /// What the provider's page asks for (rules.ts paymentMethodNext).
    func next(country: String, providerName: String) -> String {
        switch self {
        case .card:
            return "Yard never sees or stores your card number."
        case .bankTransfer:
            return country == "ZA" && providerName == "Paystack"
                ? "Paystack takes you to your bank to approve the payment. Brands start preparing orders once it clears."
                : "\(providerName) shows a one-time account number and the exact amount to send from your banking app."
        case .ussd:
            return "\(providerName) shows the code to dial for your bank. Dial it from the phone number linked to your account."
        case .mobileMoney:
            return "\(providerName) asks for your mobile money number and sends a prompt to approve on your phone."
        }
    }

    var systemImage: String {
        switch self {
        case .card: return "creditcard"
        case .bankTransfer: return "building.columns"
        case .ussd: return "number"
        case .mobileMoney: return "iphone"
        }
    }
}
