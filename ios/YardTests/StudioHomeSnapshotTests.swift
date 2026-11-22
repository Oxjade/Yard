import XCTest
import SwiftUI
@testable import Yard

/// Renders Studio Home (the wallet look) with fixtures to PNGs: a selling shop, the loading state and
/// a brand-new shop in review, each in dark and light, with the tab bar on top. CI publishes the frames
/// (`TEST_RUNNER_SNAPSHOT_DIR`); locally they go to the temporary directory. Also checks the copy rules.
@MainActor
final class StudioHomeSnapshotTests: XCTestCase {
    private func outputDirectory() throws -> URL {
        let raw = ProcessInfo.processInfo.environment["SNAPSHOT_DIR"] ?? ""
        let dir = raw.isEmpty
            ? FileManager.default.temporaryDirectory.appendingPathComponent("yard-studio-home", isDirectory: true)
            : URL(fileURLWithPath: raw, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func dashboard(newShop: Bool) throws -> StudioDashboard {
        let shape = [3, 5, 4, 6, 9, 5, 7]
        let points = (0..<7).map { i -> String in
            let net = newShop ? 0 : shape[i] * 1_500_000
            return #"{ "date": "2026-11-\#(15 + i)", "orders": \#(net / 3_000_000), "grossMinor": \#(net), "netMinor": \#(net) }"#
        }.joined(separator: ",")
        let json: String
        if newShop {
            json = """
            { "brand": { "id": "b_new", "handle": "ember-goods", "name": "Ember Goods", "currency": "NGN", "timeZone": "Africa/Lagos" },
              "sales": { "today": { "orders": 0, "grossMinor": 0, "refundedMinor": 0, "netMinor": 0 },
                         "week": { "orders": 0, "grossMinor": 0, "refundedMinor": 0, "netMinor": 0 },
                         "month": { "orders": 0, "grossMinor": 0, "refundedMinor": 0, "netMinor": 0 } },
              "series": { "days": 7, "points": [\(points)] },
              "toShip": { "total": 0, "paid": 0, "processing": 0 },
              "lowStock": { "variants": 0, "products": 0, "threshold": 3 },
              "unreadMessages": 0, "websitePieces": 0, "topProducts": [],
              "storeViews": { "today": 0, "week": 6, "month": 6 } }
            """
        } else {
            json = """
            { "brand": { "id": "b_kachi", "handle": "kachi-studio", "name": "Kachi Studio", "currency": "NGN", "timeZone": "Africa/Lagos" },
              "sales": { "today": { "orders": 3, "grossMinor": 4500000, "refundedMinor": 0, "netMinor": 4500000 },
                         "week": { "orders": 14, "grossMinor": 31500000, "refundedMinor": 1500000, "netMinor": 30000000 },
                         "month": { "orders": 52, "grossMinor": 118000000, "refundedMinor": 3000000, "netMinor": 115000000 } },
              "series": { "days": 7, "points": [\(points)] },
              "toShip": { "total": 3, "paid": 2, "processing": 1 },
              "lowStock": { "variants": 2, "products": 1, "threshold": 3 },
              "unreadMessages": 2, "websitePieces": 3,
              "topProducts": [ { "productId": "p_1", "title": "Cedar candle", "currency": "NGN", "units": 9, "revenueMinor": 13500000, "image": null } ],
              "storeViews": { "today": 48, "week": 412, "month": 1630 } }
            """
        }
        return try JSONDecoder().decode(StudioDashboard.self, from: Data(json.utf8))
    }

    private func screen(_ d: StudioDashboard?, name: String, initials: String, status: StudioHomeBrandStatus, suggestions: Int) -> some View {
        ZStack(alignment: .bottom) {
            VStack(spacing: 0) {
                StudioHomeContent(
                    brandName: name, initials: initials, logoURL: nil, status: status,
                    dashboard: d, error: nil, suggestions: suggestions, suggestionsAllNew: true,
                    showsPayouts: true, shareURL: URL(string: "https://yardstore.space/brands/kachi-studio"),
                    range: .constant(.month), dismissedCard: .constant(""),
                    onAction: { _ in }, onRetry: {}, animated: false
                )
                .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            StudioTabBar(selected: .home, badge: { $0 == .orders ? 3 : 0 })
                .padding(.bottom, 20)
        }
        .frame(width: 390, height: 844, alignment: .top)
        .clipped()
        .background(Color.yard.studioCanvas)
    }

    private func write<V: View>(_ view: V, name: String, scheme: ColorScheme, to dir: URL) throws {
        let renderer = ImageRenderer(content: view.environment(\.colorScheme, scheme))
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.uiImage, "nothing rendered for \(name)")
        let png = try XCTUnwrap(image.pngData())
        XCTAssertGreaterThan(png.count, 2_000, "\(name) looks empty")
        try png.write(to: dir.appendingPathComponent("\(name)-\(scheme == .dark ? "dark" : "light").png"))
    }

    func testStudioHomeFrames() throws {
        let dir = try outputDirectory()
        let selling = try dashboard(newShop: false)
        let fresh = try dashboard(newShop: true)
        for scheme in [ColorScheme.dark, .light] {
            try write(screen(selling, name: "Kachi Studio", initials: "KS", status: .live, suggestions: 5), name: "studio-home", scheme: scheme, to: dir)
            try write(screen(nil, name: "Kachi Studio", initials: "KS", status: .live, suggestions: 0), name: "studio-home-loading", scheme: scheme, to: dir)
            try write(screen(fresh, name: "Ember Goods", initials: "EG", status: .inReview, suggestions: 0), name: "studio-home-new", scheme: scheme, to: dir)
        }
    }

    func testHeroCopy() throws {
        let selling = try dashboard(newShop: false)
        let fresh = try dashboard(newShop: true)
        XCTAssertEqual(studioHeroDelta(fresh, range: .month), "No orders past week")
        XCTAssertTrue(studioHeroDelta(selling, range: .month).hasSuffix(" past week"))
        XCTAssertTrue(studioHeroDelta(selling, range: .month).hasPrefix("+"))
        XCTAssertEqual(studioHeroDelta(selling, range: .today), "3 orders")
        XCTAssertEqual(StudioHomeCard.pick(status: .live, dashboard: selling, suggestions: 5, allNew: true, brandName: "Kachi Studio")?.cta, "Accept all")
        XCTAssertEqual(StudioHomeCard.pick(status: .inReview, dashboard: fresh, suggestions: 0, allNew: true, brandName: "Ember Goods")?.id, "review")
        XCTAssertEqual(StudioHomeCard.pick(status: .live, dashboard: fresh, suggestions: 0, allNew: true, brandName: "Ember Goods")?.id, "first-order")
        XCTAssertNil(StudioHomeCard.pick(status: .live, dashboard: selling, suggestions: 0, allNew: true, brandName: "Kachi Studio"))
        XCTAssertEqual(StudioBatchCopy.preparedTitle(1, allNew: true), "Yard prepared 1 product for you")
    }
}
