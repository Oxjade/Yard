import SwiftUI

/// One piece of confetti: where it starts, how it drifts and spins, which Yard colour it is.
struct ConfettiPiece: Sendable {
    let x: CGFloat
    let delay: Double
    let drift: CGFloat
    let fall: CGFloat
    let spin: Double
    let width: CGFloat
    let height: CGFloat
    let colorIndex: Int

    static func make(count: Int) -> [ConfettiPiece] {
        (0..<count).map { _ in
            ConfettiPiece(
                x: CGFloat.random(in: 0...1),
                delay: Double.random(in: 0...0.35),
                drift: CGFloat.random(in: -70...70),
                fall: CGFloat.random(in: 160...300),
                spin: Double.random(in: -9...9),
                width: CGFloat.random(in: 6...11),
                height: CGFloat.random(in: 3...6),
                colorIndex: Int.random(in: 0..<4)
            )
        }
    }
}

/// A one-shot confetti burst falling from the top (celebrations). Decorative, ignores touches.
/// Under Reduce Motion nothing moves: it draws nothing, and the screen's own success mark carries it.
struct ConfettiView: View {
    var count: Int = 90
    var duration: Double = 3.2

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pieces: [ConfettiPiece] = []
    @State private var start: Date = Date()

    var body: some View {
        Group {
            if reduceMotion {
                Color.clear
            } else {
                TimelineView(.animation) { timeline in
                    Canvas { context, size in
                        let t = timeline.date.timeIntervalSince(start)
                        guard t < duration + 0.5 else { return }
                        let colors: [Color] = [Color.yard.acid, Color.yard.studio, Color.yard.onPhoto, Color.yard.violet]
                        for piece in pieces {
                            let local = max(0, t - piece.delay)
                            let x = piece.x * size.width + piece.drift * CGFloat(local)
                            let y = -16 + piece.fall * CGFloat(local) + 0.5 * 260 * CGFloat(local * local)
                            if y > size.height + 20 { continue }
                            let fade = max(0, min(1, (duration - t) / 0.6))
                            var c = context
                            c.opacity = fade
                            c.translateBy(x: x, y: y)
                            c.rotate(by: .radians(piece.spin * local))
                            let rect = CGRect(x: -piece.width / 2, y: -piece.height / 2, width: piece.width, height: piece.height)
                            c.fill(Path(roundedRect: rect, cornerRadius: 1.5), with: .color(colors[piece.colorIndex % colors.count]))
                        }
                    }
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear {
            start = Date()
            if pieces.isEmpty { pieces = ConfettiPiece.make(count: count) }
        }
    }
}
