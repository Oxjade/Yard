import Foundation

extension KeyedDecodingContainer {
    /// Decodes `key` leniently: missing, `null` or the wrong type → `fallback`.
    /// Used by shared models so one odd field never fails a whole screen.
    func lenient<T: Decodable>(_ key: Key, _ fallback: T) -> T {
        ((try? decodeIfPresent(T.self, forKey: key)) ?? nil) ?? fallback
    }

    /// Decodes an optional `key` leniently: missing, `null` or the wrong type → `nil`.
    func lenientOptional<T: Decodable>(_ key: Key, as type: T.Type = T.self) -> T? {
        (try? decodeIfPresent(T.self, forKey: key)) ?? nil
    }
}

/// ISO-8601 timestamps from the API ("2026-11-13T19:32:00.000Z"). Models keep the raw string and
/// expose a `Date?` via `YardDate.parse`.
enum YardDate {
    private static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let plain: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    private static let dayOnly: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withFullDate]
        return f
    }()

    /// Parses an API timestamp (with or without fractional seconds, or a bare yyyy-MM-dd).
    static func parse(_ string: String?) -> Date? {
        guard let s = string, !s.isEmpty else { return nil }
        return withFraction.date(from: s) ?? plain.date(from: s) ?? dayOnly.date(from: s)
    }
}
