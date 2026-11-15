import Foundation

/// URL rules for website pages shown inside an in-app web view (the legal pages).
///
/// Shared contract with the website: a page requested with `?view=app` renders only its content
/// (no market header, tab bar, footer, overlays). Links to other `/legal/` pages stay in the web
/// view with `?view=app`; anything else leaves the web view (Safari View Controller for http(s),
/// the system for mail/tel links). Mirrors `AppWebView.kt` in the Android app.
enum AppWebLinks {
    static let viewParam = "view"
    static let viewApp = "app"

    /// What the web view does with a main-frame navigation.
    enum Navigation: Equatable {
        /// Let the web view load the url as is (already an in-app page).
        case allow
        /// Load this url in the web view instead (the in-app form of the link).
        case rewrite(URL)
        /// Open this url outside the web view.
        case external(URL)
    }

    /// `url` with `view=app` set, keeping every other query item and the fragment. A url that
    /// already has exactly `view=app` is returned unchanged; another `view` value is replaced.
    /// A url that isn't http(s) is returned unchanged.
    static func appViewURL(_ url: URL) -> URL {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              var components = URLComponents(url: url, resolvingAgainstBaseURL: true) else { return url }
        var items: [URLQueryItem] = components.queryItems ?? []
        let views = items.filter { $0.name == viewParam }
        if views.count == 1 && views[0].value == viewApp { return url }
        items.removeAll { $0.name == viewParam }
        items.append(URLQueryItem(name: viewParam, value: viewApp))
        components.queryItems = items
        return components.url ?? url
    }

    /// The in-app URL of a site path, e.g. `appViewURL(path: "/legal/terms", base: Config.baseURL)`.
    static func appViewURL(path: String, base: URL) -> URL {
        let resolved: URL = URL(string: path, relativeTo: base)?.absoluteURL ?? base
        return appViewURL(resolved)
    }

    /// True when `url` is a `/legal/…` page on the site (`base`'s host, or its www./apex twin).
    static func isLegalPage(_ url: URL, base: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host, let baseHost = base.host, sameSite(host, baseHost) else { return false }
        var path = url.path
        while path.count > 1 && path.hasSuffix("/") { path.removeLast() }
        return path == "/legal" || path.hasPrefix("/legal/")
    }

    /// Decides what a main-frame navigation to `url` does inside the web view.
    static func route(_ url: URL, base: URL) -> Navigation {
        if !isLegalPage(url, base: base) { return .external(url) }
        let inApp = appViewURL(url)
        return inApp == url ? .allow : .rewrite(inApp)
    }

    private static func sameSite(_ a: String, _ b: String) -> Bool {
        strip(a.lowercased()) == strip(b.lowercased())
    }

    private static func strip(_ host: String) -> String {
        host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }
}
