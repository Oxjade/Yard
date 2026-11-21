import XCTest
@testable import Yard

// Studio in the app (docs/APP.md › Studio in the app): session brands, mode choice, the brand
// session switch and its 401 retry, the short application, the dashboard, deep links and the
// slide-to-confirm threshold.

private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
    try JSONDecoder().decode(T.self, from: Data(json.utf8))
}

// MARK: - Session brands

final class StudioSessionBrandsTests: XCTestCase {
    func testDecodesShopperBrands() throws {
        let json = """
        { "shopper": { "id": "u_1", "name": "Ada Nwosu", "email": "ada@example.com", "status": "active", "demo": false, "photoSrc": null,
            "brands": [
              { "id": "b_1", "handle": "kachi-studio", "name": "Kachi Studio", "logoSrc": "/api/media/med_1?as=brand", "initials": "KS",
                "role": "owner", "status": "pending_review", "canOpenStudio": true },
              { "id": "b_2", "handle": "lagos-thread", "name": "Lagos Thread", "logoSrc": null, "initials": "LT",
                "role": "finance", "status": "suspended", "canOpenStudio": false }
            ] },
          "brand": null, "admin": null, "sampleData": false }
        """
        let session = try decode(Session.self, json)
        let brands = try XCTUnwrap(session.shopper?.brands)
        XCTAssertEqual(brands.count, 2)
        XCTAssertEqual(brands[0].id, "b_1")
        XCTAssertEqual(brands[0].handle, "kachi-studio")
        XCTAssertEqual(brands[0].initials, "KS")
        XCTAssertEqual(brands[0].role, "owner")
        XCTAssertTrue(brands[0].isPending)
        XCTAssertTrue(brands[0].isPrivateLogo)
        XCTAssertTrue(brands[0].canOpenStudio)
        XCTAssertTrue(brands[0].canSeePayouts)
        XCTAssertNil(brands[1].logoSrc)
        XCTAssertFalse(brands[1].canOpenStudio)
        XCTAssertTrue(brands[1].canSeePayouts)
        XCTAssertEqual(session.shopper?.studioBrands.map(\.id), ["b_1"])
    }

    func testMissingBrandsIsEmptyAndBadRowsAreSkipped() throws {
        let none = try decode(Session.self, #"{ "shopper": { "id": "u_1", "name": "Ada", "email": "a@b.c" }, "sampleData": false }"#)
        XCTAssertEqual(none.shopper?.brands, [])

        let odd = try decode(Session.self, """
        { "shopper": { "id": "u_1", "name": "Ada", "email": "a@b.c",
          "brands": [ { "name": "no id" }, { "id": "b_3", "handle": "x", "name": "Xo", "status": "claimed" } ] } }
        """)
        let brands = try XCTUnwrap(odd.shopper?.brands)
        XCTAssertEqual(brands.map(\.id), ["b_3"])
        XCTAssertTrue(brands[0].isApproved, "claimed is treated as approved")
        XCTAssertTrue(brands[0].canOpenStudio, "a missing canOpenStudio follows the status")
        XCTAssertEqual(brands[0].initials, "X")
    }

    func testSwitchResultDecodesPermissions() throws {
        let result = try decode(StudioSwitchResult.self, """
        { "actor": "brand", "profile": { "userId": "u_1", "name": "Ada", "brand": { "id": "b_1", "handle": "k", "name": "K", "reviewStatus": "verified", "logoSrc": null },
          "role": "fulfilment", "permissions": ["orders.fulfil", "inbox.read"], "demo": false, "photoSrc": null } }
        """)
        let profile = try XCTUnwrap(result.profile)
        XCTAssertTrue(profile.can(StudioPermission.ordersFulfil))
        XCTAssertFalse(profile.can(StudioPermission.contentPublish))
        XCTAssertEqual(profile.brand.id, "b_1")
    }
}

// MARK: - Mode choice

@MainActor
final class StudioModeChoiceTests: XCTestCase {
    private let approved = ShopperBrand(id: "b_1", handle: "a", name: "A", status: "approved")
    private let second = ShopperBrand(id: "b_2", handle: "b", name: "B", status: "approved")
    private let suspended = ShopperBrand(id: "b_9", handle: "s", name: "S", status: "suspended", canOpenStudio: false)

    func testInitialMode() {
        XCTAssertEqual(StudioModeChoice.initialMode(brands: [], remembered: nil), .shopping)
        XCTAssertEqual(StudioModeChoice.initialMode(brands: [suspended], remembered: .studio), .shopping)
        XCTAssertEqual(StudioModeChoice.initialMode(brands: [approved], remembered: nil), .studio, "default into Studio after sign-in")
        XCTAssertEqual(StudioModeChoice.initialMode(brands: [approved], remembered: .shopping), .shopping, "remember the last mode")
        XCTAssertEqual(StudioModeChoice.initialMode(brands: [approved], remembered: .studio), .studio)
    }

    func testBrandPick() {
        XCTAssertEqual(StudioModeChoice.brand(in: [approved, second], remembered: "b_2")?.id, "b_2")
        XCTAssertEqual(StudioModeChoice.brand(in: [approved, second], remembered: "gone")?.id, "b_1")
        XCTAssertEqual(StudioModeChoice.brand(in: [suspended, second], remembered: "b_9")?.id, "b_2")
        XCTAssertNil(StudioModeChoice.brand(in: [suspended], remembered: nil))
    }

    func testRoleChoiceShowsOnlyForUndecidedAccountsWithoutBrands() {
        XCTAssertTrue(StudioModeChoice.needsRoleChoice(brands: [], recorded: nil, demo: false))
        XCTAssertFalse(StudioModeChoice.needsRoleChoice(brands: [], recorded: .shop, demo: false))
        XCTAssertFalse(StudioModeChoice.needsRoleChoice(brands: [approved], recorded: nil, demo: false))
        XCTAssertFalse(StudioModeChoice.needsRoleChoice(brands: [], recorded: nil, demo: true))
    }

    private func freshStore() -> (StudioStore, UserDefaults) {
        let name = "studio.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        let gate = StudioSessionGate(switcher: { _ in StudioSwitchResult(profile: nil) })
        return (StudioStore(gate: gate, preferences: StudioPreferences(defaults: defaults)), defaults)
    }

    func testStoreDefaultsIntoStudioAndRemembersTheLastMode() {
        let (store, defaults) = freshStore()
        let shopper = Shopper(id: "u_1", name: "Ada", email: "a@b.c", brands: [approved, second])
        store.sync(shopper: shopper)
        XCTAssertTrue(store.isInStudio)
        XCTAssertEqual(store.activeBrandId, "b_1")

        store.enterShopping()
        XCTAssertFalse(store.isInStudio)

        // A new launch with the same account: shopping is remembered.
        let again = StudioStore(gate: StudioSessionGate(switcher: { _ in StudioSwitchResult(profile: nil) }), preferences: StudioPreferences(defaults: defaults))
        again.sync(shopper: shopper)
        XCTAssertFalse(again.isInStudio)

        again.enterStudio(brandId: "b_2")
        let third = StudioStore(gate: StudioSessionGate(switcher: { _ in StudioSwitchResult(profile: nil) }), preferences: StudioPreferences(defaults: defaults))
        third.sync(shopper: shopper)
        XCTAssertTrue(third.isInStudio)
        XCTAssertEqual(third.activeBrandId, "b_2", "the last brand is remembered")
    }

    func testSignOutLeavesStudio() {
        let (store, _) = freshStore()
        store.sync(shopper: Shopper(id: "u_1", name: "Ada", email: "a@b.c", brands: [approved]))
        XCTAssertTrue(store.isInStudio)
        store.sync(shopper: nil)
        XCTAssertFalse(store.isInStudio)
        XCTAssertNil(store.activeBrandId)
    }

    func testRoleChoiceIsRecordedPerAccount() {
        let (store, _) = freshStore()
        store.sync(shopper: Shopper(id: "u_new", name: "New", email: "n@b.c"))
        XCTAssertTrue(store.needsRoleChoice)
        store.recordRole(.shop)
        XCTAssertFalse(store.needsRoleChoice)
        XCTAssertFalse(store.isInStudio)
    }
}

// MARK: - Switch and retry

@MainActor
final class StudioSessionGateTests: XCTestCase {
    private final class Counter {
        var switches: [String] = []
        var calls = 0
    }

    private let unauthorized = APIError(status: 401, code: "unauthenticated", message: "Sign in.")

    func testSwitchesOnceBeforeStudioCalls() async throws {
        let counter = Counter()
        let gate = StudioSessionGate(switcher: { id in counter.switches.append(id); return StudioSwitchResult(profile: nil) })
        let a = try await gate.run("b_1") { () async throws -> Int in counter.calls += 1; return 1 }
        let b = try await gate.run("b_1") { () async throws -> Int in counter.calls += 1; return 2 }
        XCTAssertEqual(a + b, 3)
        XCTAssertEqual(counter.switches, ["b_1"], "an open brand session isn't switched again")
        XCTAssertEqual(counter.calls, 2)

        _ = try await gate.run("b_2") { () async throws -> Int in 0 }
        XCTAssertEqual(counter.switches, ["b_1", "b_2"], "another brand switches")
    }

    func testReSwitchesOnceOn401ThenRetries() async throws {
        let counter = Counter()
        let gate = StudioSessionGate(switcher: { id in counter.switches.append(id); return StudioSwitchResult(profile: nil) })
        let unauthorized = self.unauthorized
        let value = try await gate.run("b_1") { () async throws -> String in
            counter.calls += 1
            if counter.calls == 1 { throw unauthorized }
            return "ok"
        }
        XCTAssertEqual(value, "ok")
        XCTAssertEqual(counter.calls, 2)
        XCTAssertEqual(counter.switches, ["b_1", "b_1"])
    }

    func testRetriesOnlyOnce() async {
        let counter = Counter()
        let gate = StudioSessionGate(switcher: { id in counter.switches.append(id); return StudioSwitchResult(profile: nil) })
        let unauthorized = self.unauthorized
        do {
            _ = try await gate.run("b_1") { () async throws -> Int in
                counter.calls += 1
                throw unauthorized
            }
            XCTFail("expected a 401")
        } catch let error as APIError {
            XCTAssertEqual(error.status, 401)
        } catch {
            XCTFail("unexpected \(error)")
        }
        XCTAssertEqual(counter.calls, 2)
        XCTAssertEqual(counter.switches.count, 2)
    }

    func testSwitch401MeansSignedOut() async {
        let unauthorized = self.unauthorized
        let gate = StudioSessionGate(switcher: { _ in throw unauthorized })
        do {
            _ = try await gate.run("b_1") { () async throws -> Int in 1 }
            XCTFail("expected signed out")
        } catch let error as APIError {
            XCTAssertEqual(error.code, StudioSessionGate.signedOut.code)
        } catch {
            XCTFail("unexpected \(error)")
        }
        XCTAssertNil(gate.openedBrandId)
    }

    func testOtherErrorsAreNotRetried() async {
        let counter = Counter()
        let gate = StudioSessionGate(switcher: { id in counter.switches.append(id); return StudioSwitchResult(profile: nil) })
        let forbidden = APIError(status: 403, code: "forbidden", message: "No.")
        do {
            _ = try await gate.run("b_1") { () async throws -> Int in
                counter.calls += 1
                throw forbidden
            }
        } catch {}
        XCTAssertEqual(counter.calls, 1)
        XCTAssertEqual(counter.switches.count, 1)
    }

    func testStoreAsksForSignInWhenTheShopperSessionIsGone() async {
        let unauthorized = self.unauthorized
        let name = "studio.tests.\(UUID().uuidString)"
        let store = StudioStore(gate: StudioSessionGate(switcher: { _ in throw unauthorized }), preferences: StudioPreferences(defaults: UserDefaults(suiteName: name)!))
        store.sync(shopper: Shopper(id: "u_1", name: "Ada", email: "a@b.c", brands: [ShopperBrand(id: "b_1", handle: "a", name: "A")]))
        _ = try? await store.call { () async throws -> Int in 1 }
        XCTAssertTrue(store.needsSignIn)
    }

    func testReauthRequestParsing() {
        let error = APIError(status: 403, code: "forbidden", message: "Confirm.", fields: ["reauth": "required", "reauthWith": "auth0:google-oauth2"])
        let request = StudioReauthRequest(error)
        XCTAssertNotNil(request)
        XCTAssertFalse(request?.usesPassword ?? true)
        XCTAssertEqual(request?.provider?.name, "auth0")
        XCTAssertEqual(request?.provider?.connection, "google-oauth2")
        XCTAssertEqual(request?.providerLabel, "Google")

        let password = StudioReauthRequest(APIError(status: 403, code: "forbidden", message: "", fields: ["reauth": "required", "reauthWith": "password"]))
        XCTAssertTrue(password?.usesPassword ?? false)
        XCTAssertNil(password?.provider)

        XCTAssertNil(StudioReauthRequest(APIError(status: 403, code: "forbidden", message: "")))
    }

    func testPKCEShapes() {
        let verifier = StudioPKCE.makeVerifier()
        let challenge = StudioPKCE.challenge(for: verifier)
        XCTAssertEqual(verifier.count, 43)
        XCTAssertEqual(challenge.count, 43)
        XCTAssertNil(challenge.range(of: "[^A-Za-z0-9_-]", options: .regularExpression))
        // RFC 7636 appendix B.
        XCTAssertEqual(StudioPKCE.challenge(for: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }
}

// MARK: - Application

final class SellerApplicationFormTests: XCTestCase {
    func testInstagramHandles() {
        XCTAssertEqual(SellerApplicationForm.instagramHandle("@kachi.studio"), "kachi.studio")
        XCTAssertEqual(SellerApplicationForm.instagramHandle("kachi_studio"), "kachi_studio")
        XCTAssertEqual(SellerApplicationForm.instagramHandle("https://www.instagram.com/kachi/?hl=en"), "kachi")
        XCTAssertEqual(SellerApplicationForm.instagramHandle("instagram.com/kachi"), "kachi")
        XCTAssertNil(SellerApplicationForm.instagramHandle("kachi studio"))
        XCTAssertNil(SellerApplicationForm.instagramHandle("@"))
        XCTAssertNil(SellerApplicationForm.instagramHandle(String(repeating: "a", count: 31)))
    }

    func testWebsites() {
        XCTAssertTrue(SellerApplicationForm.isWebsite("yourshop.com"))
        XCTAssertTrue(SellerApplicationForm.isWebsite("https://kachi.studio/shop"))
        XCTAssertFalse(SellerApplicationForm.isWebsite("kachi"))
        XCTAssertFalse(SellerApplicationForm.isWebsite("kachi.c"))
        XCTAssertFalse(SellerApplicationForm.isWebsite("my shop.com"))
        XCTAssertFalse(SellerApplicationForm.isWebsite(".com"))
    }

    func testStepsAndBody() throws {
        var form = SellerApplicationForm(regionCode: "gh")
        XCTAssertEqual(form.country, "GH", "the phone's region when Yard sells there")
        XCTAssertEqual(SellerApplicationForm(regionCode: "BR").country, "NG")

        XCTAssertEqual(form.problem(at: .name), "Enter your shop's name.")
        form.brandName = "  Kachi Studio "
        XCTAssertNil(form.problem(at: .name))

        XCTAssertEqual(form.problem(at: .link), "Add your Instagram or your website, so Yard can see what you sell.")
        form.instagram = "kachi studio"
        XCTAssertEqual(form.problem(at: .link), "Enter an Instagram handle like @yourshop.")
        form.instagram = "@kachi"
        XCTAssertNil(form.problem(at: .link))

        XCTAssertEqual(form.problem(at: .category), "Choose one of Yard's categories.")
        form.category = "home"
        XCTAssertNil(form.problem(at: .category))

        XCTAssertEqual(form.problem(at: .location), "Enter your city.")
        form.city = "Accra"
        XCTAssertNil(form.problem(at: .location))
        XCTAssertNil(form.firstInvalidStep)

        let body = try XCTUnwrap(form.body())
        XCTAssertEqual(body.brandName, "Kachi Studio")
        XCTAssertNil(body.website)
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: JSONEncoder().encode(body)) as? [String: Any])
        XCTAssertEqual(Set(json.keys), ["brandName", "instagram", "category", "city", "country"], "unset optionals are left out (the server is strict)")
    }

    func testFieldErrorsMapToSteps() {
        XCTAssertEqual(SellerApplicationForm.step(forField: "brandName"), .name)
        XCTAssertEqual(SellerApplicationForm.step(forField: "website"), .link)
        XCTAssertEqual(SellerApplicationForm.step(forField: "category"), .category)
        XCTAssertEqual(SellerApplicationForm.step(forField: "country"), .location)
    }

    func testHandlePreview() {
        XCTAssertEqual(SellerApplicationForm.handlePreview("Kachi Studio"), "kachi-studio")
        XCTAssertEqual(SellerApplicationForm.handlePreview("  Ọ̀ & Co. "), "co")
        XCTAssertEqual(SellerApplicationForm.handlePreview(""), "your-shop")
    }

    func testApplicationDecoding() throws {
        let result = try decode(StudioApplyResult.self, """
        { "application": { "id": "onb_1", "status": "submitted", "source": "app", "brand": { "id": "b_1", "handle": "kachi", "name": "Kachi" },
            "submittedAt": "2026-11-20T10:00:00.000Z", "reviewedAt": null, "reviewNote": null },
          "websiteScan": { "status": "started", "importId": "imp_1" } }
        """)
        XCTAssertTrue(result.application.isWaiting)
        XCTAssertEqual(result.application.brand?.name, "Kachi")
        XCTAssertEqual(result.websiteScan?.status, "started")

        let none = try decode(StudioApplicationEnvelope.self, #"{ "application": null }"#)
        XCTAssertNil(none.application)
    }
}

// MARK: - Dashboard

final class StudioDashboardTests: XCTestCase {
    func testDecodesTheDashboard() throws {
        let json = """
        { "brand": { "id": "b_1", "handle": "kachi", "name": "Kachi", "currency": "NGN", "timeZone": "Africa/Lagos" },
          "sales": { "today": { "orders": 1, "grossMinor": 300000, "refundedMinor": 0, "netMinor": 300000 },
                     "week": { "orders": 3, "grossMinor": 900000, "refundedMinor": 100000, "netMinor": 800000 },
                     "month": { "orders": 9, "grossMinor": 2700000, "refundedMinor": 100000, "netMinor": 2600000 } },
          "series": { "days": 7, "points": [
            { "date": "2026-11-15", "orders": 1, "grossMinor": 300000, "netMinor": 300000 },
            { "date": "2026-11-16", "orders": 0, "grossMinor": 0, "netMinor": 0 } ] },
          "toShip": { "total": 3, "paid": 2, "processing": 1 },
          "lowStock": { "variants": 2, "products": 1, "threshold": 3 },
          "unreadMessages": null,
          "websitePieces": 5,
          "topProducts": [ { "productId": "p_1", "title": "Candle", "currency": "NGN", "units": 4, "revenueMinor": 1200000, "image": { "src": "/api/media/med_1?as=brand", "alt": "" } },
                           { "productId": "p_2", "title": "Soap", "currency": "NGN", "units": 1, "revenueMinor": 5000, "image": null } ],
          "storeViews": { "today": 12, "week": 80, "month": 310 } }
        """
        let d = try decode(StudioDashboard.self, json)
        XCTAssertEqual(d.brand.currency, "NGN")
        XCTAssertEqual(d.sales.week.netMinor, 800000)
        XCTAssertEqual(d.sales.month.orders, 9)
        XCTAssertEqual(d.series.points.count, 2)
        XCTAssertNotNil(d.series.points[0].day)
        XCTAssertEqual(d.toShip.total, 3)
        XCTAssertEqual(d.lowStock.threshold, 3)
        XCTAssertNil(d.unreadMessages, "null when the role can't read the inbox")
        XCTAssertEqual(d.websitePieces, 5)
        XCTAssertEqual(d.topProducts.map(\.productId), ["p_1", "p_2"])
        XCTAssertEqual(d.topProducts[0].imageSrc, "/api/media/med_1?as=brand")
        XCTAssertNil(d.topProducts[1].imageSrc)
        XCTAssertEqual(d.storeViews.month, 310)
    }

    func testOrderDetailDecodesSummaryAndLines() throws {
        let json = """
        { "order": { "id": "mo_1", "reference": "YRD-ABC123-1", "groupReference": "YRD-ABC123", "checkoutId": null,
          "brand": { "id": "b_1", "name": "Kachi", "handle": "kachi" }, "customerName": "Ada",
          "shipToPreview": { "city": "Lagos", "country": "NG" }, "placedAt": "2026-11-20T10:00:00.000Z", "currency": "NGN",
          "subtotalMinor": 450000, "shippingMinor": 0, "totalMinor": 450000, "refundedMinor": 0, "itemCount": 2,
          "previewItems": [ { "productId": "p_1", "variantId": "v_1", "name": "Candle", "qty": 2, "unitMinor": 225000 } ],
          "states": { "merchant": "paid", "payment": "paid", "fulfilment": "unfulfilled", "return": "none", "dispute": "none" }, "service": "standard",
          "lines": [ { "id": "ol_1", "variantId": "v_1", "productId": "p_1", "title": "Candle", "qty": 2, "unitMinor": 225000, "returnedQty": 0, "restockedQty": 0,
                       "variantLabel": "Large", "image": { "src": "/api/media/med_1", "alt": "", "width": 100, "height": 100 } } ],
          "shipTo": { "name": "Ada N", "line1": "1 Marina", "city": "Lagos", "country": "NG", "phone": "+234 800" },
          "paidAt": "2026-11-20T10:00:00.000Z", "cancelledAt": null, "cancelReason": null, "deliveredAt": null, "completedAt": null,
          "refundableMinor": 450000, "returns": [], "refunds": [], "disputes": [], "timeline": [],
          "actions": { "canCancel": true, "canRequestReturn": false, "returnWindowEndsAt": null }, "delivery": null } }
        """
        let order = try decode(StudioOrderEnvelope.self, json).order
        XCTAssertEqual(order.summary.reference, "YRD-ABC123-1")
        XCTAssertEqual(order.summary.merchantState, "paid")
        XCTAssertEqual(order.summary.returnState, "none")
        XCTAssertEqual(order.lines.first?.variantLabel, "Large")
        XCTAssertEqual(order.shipTo?.lines, ["1 Marina", "Lagos", "NG"])
        XCTAssertTrue(order.canCancel)
        XCTAssertEqual(StudioOrderState.progressIndex(order.summary.merchantState), 0)
        XCTAssertNil(StudioOrderState.progressIndex("cancelled"))
    }
}

// MARK: - Deep links

@MainActor
final class StudioDeepLinkTests: XCTestCase {
    private func link(_ s: String) -> StudioLink? { StudioLink(url: URL(string: s)!) }

    func testParsesAppLinks() {
        XCTAssertEqual(link("yard://studio"), .home)
        XCTAssertEqual(link("yard://studio/orders"), .orders)
        XCTAssertEqual(link("yard://studio/orders/mo_1"), .order("mo_1"))
        XCTAssertEqual(link("yard://studio/inbox"), .inbox)
        XCTAssertEqual(link("yard://studio/inbox/cv_1"), .conversation("cv_1"))
        XCTAssertEqual(link("yard://studio/support"), .support)
        XCTAssertEqual(link("yard://studio/products"), .products)
        XCTAssertEqual(link("yard://studio/products/p_1"), .product("p_1"))
        XCTAssertEqual(link("yard://studio/payouts"), .payouts)
        XCTAssertNil(link("yard://brands/acme"))
    }

    func testParsesWebPaths() {
        XCTAssertEqual(StudioLink(path: "/studio/orders/mo_1"), .order("mo_1"))
        XCTAssertEqual(StudioLink(path: "/studio/inbox?thread=cv_9"), .conversation("cv_9"))
        XCTAssertEqual(link("https://yardstore.space/studio/payouts"), .payouts)
        XCTAssertNil(StudioLink(path: "/you/orders/mo_1"))
    }

    func testRoutesToTabsAndScreens() {
        XCTAssertEqual(StudioLink.order("mo_1").tab, .orders)
        XCTAssertEqual(StudioLink.order("mo_1").routes, [.order(id: "mo_1")])
        XCTAssertEqual(StudioLink.conversation("cv_1").tab, .me)
        XCTAssertEqual(StudioLink.conversation("cv_1").routes, [.inbox, .thread(.conversation("cv_1"))])
        XCTAssertEqual(StudioLink.support.routes, [.thread(.support)])
        XCTAssertEqual(StudioLink.product("p_1").tab, .products)
        XCTAssertEqual(StudioLink.payouts.routes, [.payouts])
        XCTAssertEqual(StudioLink.home.routes, [])
    }

    func testStoreOpensLinkSwitchingModeAndBrand() {
        let name = "studio.tests.\(UUID().uuidString)"
        let store = StudioStore(gate: StudioSessionGate(switcher: { _ in StudioSwitchResult(profile: nil) }), preferences: StudioPreferences(defaults: UserDefaults(suiteName: name)!))
        let brands = [ShopperBrand(id: "b_1", handle: "a", name: "A"), ShopperBrand(id: "b_2", handle: "b", name: "B")]
        store.sync(shopper: Shopper(id: "u_1", name: "Ada", email: "a@b.c", brands: brands))
        store.enterShopping()
        XCTAssertFalse(store.isInStudio)

        XCTAssertTrue(store.open(.order("mo_1"), brandId: "b_2"))
        XCTAssertTrue(store.isInStudio, "a Studio link switches into Studio")
        XCTAssertEqual(store.activeBrandId, "b_2", "push data.brandId switches brand first")
        XCTAssertEqual(store.selectedTab, .orders)
        XCTAssertEqual(store.ordersPath, [.order(id: "mo_1")])

        XCTAssertTrue(store.open(.conversation("cv_1")))
        XCTAssertEqual(store.selectedTab, .me)
        XCTAssertEqual(store.mePath, [.inbox, .thread(.conversation("cv_1"))])
    }

    func testNoStudioNoLink() {
        let name = "studio.tests.\(UUID().uuidString)"
        let store = StudioStore(gate: StudioSessionGate(switcher: { _ in StudioSwitchResult(profile: nil) }), preferences: StudioPreferences(defaults: UserDefaults(suiteName: name)!))
        store.sync(shopper: Shopper(id: "u_1", name: "Ada", email: "a@b.c"))
        XCTAssertFalse(store.open(.home))
        XCTAssertFalse(store.isInStudio)
    }
}

// MARK: - Slide to confirm

final class SlideToConfirmTests: XCTestCase {
    func testThreshold() {
        let travel = SlideToConfirmMath.travel(trackWidth: 340, knob: 56, padding: 4)
        XCTAssertEqual(travel, 276)
        XCTAssertFalse(SlideToConfirmMath.isComplete(SlideToConfirmMath.progress(offset: travel * 0.5, travel: travel)))
        XCTAssertFalse(SlideToConfirmMath.isComplete(SlideToConfirmMath.progress(offset: travel * 0.84, travel: travel)))
        XCTAssertTrue(SlideToConfirmMath.isComplete(SlideToConfirmMath.progress(offset: travel * 0.86, travel: travel)))
        XCTAssertTrue(SlideToConfirmMath.isComplete(SlideToConfirmMath.progress(offset: travel * 2, travel: travel)))
    }

    func testProgressClampsAndTicksRise() {
        XCTAssertEqual(SlideToConfirmMath.progress(offset: -20, travel: 100), 0)
        XCTAssertEqual(SlideToConfirmMath.progress(offset: 150, travel: 100), 1)
        XCTAssertEqual(SlideToConfirmMath.progress(offset: 10, travel: 0), 0)
        XCTAssertEqual(SlideToConfirmMath.tick(0), 0)
        XCTAssertEqual(SlideToConfirmMath.tick(0.55), 5)
        XCTAssertEqual(SlideToConfirmMath.tick(1), SlideToConfirmMath.tickCount)
        XCTAssertEqual(SlideToConfirmMath.travel(trackWidth: 40, knob: 56, padding: 4), 0)
    }
}

// MARK: - Quick add and money

final class StudioQuickAddTests: XCTestCase {
    func testMinorUnits() {
        XCTAssertEqual(StudioMoney.minor(from: "45,000", currency: "NGN"), 4_500_000)
        XCTAssertEqual(StudioMoney.minor(from: "12.5", currency: "USD"), 1250)
        XCTAssertEqual(StudioMoney.minor(from: "12,50", currency: "EUR"), 1250)
        XCTAssertEqual(StudioMoney.minor(from: "3000", currency: "JPY"), 3000)
        XCTAssertNil(StudioMoney.minor(from: "", currency: "USD"))
    }

    func testVariantsAndBody() {
        let size = QuickAddOption(name: "Size", values: ["M", "L"])
        let scent = QuickAddOption(name: "Scent", values: ["Oud"])
        let combos = QuickAddBuilder.combinations([size, scent])
        XCTAssertEqual(combos.count, 2)
        let key = QuickAddBuilder.key(combos[0], order: [size, scent])
        XCTAssertEqual(key, "M / Oud")

        let body = QuickAddBuilder.body(title: "Kachi Candle", categorySlug: "home", priceMinor: 4_500_000, options: [size, scent], stock: [key: 3], singleStock: 0, mediaIds: ["med_1"], handle: "kachi")
        XCTAssertEqual(body.options.map(\.name), ["Size", "Scent"])
        XCTAssertEqual(body.variants.count, 2)
        XCTAssertEqual(body.variants[0].sku, "KACHI-KACHI-CANDLE-M-OUD")
        XCTAssertEqual(body.variants[0].initialStock, 3)
        XCTAssertEqual(body.variants[1].initialStock, 0)
        XCTAssertEqual(Set(body.variants.map(\.sku)).count, 2, "SKUs are unique")
        XCTAssertEqual(body.images.first?.mediaId, "med_1")

        let plain = QuickAddBuilder.body(title: "Print", categorySlug: "art", priceMinor: 1000, options: [], stock: [:], singleStock: 5, mediaIds: [], handle: "kachi")
        XCTAssertEqual(plain.options.count, 0)
        XCTAssertEqual(plain.variants.count, 1)
        XCTAssertEqual(plain.variants[0].options, [:])
        XCTAssertEqual(plain.variants[0].initialStock, 5)
    }
}
