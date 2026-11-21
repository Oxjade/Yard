import Foundation

/// The short "Sell on Yard" application's answers and rules (docs/APP.md › Shop or sell). Pure:
/// unit-tested, mirrors the server's `studioApplyBody` checks so most mistakes are caught before
/// the request.
struct SellerApplicationForm: Equatable, Sendable {
    enum Step: Int, CaseIterable, Sendable {
        case name
        case link
        case category
        case location
        case submit

        var index: Int { rawValue }
        static var count: Int { allCases.count }
    }

    /// Countries Yard sells in (the server refuses others), in the contract's order.
    static let countries: [String] = ["NG", "GH", "KE", "ZA", "GB", "FR", "DE", "US", "MX", "JP", "KR"]

    var brandName: String = ""
    var instagram: String = ""
    var website: String = ""
    var category: String? = nil
    var city: String = ""
    var country: String = "NG"

    init(regionCode: String? = nil) {
        country = Self.defaultCountry(regionCode: regionCode)
    }

    // MARK: Rules

    /// The phone's region when Yard sells there, else Nigeria (Yard's first market).
    static func defaultCountry(regionCode: String?) -> String {
        guard let code = regionCode?.uppercased(), countries.contains(code) else { return "NG" }
        return code
    }

    /// "@kachi", "kachi" or an instagram.com link → "kachi"; nil when it isn't one
    /// (server `instagramHandleOf`).
    static func instagramHandle(_ raw: String) -> String? {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }
        var handle = s
        let lower = s.lowercased()
        for prefix in ["https://www.instagram.com/", "http://www.instagram.com/", "https://instagram.com/", "http://instagram.com/", "www.instagram.com/", "instagram.com/"] {
            if lower.hasPrefix(prefix) {
                let rest = s.dropFirst(prefix.count)
                handle = String(rest.split(whereSeparator: { $0 == "/" || $0 == "?" || $0 == "#" }).first ?? "")
                break
            }
        }
        if handle.hasPrefix("@") { handle.removeFirst() }
        guard (1...30).contains(handle.count) else { return nil }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._")
        guard handle.unicodeScalars.allSatisfy({ allowed.contains($0) }) else { return nil }
        return handle
    }

    /// "yourshop.com" or "https://…" (server: `^(https?://)?[^\s/$.?#][^\s]*\.[^\s]{2,}$`).
    static func isWebsite(_ raw: String) -> Bool {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty, !s.contains(where: { $0.isWhitespace }) else { return false }
        var rest = Substring(s)
        let lower = s.lowercased()
        if lower.hasPrefix("https://") { rest = rest.dropFirst(8) } else if lower.hasPrefix("http://") { rest = rest.dropFirst(7) }
        guard let first = rest.first, !"/$.?#".contains(first) else { return false }
        guard let dot = rest.lastIndex(of: ".") else { return false }
        return rest[rest.index(after: dot)...].count >= 2
    }

    /// The shop address the server will try first (`kachi-studio`).
    static func handlePreview(_ name: String) -> String {
        let lowered = name.lowercased()
        var out = ""
        var lastDash = false
        for ch in lowered {
            if ch.isLetter && ch.isASCII || ch.isNumber && ch.isASCII {
                out.append(ch)
                lastDash = false
            } else if !out.isEmpty && !lastDash {
                out.append("-")
                lastDash = true
            }
        }
        while out.hasSuffix("-") { out.removeLast() }
        return out.isEmpty ? "your-shop" : out
    }

    var trimmedName: String { brandName.trimmingCharacters(in: .whitespacesAndNewlines) }
    var trimmedCity: String { city.trimmingCharacters(in: .whitespacesAndNewlines) }
    var hasWebsite: Bool { Self.isWebsite(website) }

    /// The message blocking `step`, or nil when it can go on.
    func problem(at step: Step) -> String? {
        switch step {
        case .name:
            if trimmedName.count < 2 { return "Enter your shop's name." }
            if trimmedName.count > 40 { return "Keep it to 40 characters." }
            if trimmedName.contains("<") || trimmedName.contains(">") { return "Use letters, numbers and simple punctuation." }
            return nil
        case .link:
            let ig = instagram.trimmingCharacters(in: .whitespacesAndNewlines)
            let web = website.trimmingCharacters(in: .whitespacesAndNewlines)
            if ig.isEmpty && web.isEmpty { return "Add your Instagram or your website, so Yard can see what you sell." }
            if !ig.isEmpty && Self.instagramHandle(ig) == nil { return "Enter an Instagram handle like @yourshop." }
            if !web.isEmpty && !Self.isWebsite(web) { return "Enter your website address, like yourshop.com." }
            return nil
        case .category:
            return category == nil ? "Choose one of Yard's categories." : nil
        case .location:
            if trimmedCity.count < 2 { return "Enter your city." }
            if trimmedCity.count > 80 { return "Keep it to 80 characters." }
            if !Self.countries.contains(country) { return "Choose a country Yard sells in." }
            return nil
        case .submit:
            for s in [Step.name, .link, .category, .location] {
                if let p = problem(at: s) { return p }
            }
            return nil
        }
    }

    /// The first step with a problem (to jump back to before submitting).
    var firstInvalidStep: Step? {
        [Step.name, .link, .category, .location].first { problem(at: $0) != nil }
    }

    /// The request body; nil fields are left out (the server is strict).
    func body() -> StudioApplyBody? {
        guard problem(at: .submit) == nil, let category else { return nil }
        let ig = instagram.trimmingCharacters(in: .whitespacesAndNewlines)
        let web = website.trimmingCharacters(in: .whitespacesAndNewlines)
        return StudioApplyBody(
            brandName: trimmedName,
            instagram: ig.isEmpty ? nil : ig,
            website: web.isEmpty ? nil : web,
            category: category,
            city: trimmedCity,
            country: country,
            about: nil
        )
    }

    /// The step a server field error belongs to.
    static func step(forField field: String) -> Step {
        switch field {
        case "brandName": return .name
        case "instagram", "website": return .link
        case "category": return .category
        case "city", "country": return .location
        default: return .submit
        }
    }
}
