import XCTest
@testable import Yard

// Mirrors AppWebViewTest.kt in the Android app.
final class AppWebLinksTests: XCTestCase {
    private let base = URL(string: "https://yardstore.space")!

    private func u(_ s: String) -> URL { URL(string: s)! }

    func testAppViewURLFromPath() {
        XCTAssertEqual(AppWebLinks.appViewURL(path: "/legal/terms", base: base).absoluteString,
                       "https://yardstore.space/legal/terms?view=app")
        XCTAssertEqual(AppWebLinks.appViewURL(path: "/legal/data-deletion", base: base).absoluteString,
                       "https://yardstore.space/legal/data-deletion?view=app")
    }

    func testAppViewURLForEveryLegalPage() {
        for page in LegalPage.allCases {
            let url = AppWebLinks.appViewURL(path: page.path, base: base)
            XCTAssertEqual(url.absoluteString, "https://yardstore.space\(page.path)?view=app")
        }
    }

    func testAppViewURLKeepsQueryAndFragment() {
        XCTAssertEqual(AppWebLinks.appViewURL(u("https://yardstore.space/legal/privacy?a=1#cookies")).absoluteString,
                       "https://yardstore.space/legal/privacy?a=1&view=app#cookies")
    }

    func testAppViewURLIsIdempotentAndReplacesOtherViewValues() {
        let already = u("https://yardstore.space/legal/terms?view=app")
        XCTAssertEqual(AppWebLinks.appViewURL(already), already)
        XCTAssertEqual(AppWebLinks.appViewURL(u("https://yardstore.space/legal/terms?view=web")).absoluteString,
                       "https://yardstore.space/legal/terms?view=app")
        XCTAssertEqual(AppWebLinks.appViewURL(u("https://yardstore.space/legal/terms?view=web&view=app")).absoluteString,
                       "https://yardstore.space/legal/terms?view=app")
    }

    func testAppViewURLLeavesNonHTTPAlone() {
        let mail = u("mailto:help@yardstore.space")
        XCTAssertEqual(AppWebLinks.appViewURL(mail), mail)
    }

    func testIsLegalPage() {
        XCTAssertTrue(AppWebLinks.isLegalPage(u("https://yardstore.space/legal/terms"), base: base))
        XCTAssertTrue(AppWebLinks.isLegalPage(u("https://www.yardstore.space/legal/privacy/"), base: base))
        XCTAssertTrue(AppWebLinks.isLegalPage(u("https://YARDSTORE.space/legal"), base: base))
        XCTAssertFalse(AppWebLinks.isLegalPage(u("https://yardstore.space/legalese"), base: base))
        XCTAssertFalse(AppWebLinks.isLegalPage(u("https://yardstore.space/support"), base: base))
        XCTAssertFalse(AppWebLinks.isLegalPage(u("https://example.com/legal/terms"), base: base))
        XCTAssertFalse(AppWebLinks.isLegalPage(u("mailto:legal@yardstore.space"), base: base))
    }

    func testRoute() {
        XCTAssertEqual(AppWebLinks.route(u("https://yardstore.space/legal/terms?view=app"), base: base), .allow)
        XCTAssertEqual(AppWebLinks.route(u("https://yardstore.space/legal/refunds"), base: base),
                       .rewrite(u("https://yardstore.space/legal/refunds?view=app")))
        XCTAssertEqual(AppWebLinks.route(u("https://yardstore.space/brands/acme"), base: base),
                       .external(u("https://yardstore.space/brands/acme")))
        XCTAssertEqual(AppWebLinks.route(u("https://stripe.com/privacy"), base: base),
                       .external(u("https://stripe.com/privacy")))
    }

    func testDevelopmentBaseWithPort() {
        let dev = u("http://192.168.1.20:3000")
        XCTAssertEqual(AppWebLinks.appViewURL(path: "/legal/terms", base: dev).absoluteString,
                       "http://192.168.1.20:3000/legal/terms?view=app")
        XCTAssertTrue(AppWebLinks.isLegalPage(u("http://192.168.1.20:3000/legal/terms"), base: dev))
    }

    // MARK: - Rewrite loop guard

    func testRewriteGuardRewritesOncePerChainThenAllows() {
        var guardState = AppViewRewriteGuard()
        let inApp = u("https://yardstore.space/legal/terms?view=app")
        XCTAssertTrue(guardState.shouldRewrite(to: inApp))
        // Server redirect dropped view=app, route() asks for the same rewrite again: allow instead.
        XCTAssertFalse(guardState.shouldRewrite(to: inApp))
        XCTAssertFalse(guardState.shouldRewrite(to: inApp))
    }

    func testRewriteGuardTracksTargetsIndependently() {
        var guardState = AppViewRewriteGuard()
        XCTAssertTrue(guardState.shouldRewrite(to: u("https://yardstore.space/legal/terms?view=app")))
        XCTAssertTrue(guardState.shouldRewrite(to: u("https://yardstore.space/legal/privacy?view=app")))
    }

    func testRewriteGuardResetStartsANewChain() {
        var guardState = AppViewRewriteGuard()
        let inApp = u("https://yardstore.space/legal/refunds?view=app")
        XCTAssertTrue(guardState.shouldRewrite(to: inApp))
        guardState.reset()
        XCTAssertTrue(guardState.shouldRewrite(to: inApp))
    }
}
