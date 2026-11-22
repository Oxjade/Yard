import XCTest
import SwiftUI
@testable import Yard

/// Renders the bottom bars (ImageRenderer) to PNGs: the shopper bar on Home, Shop, Around and Cart
/// (with a count), and the Studio bar, in dark and light, over a busy backdrop. CI publishes them
/// (`TEST_RUNNER_SNAPSHOT_DIR`). Also checks the tab order and titles match the website.
@MainActor
final class NavBarSnapshotTests: XCTestCase {
    private func outputDirectory() throws -> URL {
        let raw = ProcessInfo.processInfo.environment["SNAPSHOT_DIR"] ?? ""
        let dir = raw.isEmpty
            ? FileManager.default.temporaryDirectory.appendingPathComponent("yard-nav", isDirectory: true)
            : URL(fileURLWithPath: raw, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func cartStore(count: Int) throws -> CartStore {
        let cart = try JSONDecoder().decode(Cart.self, from: Data(#"{ "id": "c_1", "currency": "USD", "itemCount": \#(count), "lines": [] }"#.utf8))
        return CartStore.preview(cart: cart)
    }

    /// A stand-in page under the bar: tiles in the app's neutrals and one photo-ish block.
    private var backdrop: some View {
        VStack(spacing: 8) {
            ForEach(0..<3, id: \.self) { i in
                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 16).fill(i == 1 ? Color.yard.studio.opacity(0.5) : Color.yard.surface)
                    RoundedRectangle(cornerRadius: 16).fill(Color.yard.surface2)
                }
                .frame(height: 70)
            }
        }
        .padding(16)
        .frame(width: 390, height: 260, alignment: .bottom)
        .background(Color.yard.bg)
    }

    private func write<V: View>(_ view: V, name: String, scheme: ColorScheme, to dir: URL) throws {
        let renderer = ImageRenderer(content: view.environment(\.colorScheme, scheme))
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.uiImage, "nothing rendered for \(name)")
        let png = try XCTUnwrap(image.pngData())
        XCTAssertGreaterThan(png.count, 2_000, "\(name) looks empty")
        try png.write(to: dir.appendingPathComponent("\(name)-\(scheme == .dark ? "dark" : "light").png"))
    }

    func testShopperAndStudioBars() throws {
        let dir = try outputDirectory()
        for scheme in [ColorScheme.dark, .light] {
            for (name, tab) in [("nav-bar-home", AppTab.home), ("nav-bar-shop", .search), ("nav-bar-around", .around), ("nav-bar-cart", .bag)] {
                let router = Router()
                router.select(tab)
                let view = backdrop
                    .overlay(alignment: .bottom) { TabPill().padding(.bottom, 16) }
                    .environment(router)
                    .environment(try cartStore(count: 3))
                try write(view, name: name, scheme: scheme, to: dir)
            }
            let studio = backdrop.overlay(alignment: .bottom) {
                StudioTabBar(selected: .home, badge: { $0 == .orders ? 3 : 0 }).padding(.bottom, 16)
            }
            try write(studio, name: "nav-bar-studio", scheme: scheme, to: dir)
        }
    }

    func testTabsMatchTheWebsite() {
        XCTAssertEqual(AppTab.allCases.map(\.title), ["Home", "Shop", "Around", "Cart", "Me"])
        let router = Router()
        XCTAssertTrue(router.open(URL(string: "https://yardstore.space/around")!))
        XCTAssertEqual(router.selectedTab, .around)
        XCTAssertTrue(router.open(URL(string: "https://yardstore.space/shop")!))
        XCTAssertEqual(router.selectedTab, .search)
        XCTAssertTrue(router.open(URL(string: "https://yardstore.space/bag")!))
        XCTAssertEqual(router.selectedTab, .bag)
        XCTAssertTrue(router.open(URL(string: "https://yardstore.space/search?q=tee")!))
        XCTAssertEqual(router.depth, 1)
    }
}
