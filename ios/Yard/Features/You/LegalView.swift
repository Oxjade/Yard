import SwiftUI
import WebKit

/// A legal page (Terms, Privacy, Refunds, Data deletion): the website's page in an in-app web view,
/// so the text is always the one in force. It loads `page.path` with `?view=app`, which makes the
/// site render only the page content (no header, tab bar, footer or overlays). Links to other
/// `/legal/` pages stay inside with `?view=app`; any other link opens in Safari View Controller.
@MainActor
struct LegalView: View {
    let page: LegalPage

    @Environment(\.colorScheme) private var colorScheme
    @State private var isLoading = true
    @State private var errorMessage: String? = nil
    @State private var reloadToken = 0
    @State private var externalPage: YouWebPage? = nil

    init(page: LegalPage) {
        self.page = page
    }

    /// The in-app form of the page (`…/legal/terms?view=app`).
    private var url: URL { AppWebLinks.appViewURL(path: page.path, base: Config.baseURL) }
    /// The full website page, for "Open in Safari".
    private var siteURL: URL { Config.webURL(page.path) }

    var body: some View {
        ZStack {
            if let errorMessage {
                EmptyState.error(message: errorMessage) {
                    self.errorMessage = nil
                    isLoading = true
                    reloadToken += 1
                }
            } else {
                YouLegalWebView(
                    url: url,
                    base: Config.baseURL,
                    reloadToken: reloadToken,
                    colorScheme: colorScheme,
                    onFinish: { isLoading = false },
                    onFail: { message in
                        isLoading = false
                        errorMessage = message
                    },
                    onOpenExternal: { link in openExternally(link) }
                )
                .opacity(isLoading ? 0 : 1)
                if isLoading {
                    loadingSkeleton
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .yardScreenBackground()
        .navigationTitle(page.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Link(destination: siteURL) {
                    Image(systemName: "safari")
                }
                .accessibilityLabel(Text("Open in Safari"))
            }
        }
        .youWebPage($externalPage)
    }

    private func openExternally(_ link: URL) {
        let scheme = link.scheme?.lowercased() ?? ""
        if scheme == "http" || scheme == "https" {
            externalPage = YouWebPage(url: link)
        } else {
            UIApplication.shared.open(link)
        }
    }

    private var loadingSkeleton: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Skeleton(cornerRadius: 6).frame(width: 200, height: 28)
            ForEach(0..<8, id: \.self) { i in
                Skeleton(cornerRadius: 4)
                    .frame(height: 12)
                    .padding(.trailing, CGFloat((i * 37) % 90))
            }
            Spacer()
        }
        .padding(Spacing.gutter)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// WKWebView wrapper. Reloads when `reloadToken` changes; follows the app's colour scheme so the
/// page's `prefers-color-scheme` matches the app; transparent so the app background shows while
/// the page paints (never a blank black view).
private struct YouLegalWebView: UIViewRepresentable {
    let url: URL
    let base: URL
    let reloadToken: Int
    let colorScheme: ColorScheme
    let onFinish: () -> Void
    let onFail: (String) -> Void
    let onOpenExternal: (URL) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(base: base, onFinish: onFinish, onFail: onFail, onOpenExternal: onOpenExternal)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        view.underPageBackgroundColor = UIColor(Color.yard.bg)
        view.overrideUserInterfaceStyle = Self.style(for: colorScheme)
        context.coordinator.lastToken = reloadToken
        view.load(Self.request(url))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.onFinish = onFinish
        context.coordinator.onFail = onFail
        context.coordinator.onOpenExternal = onOpenExternal
        let style = Self.style(for: colorScheme)
        if view.overrideUserInterfaceStyle != style {
            view.overrideUserInterfaceStyle = style
        }
        if context.coordinator.lastToken != reloadToken {
            context.coordinator.lastToken = reloadToken
            view.load(Self.request(url))
        }
    }

    static func request(_ url: URL) -> URLRequest {
        URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30)
    }

    static func style(for scheme: ColorScheme) -> UIUserInterfaceStyle {
        scheme == .dark ? .dark : .light
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let base: URL
        var onFinish: () -> Void
        var onFail: (String) -> Void
        var onOpenExternal: (URL) -> Void
        var lastToken: Int = 0
        /// Rewrites done in the current navigation chain, so a server that drops `view=app` cannot loop.
        private var rewriteGuard = AppViewRewriteGuard()

        init(base: URL, onFinish: @escaping () -> Void, onFail: @escaping (String) -> Void, onOpenExternal: @escaping (URL) -> Void) {
            self.base = base
            self.onFinish = onFinish
            self.onFail = onFail
            self.onOpenExternal = onOpenExternal
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let target = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }
            let scheme = target.scheme?.lowercased() ?? ""
            if scheme == "about" || scheme == "data" || scheme == "blob" {
                decisionHandler(.allow)
                return
            }
            if scheme != "http" && scheme != "https" {
                // mailto:, tel:, … go to the system.
                decisionHandler(.cancel)
                onOpenExternal(target)
                return
            }
            // Sub-frame loads (embedded content) stay as they are.
            if let frame = navigationAction.targetFrame, !frame.isMainFrame {
                decisionHandler(.allow)
                return
            }
            let opensNewWindow = navigationAction.targetFrame == nil
            // A new tap starts a new chain; redirects and our own loads stay in the current one.
            if navigationAction.navigationType == .linkActivated { rewriteGuard.reset() }
            switch AppWebLinks.route(target, base: base) {
            case .allow:
                if opensNewWindow {
                    decisionHandler(.cancel)
                    webView.load(YouLegalWebView.request(target))
                } else {
                    decisionHandler(.allow)
                }
            case .rewrite(let inApp):
                if opensNewWindow || rewriteGuard.shouldRewrite(to: inApp) {
                    decisionHandler(.cancel)
                    webView.load(YouLegalWebView.request(inApp))
                } else {
                    // Already rewritten to this url in this chain and the server dropped
                    // view=app again: load what it sends rather than loop.
                    decisionHandler(.allow)
                }
            case .external(let link):
                decisionHandler(.cancel)
                onOpenExternal(link)
            }
        }

        /// `target="_blank"` links when the navigation delegate did not already handle them.
        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if let target = navigationAction.request.url {
                switch AppWebLinks.route(target, base: base) {
                case .allow: webView.load(YouLegalWebView.request(target))
                case .rewrite(let inApp): webView.load(YouLegalWebView.request(inApp))
                case .external(let link): onOpenExternal(link)
                }
            }
            return nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            rewriteGuard.reset()
            onFinish()
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            report(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            report(error)
        }

        /// The page's process was killed (memory pressure): reload instead of showing a blank view.
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.reload()
        }

        private func report(_ error: Error) {
            let ns = error as NSError
            if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return }
            // WebKitErrorFrameLoadInterruptedByPolicyChange: our own cancel + reload.
            if ns.domain == "WebKitErrorDomain" && ns.code == 102 { return }
            rewriteGuard.reset()
            onFail(APIError.network(error).message)
        }
    }
}

#Preview("LegalView — dark") {
    NavigationStack { LegalView(page: .terms) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("LegalView — light") {
    NavigationStack { LegalView(page: .privacy) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
