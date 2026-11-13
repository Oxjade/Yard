import SwiftUI
import WebKit

// Social sign-in (Google via Auth0, Apple, …) in an in-app web view.
//
// Why a WKWebView and not ASWebAuthenticationSession: the server binds every OAuth round trip to
// the browser that started it (`yard_oauth` cookie set by POST /api/auth/oauth/{p}/start, checked
// by the callback) and finishes by setting the session cookie (`yard_s`) on the callback response.
// ASWebAuthenticationSession runs in Safari's cookie jar, which the app can neither write the
// binding cookie into nor read the session cookie back from, so the callback would answer
// `invalid_state` and the app would never be signed in. A WKWebView with its own data store lets
// us copy the binding cookie in before loading, and copy the session cookie back into
// `HTTPCookieStorage.shared` (which `APIClient` uses) when the flow lands on /auth/complete.

/// How the web flow ended.
enum AuthWebOutcome: Equatable {
    /// Reached /auth/complete with `result=` (e.g. "signed_in", "cancelled", "invalid_state").
    case completed(result: String)
    /// The shopper closed the sheet.
    case cancelled
    /// The page could not load.
    case failed(message: String)
}

/// A started social sign-in, presented with `.sheet(item:)`.
struct AuthWebFlow: Identifiable, Equatable {
    let id = UUID()
    let url: URL
    let label: String
}

/// Copies cookies between the app's jar (`HTTPCookieStorage.shared`) and a web view's jar.
@MainActor
enum AuthCookieBridge {
    /// True when `cookie` belongs to the API host (host-only `__Host-` cookies or `.domain` ones).
    static func belongsToAPI(_ cookie: HTTPCookie) -> Bool {
        guard let host = Config.baseURL.host?.lowercased() else { return false }
        var domain = cookie.domain.lowercased()
        if domain.hasPrefix(".") { domain.removeFirst() }
        return domain == host || host.hasSuffix("." + domain)
    }

    /// The app's cookies for the API host (guest cart, the OAuth binding cookie, …).
    static func appCookies() -> [HTTPCookie] {
        HTTPCookieStorage.shared.cookies(for: Config.baseURL) ?? []
    }

    static func setCookies(_ cookies: [HTTPCookie], in store: WKHTTPCookieStore) async {
        for cookie in cookies {
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                store.setCookie(cookie) {
                    continuation.resume()
                }
            }
        }
    }

    static func allCookies(in store: WKHTTPCookieStore) async -> [HTTPCookie] {
        await withCheckedContinuation { (continuation: CheckedContinuation<[HTTPCookie], Never>) in
            store.getAllCookies { cookies in
                continuation.resume(returning: cookies)
            }
        }
    }

    /// Copies the web view's API-host cookies into the app's jar. Returns true when a shopper
    /// session cookie (`yard_s` / `__Host-yard_s`) came across.
    @discardableResult
    static func importCookies(_ cookies: [HTTPCookie]) -> Bool {
        var gotSession = false
        for cookie in cookies where belongsToAPI(cookie) {
            HTTPCookieStorage.shared.setCookie(cookie)
            if cookie.name == "yard_s" || cookie.name == "__Host-yard_s" {
                gotSession = true
            }
        }
        // The binding cookie is single-use; drop the app's stale copy.
        for cookie in appCookies() where cookie.name.hasSuffix("yard_oauth") {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }
        return gotSession
    }
}

/// The sheet: a navigation bar with Cancel, the web view, and a spinner while pages load.
@MainActor
struct AuthWebSheet: View {
    let flow: AuthWebFlow
    let onFinish: (AuthWebOutcome) -> Void

    init(flow: AuthWebFlow, onFinish: @escaping (AuthWebOutcome) -> Void) {
        self.flow = flow
        self.onFinish = onFinish
    }

    @State private var dataStore: WKWebsiteDataStore = WKWebsiteDataStore.nonPersistent()
    @State private var isReady: Bool = false
    @State private var isLoading: Bool = true
    @State private var didFinish: Bool = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.yard.bg.ignoresSafeArea()
                if isReady {
                    AuthWebView(
                        url: flow.url,
                        dataStore: dataStore,
                        isLoading: $isLoading,
                        onFinish: finish
                    )
                    .ignoresSafeArea(edges: .bottom)
                }
                if isLoading {
                    VStack(spacing: Spacing.m) {
                        ProgressView()
                            .tint(Color.yard.ink)
                        Text("Opening \(flow.label)…")
                            .font(.yardCallout)
                            .foregroundStyle(Color.yard.ink2)
                    }
                    .padding(Spacing.xl)
                    .yardCard()
                    .transition(.opacity)
                }
            }
            .animation(Motion.fade, value: isLoading)
            .navigationTitle("Continue with \(flow.label)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { finish(.cancelled) }
                        .foregroundStyle(Color.yard.ink)
                }
            }
        }
        .task {
            guard !isReady else { return }
            // Carry the app's cookies (above all the OAuth binding cookie) into the web view.
            await AuthCookieBridge.setCookies(AuthCookieBridge.appCookies(), in: dataStore.httpCookieStore)
            isReady = true
        }
        .onDisappear {
            // Swiped down: treat as cancel (finish is idempotent).
            finish(.cancelled)
        }
    }

    private func finish(_ outcome: AuthWebOutcome) {
        guard !didFinish else { return }
        didFinish = true
        onFinish(outcome)
    }
}

/// WKWebView wrapper that stops at https://<api host>/auth/complete and imports the cookies.
@MainActor
private struct AuthWebView: UIViewRepresentable {
    let url: URL
    let dataStore: WKWebsiteDataStore
    @Binding var isLoading: Bool
    let onFinish: (AuthWebOutcome) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = dataStore
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        context.coordinator.parent = self
    }

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.stopLoading()
        uiView.navigationDelegate = nil
        uiView.uiDelegate = nil
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var parent: AuthWebView
        private var completed: Bool = false

        init(parent: AuthWebView) {
            self.parent = parent
        }

        private func isCompletionURL(_ url: URL) -> Bool {
            guard let host = url.host?.lowercased(), let apiHost = Config.baseURL.host?.lowercased() else { return false }
            return host == apiHost && url.path == "/auth/complete"
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = navigationAction.request.url else { return .allow }
            if isCompletionURL(url) {
                complete(with: url, webView: webView)
                return .cancel
            }
            return .allow
        }

        private func complete(with url: URL, webView: WKWebView) {
            guard !completed else { return }
            completed = true
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
            let result = items.first(where: { $0.name == "result" })?.value ?? "error"
            let store = webView.configuration.websiteDataStore.httpCookieStore
            parent.isLoading = true
            Task { @MainActor in
                // The session cookie arrives on the callback's redirect; give the cookie store a
                // moment to settle before reading it.
                var attempt = 0
                while attempt < 5 {
                    let cookies = await AuthCookieBridge.allCookies(in: store)
                    let gotSession = AuthCookieBridge.importCookies(cookies)
                    if gotSession || result != "signed_in" { break }
                    attempt += 1
                    try? await Task.sleep(nanoseconds: 300_000_000)
                }
                self.parent.onFinish(.completed(result: result))
            }
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            if !completed { parent.isLoading = true }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            if !completed { parent.isLoading = false }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            if !completed { parent.isLoading = false }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            guard !completed else { return }
            parent.isLoading = false
            let nsError = error as NSError
            // Our own cancel of /auth/complete, or a navigation replaced by another one.
            if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
            if nsError.domain == "WebKitErrorDomain" && nsError.code == 102 { return }
            completed = true
            parent.onFinish(.failed(message: APIError.network(error).message))
        }

        /// Providers sometimes open a new window (target=_blank / window.open): keep it in this view.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if navigationAction.targetFrame == nil {
                webView.load(navigationAction.request)
            }
            return nil
        }
    }
}
