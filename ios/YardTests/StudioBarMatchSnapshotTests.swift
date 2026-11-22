import XCTest
import SwiftUI
@testable import Yard

/// The shopper tab pill and the Studio tab bar side by side, in dark and light: Studio's bar is the
/// shopper pill with its own tabs. CI publishes the PNGs (`TEST_RUNNER_SNAPSHOT_DIR`).
@MainActor
final class StudioBarMatchSnapshotTests: XCTestCase {
    private func outputDirectory() throws -> URL {
        let raw = ProcessInfo.processInfo.environment["SNAPSHOT_DIR"] ?? ""
        let dir = raw.isEmpty
            ? FileManager.default.temporaryDirectory.appendingPathComponent("yard-bars", isDirectory: true)
            : URL(fileURLWithPath: raw, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    func testShopperAndStudioBarsSideBySide() throws {
        let dir = try outputDirectory()
        let cart = try JSONDecoder().decode(Cart.self, from: Data(#"{ "id": "c_1", "currency": "USD", "itemCount": 3, "lines": [] }"#.utf8))
        for scheme in [ColorScheme.dark, .light] {
            let view = HStack(spacing: 20) {
                TabPill()
                    .environment(Router())
                    .environment(CartStore.preview(cart: cart))
                    .frame(width: 390, height: 110)
                    .background(Color.yard.bg)
                StudioTabBar(selected: .home, badge: { $0 == .orders ? 3 : 0 })
                    .frame(width: 390, height: 110)
                    .background(Color.yard.bg)
            }
            .padding(10)
            .background(Color.gray)
            .environment(\.colorScheme, scheme)
            let renderer = ImageRenderer(content: view)
            renderer.scale = 2
            let image = try XCTUnwrap(renderer.uiImage)
            let png = try XCTUnwrap(image.pngData())
            XCTAssertGreaterThan(png.count, 2_000)
            try png.write(to: dir.appendingPathComponent("bars-shopper-vs-studio-\(scheme == .dark ? "dark" : "light").png"))
        }
    }
}
