import Foundation

/// App-wide configuration: the API base URL and media URL resolution.
enum Config {
    /// The production site. Every API path and relative media path resolves against `baseURL`.
    static let productionBaseURL = URL(string: "https://yardstore.space")!

    /// UserDefaults key for a development override, e.g. `http://192.168.1.20:3000`.
    /// Set it from a debug menu or `defaults write`; leave unset for production.
    static let baseURLOverrideKey = "yard.baseURLOverride"

    /// The base URL in use (the override when one is set and valid, else production).
    static var baseURL: URL {
        if let raw = UserDefaults.standard.string(forKey: baseURLOverrideKey),
           let url = URL(string: raw), url.scheme != nil, url.host != nil {
            return url
        }
        return productionBaseURL
    }

    /// The `Origin` header value non-GET requests must carry (scheme + host + port of `baseURL`).
    static var origin: String {
        let url = baseURL
        var s = "\(url.scheme ?? "https")://\(url.host ?? "yardstore.space")"
        if let port = url.port { s += ":\(port)" }
        return s
    }

    /// Resolves a media or page path from the API to an absolute URL.
    ///
    /// - `nil` / empty → `nil`
    /// - `https://…` / `http://…` → unchanged
    /// - `//cdn…` → `https:` prefixed
    /// - `/api/media/…`, `/site/…`, `/media/…` → `baseURL` + path (query kept)
    /// - anything else (a bare relative path) → `baseURL` + "/" + path
    static func url(for path: String?) -> URL? {
        guard let raw = path?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        let lower = raw.lowercased()
        if lower.hasPrefix("http://") || lower.hasPrefix("https://") { return URL(string: raw) }
        if raw.hasPrefix("//") { return URL(string: "https:" + raw) }
        let rooted = raw.hasPrefix("/") ? raw : "/" + raw
        return URL(string: rooted, relativeTo: baseURL)?.absoluteURL
    }

    /// The web URL for a site path, e.g. `Config.webURL("/brands/acme")` for share sheets.
    static func webURL(_ path: String) -> URL {
        url(for: path) ?? baseURL
    }

    /// `/api/media/{id}`: the public URL of a media id (same as the server's `mediaSrc`).
    static func mediaPath(id: String) -> String {
        let encoded = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id
        return "/api/media/\(encoded)"
    }
}
