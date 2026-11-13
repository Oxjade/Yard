import SwiftUI
import WebKit

/// A legal page (Terms, Privacy, Refunds, Data deletion): the website's page in an in-app web view,
/// so the text is always the one in force. `page.path` is the website path.
@MainActor
struct LegalView: View {
    let page: LegalPage

    @State private var isLoading = true
    @State private var errorMessage: String? = nil
    @State private var reloadToken = 0

    init(page: LegalPage) {
        self.page = page
    }

    private var url: URL { Config.webURL(page.path) }

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
                    reloadToken: reloadToken,
                    onFinish: { isLoading = false },
                    onFail: { message in
                        isLoading = false
                        errorMessage = message
                    }
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
                Link(destination: url) {
                    Image(systemName: "safari")
                }
                .accessibilityLabel(Text("Open in Safari"))
            }
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

/// WKWebView wrapper. Reloads when `reloadToken` changes.
private struct YouLegalWebView: UIViewRepresentable {
    let url: URL
    let reloadToken: Int
    let onFinish: () -> Void
    let onFail: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onFinish: onFinish, onFail: onFail)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        context.coordinator.lastToken = reloadToken
        view.load(URLRequest(url: url))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.onFinish = onFinish
        context.coordinator.onFail = onFail
        if context.coordinator.lastToken != reloadToken {
            context.coordinator.lastToken = reloadToken
            view.load(URLRequest(url: url))
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var onFinish: () -> Void
        var onFail: (String) -> Void
        var lastToken: Int = 0

        init(onFinish: @escaping () -> Void, onFail: @escaping (String) -> Void) {
            self.onFinish = onFinish
            self.onFail = onFail
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            onFinish()
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            report(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            report(error)
        }

        private func report(_ error: Error) {
            let ns = error as NSError
            if ns.domain == NSURLErrorDomain && ns.code == NSURLErrorCancelled { return }
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
