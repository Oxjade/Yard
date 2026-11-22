import XCTest
import SwiftUI
@testable import Yard

/// Renders the animated illustrations at several moments to PNGs (ImageRenderer). CI sets
/// `TEST_RUNNER_SNAPSHOT_DIR`, so the frames land in that folder and are published; locally they
/// go to the temporary directory. Also checks the motion maths settles.
@MainActor
final class IllustrationSnapshotTests: XCTestCase {
    private let times: [Double] = [0.1, 0.35, 0.7, 1.2, 2.0, 3.4]

    private func outputDirectory() throws -> URL {
        let raw = ProcessInfo.processInfo.environment["SNAPSHOT_DIR"] ?? ""
        let dir = raw.isEmpty
            ? FileManager.default.temporaryDirectory.appendingPathComponent("yard-illustrations", isDirectory: true)
            : URL(fileURLWithPath: raw, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func write<V: View>(_ view: V, name: String, to dir: URL) throws {
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        let image = try XCTUnwrap(renderer.uiImage, "nothing rendered for \(name)")
        let png = try XCTUnwrap(image.pngData())
        XCTAssertGreaterThan(png.count, 2_000, "\(name) looks empty")
        try png.write(to: dir.appendingPathComponent("\(name).png"))
    }

    private func label(_ t: Double) -> String { String(format: "%04.0fms", t * 1000) }

    func testRoleCardsFrames() throws {
        let dir = try outputDirectory()
        for t in times + [YardIllustrationArt.restTime] {
            let view = VStack(spacing: 16) {
                RoleChoiceCard(title: "Shop on Yard", message: "Find independent brands, follow them and catch their drops.", cta: "Start shopping",
                               fill: Color.yard.acid, ink: Color.yard.onAcid, art: .shop, illustrationTime: t) {}
                RoleChoiceCard(title: "Sell on Yard", message: "Open your shop in about a minute. Yard reviews every brand.", cta: "Apply to sell",
                               fill: Color.yard.studio, ink: Color.yard.onPhoto, art: .sell, illustrationTime: t) {}
            }
            .padding(16)
            .frame(width: 390, height: 600)
            .background(Color.yard.bg)
            .environment(\.colorScheme, .dark)
            try write(view, name: "role-cards-\(t == YardIllustrationArt.restTime ? "rest" : label(t))", to: dir)
        }
    }

    func testIllustrationFrames() throws {
        let dir = try outputDirectory()
        let cases: [(String, YardIllustration.Kind, Color, ColorScheme)] = [
            ("shop", .shop, Color.yard.acid, .dark),
            ("sell", .sell, Color.yard.studio, .dark),
            ("stamp-dark", .stamp(small: "YOU'RE ON THE", big: "LIST"), Color.yard.bg, .dark),
            ("stamp-light", .stamp(small: "NOW", big: "LIVE"), Color.yard.bg, .light),
        ]
        for (name, kind, background, scheme) in cases {
            for t in times {
                let view = YardIllustration(kind, fixedTime: t)
                    .frame(width: 360, height: 300)
                    .background(background)
                    .environment(\.colorScheme, scheme)
                try write(view, name: "\(name)-\(label(t))", to: dir)
            }
        }
    }

    func testSpringSettles() {
        XCTAssertEqual(YardIllustrationArt.spring(-1), 0)
        XCTAssertEqual(YardIllustrationArt.spring(0), 0)
        XCTAssertGreaterThan(YardIllustrationArt.spring(0.2), 0.5)
        XCTAssertEqual(YardIllustrationArt.spring(YardIllustrationArt.restTime), 1, accuracy: 0.001)
        XCTAssertEqual(YardIllustrationArt.smoothstep(0, 1, 0.5), 0.5, accuracy: 0.0001)
        XCTAssertEqual(YardIllustrationArt.smoothstep(0, 1, 2), 1)
    }
}
