import SwiftUI

/// Yard's animated illustrations, drawn in a `Canvas` (no images):
/// - `.shop`: product cards fanning out behind a shopping bag with a price tag swinging on a
///   string, twinkling sparkles, a slow float.
/// - `.sell`: a storefront whose awning ripples, an OPEN sign that flips, a parcel that pops out
///   of the door with a bounce, and a rising sparkline with a glow.
/// - `.stamp(small:big:)`: a parcel and a stamp that slams on ("YOU'RE ON THE" / "LIST").
///
/// Every frame is a pure function of time (`YardIllustrationArt.draw`), so it can be rendered at a
/// fixed time for snapshots. Live: a staggered spring entrance, then a low-amplitude idle loop
/// that runs only while the view is on screen. Reduce Motion draws the final pose, still.
struct YardIllustration: View {
    enum Kind: Sendable, Equatable {
        case shop
        case sell
        case stamp(small: String, big: String)
    }

    let kind: Kind
    /// Draw this moment instead of animating (snapshots, previews).
    var fixedTime: Double? = nil

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var start = Date()
    @State private var visible = false

    init(_ kind: Kind, fixedTime: Double? = nil) {
        self.kind = kind
        self.fixedTime = fixedTime
    }

    var body: some View {
        Group {
            if let fixedTime {
                canvas(t: fixedTime, idle: 1)
            } else if reduceMotion {
                canvas(t: YardIllustrationArt.restTime, idle: 0)
            } else {
                TimelineView(.animation(minimumInterval: nil, paused: !visible)) { timeline in
                    canvas(t: max(0, timeline.date.timeIntervalSince(start)), idle: 1)
                }
                .onAppear {
                    start = Date()
                    visible = true
                }
                .onDisappear { visible = false }
            }
        }
        .accessibilityHidden(true)
    }

    private func canvas(t: Double, idle: Double) -> some View {
        let kind = self.kind
        return Canvas { context, size in
            YardIllustrationArt.draw(kind, in: &context, size: size, t: t, idle: idle)
        }
    }
}

// MARK: - Drawing

enum YardIllustrationArt {
    /// A time well after every entrance: the resting pose.
    static let restTime: Double = 30

    /// The design space each illustration is drawn in, scaled to fit.
    static func designSize(_ kind: YardIllustration.Kind) -> CGSize {
        switch kind {
        case .shop, .sell: return CGSize(width: 180, height: 150)
        case .stamp: return CGSize(width: 200, height: 180)
        }
    }

    static func draw(_ kind: YardIllustration.Kind, in context: inout GraphicsContext, size: CGSize, t: Double, idle: Double) {
        let design = designSize(kind)
        let k = min(size.width / design.width, size.height / design.height)
        context.translateBy(x: (size.width - design.width * k) / 2, y: (size.height - design.height * k) / 2)
        context.scaleBy(x: k, y: k)
        switch kind {
        case .shop: drawShop(&context, t: t, idle: idle)
        case .sell: drawSell(&context, t: t, idle: idle)
        case .stamp(let small, let big): drawStamp(&context, t: t, idle: idle, small: small, big: big)
        }
    }

    // MARK: Motion helpers

    /// A damped spring from 0 to 1 starting at t = 0 (overshoots a little).
    static func spring(_ t: Double, damping: Double = 0.62, omega: Double = 11) -> Double {
        guard t > 0 else { return 0 }
        let d = min(0.99, max(0.05, damping))
        let wd = omega * (1 - d * d).squareRoot()
        return 1 - exp(-d * omega * t) * (cos(wd * t) + d * omega / wd * sin(wd * t))
    }

    static func smoothstep(_ a: Double, _ b: Double, _ x: Double) -> Double {
        let u = min(1, max(0, (x - a) / (b - a)))
        return u * u * (3 - 2 * u)
    }

    static func clamp01(_ x: Double) -> Double { min(1, max(0, x)) }

    // MARK: Palette (Yard's fixed colours: these illustrations sit on acid / violet fills)

    private static var acid: Color { Color.yard.acid }
    private static var violet: Color { Color.yard.studio }
    private static var ink: Color { Color.yard.scrim }
    private static var white: Color { Color.yard.onPhoto }

    // MARK: Shapes

    /// A polygon with rounded corners (points in local coordinates).
    static func rounded(_ points: [CGPoint], radius: CGFloat) -> Path {
        var p = Path()
        guard points.count > 2 else { return p }
        let n = points.count
        let first = CGPoint(x: (points[n - 1].x + points[0].x) / 2, y: (points[n - 1].y + points[0].y) / 2)
        p.move(to: first)
        for i in 0..<n {
            p.addArc(tangent1End: points[i], tangent2End: points[(i + 1) % n], radius: radius)
        }
        p.closeSubpath()
        return p
    }

    static func sparkle(center c: CGPoint, size s: CGFloat) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: c.x, y: c.y - s))
        p.addQuadCurve(to: CGPoint(x: c.x + s, y: c.y), control: c)
        p.addQuadCurve(to: CGPoint(x: c.x, y: c.y + s), control: c)
        p.addQuadCurve(to: CGPoint(x: c.x - s, y: c.y), control: c)
        p.addQuadCurve(to: CGPoint(x: c.x, y: c.y - s), control: c)
        p.closeSubpath()
        return p
    }

    private static func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: y) }

    private static func softLight(_ c: inout GraphicsContext, at center: CGPoint, radius: CGFloat, strength: Double) {
        c.fill(
            Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)),
            with: .radialGradient(Gradient(colors: [white.opacity(strength), white.opacity(0)]), center: center, startRadius: 0, endRadius: radius)
        )
    }

    private static func sparkles(_ c: inout GraphicsContext, t: Double, idle: Double, start: Double, items: [(CGPoint, CGFloat, Color)]) {
        for (i, item) in items.enumerated() {
            let e = clamp01(spring(t - start - Double(i) * 0.08, damping: 0.5, omega: 13))
            let twinkle = 1 - idle * (0.45 - 0.45 * sin(t * 2.6 + Double(i) * 1.7))
            let s = item.1 * CGFloat(e * twinkle)
            guard s > 0.2 else { continue }
            var l = c
            l.opacity = e
            l.fill(sparkle(center: item.0, size: s), with: .color(item.2))
        }
    }

    // MARK: Shop

    private static func drawShop(_ c: inout GraphicsContext, t: Double, idle: Double) {
        softLight(&c, at: pt(78, 44), radius: 92, strength: 0.5)

        // Ground shadow under the bag and cards.
        c.fill(Path(ellipseIn: CGRect(x: 28, y: 126, width: 128, height: 12)), with: .color(ink.opacity(0.12)))

        // Product cards fanning out from a shared pivot (left, right, then middle).
        let cards: [(angle: Double, dx: CGFloat, art: Int, order: Int)] = [(-22, -32, 0, 0), (18, 30, 2, 1), (-3, 0, 1, 2)]
        for card in cards {
            let e = spring(t - 0.05 - Double(card.order) * 0.08, damping: 0.6, omega: 10)
            let float = CGFloat(sin(t * 1.1 + Double(card.order) * 1.3) * 2 * idle)
            var l = c
            l.opacity = clamp01(e * 2)
            l.translateBy(x: 104 + card.dx * CGFloat(e), y: 108 + float + CGFloat(1 - clamp01(e)) * 16)
            l.rotate(by: .degrees(card.angle * e + sin(t * 0.9 + Double(card.order)) * 1.4 * idle))
            l.drawLayer { layer in
                layer.addFilter(.shadow(color: ink.opacity(0.22), radius: 7, x: 0, y: 5))
                layer.fill(Path(roundedRect: CGRect(x: -31, y: -86, width: 62, height: 82), cornerRadius: 13), with: .color(white))
            }
            l.fill(Path(roundedRect: CGRect(x: -25, y: -80, width: 50, height: 46), cornerRadius: 9), with: .color(ink.opacity(0.06)))
            productArt(&l, kind: card.art, center: pt(0, -57))
            l.fill(Path(roundedRect: CGRect(x: -25, y: -27, width: 32, height: 5), cornerRadius: 2.5), with: .color(ink.opacity(0.85)))
            l.fill(Path(roundedRect: CGRect(x: -25, y: -18, width: 18, height: 5), cornerRadius: 2.5), with: .color(violet))
            l.fill(Path(ellipseIn: CGRect(x: 15, y: -20, width: 9, height: 9)), with: .color(acid))
        }

        // The bag.
        let eb = spring(t - 0.3, damping: 0.55, omega: 11)
        let bagY: CGFloat = 104 + CGFloat(1 - clamp01(eb)) * 26 + CGFloat(sin(t * 1.4) * 3 * idle)
        var bag = c
        bag.opacity = clamp01(eb * 1.6)
        bag.translateBy(x: 62, y: bagY)
        bag.rotate(by: .degrees(sin(t * 0.9 + 0.6) * 2 * idle))
        bag.scaleBy(x: 0.6 + 0.4 * CGFloat(eb), y: 0.6 + 0.4 * CGFloat(eb))
        drawBag(&bag)

        // The price tag, hanging from the bag's handle and swinging on its string.
        let et = spring(t - 0.6, damping: 0.4, omega: 9)
        if et > 0.01 {
            var tag = bag
            tag.translateBy(x: 13, y: -30)
            let swing = sin(t * 1.8) * 11 * idle + (1 - et) * 40
            tag.rotate(by: .degrees(swing))
            tag.opacity = clamp01(et * 2)
            var string = Path()
            string.move(to: .zero)
            string.addQuadCurve(to: pt(14, 25), control: pt(4, 16))
            tag.stroke(string, with: .color(ink), style: StrokeStyle(lineWidth: 1.3, lineCap: .round))
            tag.drawLayer { layer in
                layer.addFilter(.shadow(color: ink.opacity(0.25), radius: 3, x: 1, y: 2))
                layer.fill(rounded([pt(9, 20), pt(19, 20), pt(26, 28), pt(26, 52), pt(2, 52), pt(2, 28)], radius: 3), with: .color(white))
            }
            tag.fill(Path(ellipseIn: CGRect(x: 11.5, y: 23, width: 5, height: 5)), with: .color(ink))
            tag.draw(Text("NEW").font(.system(size: 7, weight: .black)).foregroundColor(ink), at: pt(14, 37))
            tag.fill(Path(roundedRect: CGRect(x: 6, y: 44, width: 16, height: 3), cornerRadius: 1.5), with: .color(violet))
        }

        sparkles(&c, t: t, idle: idle, start: 0.75, items: [
            (pt(156, 28), 9, ink), (pt(22, 36), 7, white), (pt(164, 98), 5, white), (pt(126, 12), 4, ink),
        ])
    }

    /// Generic products: a sphere, a bottle, a box.
    private static func productArt(_ c: inout GraphicsContext, kind: Int, center p: CGPoint) {
        switch kind {
        case 0:
            c.fill(Path(ellipseIn: CGRect(x: p.x - 13, y: p.y - 13, width: 26, height: 26)),
                   with: .radialGradient(Gradient(colors: [violet.opacity(0.75), violet]), center: pt(p.x - 5, p.y - 5), startRadius: 0, endRadius: 20))
            c.fill(Path(ellipseIn: CGRect(x: p.x - 8, y: p.y - 9, width: 7, height: 5)), with: .color(white.opacity(0.7)))
        case 1:
            c.fill(Path(roundedRect: CGRect(x: p.x - 4, y: p.y - 19, width: 8, height: 6), cornerRadius: 1.5), with: .color(violet))
            c.fill(Path(roundedRect: CGRect(x: p.x - 9, y: p.y - 14, width: 18, height: 30), cornerRadius: 6), with: .color(ink))
            c.fill(Path(roundedRect: CGRect(x: p.x - 9, y: p.y - 2, width: 18, height: 8), cornerRadius: 1), with: .color(acid))
            c.fill(Path(roundedRect: CGRect(x: p.x - 6, y: p.y - 11, width: 2.5, height: 9), cornerRadius: 1.2), with: .color(white.opacity(0.35)))
        default:
            let top = rounded([pt(p.x, p.y - 15), pt(p.x + 14, p.y - 8), pt(p.x, p.y - 1), pt(p.x - 14, p.y - 8)], radius: 1.5)
            let left = rounded([pt(p.x - 14, p.y - 8), pt(p.x, p.y - 1), pt(p.x, p.y + 15), pt(p.x - 14, p.y + 8)], radius: 1.5)
            let right = rounded([pt(p.x, p.y - 1), pt(p.x + 14, p.y - 8), pt(p.x + 14, p.y + 8), pt(p.x, p.y + 15)], radius: 1.5)
            c.fill(left, with: .color(ink))
            c.fill(right, with: .color(ink.opacity(0.78)))
            c.fill(top, with: .color(acid))
        }
    }

    /// A shopping bag with a side face, violet lining, a sheen and a Yard mark.
    private static func drawBag(_ c: inout GraphicsContext) {
        c.drawLayer { layer in
            layer.addFilter(.shadow(color: ink.opacity(0.3), radius: 8, x: 0, y: 6))
            layer.fill(rounded([pt(-28, -26), pt(24, -26), pt(28, 26), pt(-32, 26)], radius: 6), with: .color(ink))
        }
        // Side face (depth).
        c.fill(rounded([pt(24, -26), pt(34, -32), pt(37, 19), pt(28, 26)], radius: 4), with: .color(ink))
        c.fill(rounded([pt(24, -26), pt(34, -32), pt(37, 19), pt(28, 26)], radius: 4),
               with: .linearGradient(Gradient(colors: [white.opacity(0.16), white.opacity(0.04)]), startPoint: pt(24, -30), endPoint: pt(37, 24)))
        // Lining seen through the opening.
        c.fill(rounded([pt(-28, -26), pt(-18, -32), pt(34, -32), pt(24, -26)], radius: 2), with: .color(violet))
        // Front sheen.
        let front = rounded([pt(-28, -26), pt(24, -26), pt(28, 26), pt(-32, 26)], radius: 6)
        c.fill(front, with: .linearGradient(Gradient(colors: [white.opacity(0.22), white.opacity(0)]), startPoint: pt(-30, -26), endPoint: pt(10, 20)))
        c.fill(Path(roundedRect: CGRect(x: -24, y: -19, width: 3, height: 34), cornerRadius: 1.5), with: .color(white.opacity(0.2)))
        // Handles.
        var back = Path()
        back.move(to: pt(-6, -30))
        back.addQuadCurve(to: pt(22, -30), control: pt(8, -56))
        c.stroke(back, with: .color(ink.opacity(0.85)), style: StrokeStyle(lineWidth: 3.5, lineCap: .round))
        var handle = Path()
        handle.move(to: pt(-15, -27))
        handle.addQuadCurve(to: pt(13, -27), control: pt(-1, -54))
        c.stroke(handle, with: .color(ink), style: StrokeStyle(lineWidth: 4, lineCap: .round))
        var gleam = Path()
        gleam.move(to: pt(-11, -33))
        gleam.addQuadCurve(to: pt(-2, -43), control: pt(-8, -41))
        c.stroke(gleam, with: .color(white.opacity(0.45)), style: StrokeStyle(lineWidth: 1.2, lineCap: .round))
        // Yard mark.
        c.fill(Path(ellipseIn: CGRect(x: -12, y: -6, width: 20, height: 20)), with: .color(acid))
        c.draw(Text("Y").font(.system(size: 12, weight: .black).width(.compressed)).foregroundColor(ink), at: pt(-2, 4))
    }

    // MARK: Sell

    private static func drawSell(_ c: inout GraphicsContext, t: Double, idle: Double) {
        softLight(&c, at: pt(70, 40), radius: 96, strength: 0.32)

        // Rising sparkline with a glow (behind the shop).
        let points: [CGPoint] = [pt(104, 50), pt(118, 40), pt(128, 45), pt(141, 27), pt(152, 32), pt(168, 10)]
        var line = Path()
        line.addLines(points)
        let es = smoothstep(0.9, 1.9, t)
        if es > 0 {
            let trimmed = line.trimmedPath(from: 0, to: es)
            var glow = c
            glow.addFilter(.blur(radius: 4))
            glow.stroke(trimmed, with: .color(acid.opacity(0.8)), style: StrokeStyle(lineWidth: 7, lineCap: .round, lineJoin: .round))
            c.stroke(trimmed, with: .color(acid), style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
            if es > 0.97 {
                let pulse = 1 + 0.35 * sin(t * 3) * idle
                let end = points[points.count - 1]
                var halo = c
                halo.addFilter(.blur(radius: 3))
                halo.fill(Path(ellipseIn: CGRect(x: end.x - 7 * pulse, y: end.y - 7 * pulse, width: 14 * pulse, height: 14 * pulse)), with: .color(acid.opacity(0.7)))
                c.fill(Path(ellipseIn: CGRect(x: end.x - 4, y: end.y - 4, width: 8, height: 8)), with: .color(white))
            }
        }

        // Ground.
        c.fill(Path(roundedRect: CGRect(x: 14, y: 131, width: 152, height: 3), cornerRadius: 1.5), with: .color(ink.opacity(0.25)))

        // Building.
        let eb = spring(t - 0.05, damping: 0.65, omega: 10)
        var shop = c
        shop.opacity = clamp01(eb * 2)
        shop.translateBy(x: 84, y: 132)
        shop.scaleBy(x: 0.9 + 0.1 * CGFloat(eb), y: CGFloat(max(0.05, eb)))
        shop.translateBy(x: -84, y: -132)
        shop.drawLayer { layer in
            layer.addFilter(.shadow(color: ink.opacity(0.3), radius: 8, x: 0, y: 6))
            layer.fill(Path(roundedRect: CGRect(x: 34, y: 58, width: 100, height: 74), cornerRadius: 9), with: .color(white))
        }
        shop.fill(Path(roundedRect: CGRect(x: 30, y: 46, width: 108, height: 13), cornerRadius: 5), with: .color(ink))
        shop.draw(Text("YARD").font(.system(size: 8, weight: .black)).foregroundColor(acid), at: pt(84, 52.5))
        // Window with shelf and products, lit from inside.
        shop.fill(Path(roundedRect: CGRect(x: 42, y: 84, width: 48, height: 36), cornerRadius: 6),
                  with: .linearGradient(Gradient(colors: [acid.opacity(0.55), violet.opacity(0.18)]), startPoint: pt(42, 84), endPoint: pt(90, 120)))
        shop.fill(Path(roundedRect: CGRect(x: 46, y: 110, width: 40, height: 3), cornerRadius: 1.5), with: .color(ink.opacity(0.7)))
        shop.fill(Path(ellipseIn: CGRect(x: 49, y: 99, width: 11, height: 11)), with: .color(violet))
        shop.fill(Path(roundedRect: CGRect(x: 63, y: 95, width: 8, height: 15), cornerRadius: 3), with: .color(ink))
        shop.fill(Path(roundedRect: CGRect(x: 74, y: 101, width: 9, height: 9), cornerRadius: 1.5), with: .color(white))
        shop.stroke(Path(roundedRect: CGRect(x: 74, y: 101, width: 9, height: 9), cornerRadius: 1.5), with: .color(ink), lineWidth: 1)
        shop.fill(Path(roundedRect: CGRect(x: 44, y: 86, width: 4, height: 20), cornerRadius: 2), with: .color(white.opacity(0.55)))
        // Door.
        shop.fill(Path(roundedRect: CGRect(x: 98, y: 86, width: 28, height: 46), cornerRadius: 5), with: .color(ink))
        shop.fill(Path(ellipseIn: CGRect(x: 118, y: 108, width: 4, height: 4)), with: .color(acid))

        // Awning: stripes unroll, then ripple in the breeze.
        let ea = spring(t - 0.3, damping: 0.6, omega: 11)
        if ea > 0.01 {
            shop.fill(Path(roundedRect: CGRect(x: 34, y: 59, width: 100, height: 22 * CGFloat(clamp01(ea))), cornerRadius: 2), with: .color(ink.opacity(0.1)))
            for i in 0..<6 {
                let x = 30 + CGFloat(i) * 18
                let ripple = CGFloat(sin(t * 3.2 - Double(i) * 0.75) * 2.2 * idle)
                let drop = CGFloat(ea) * (13 + ripple)
                let color = i % 2 == 0 ? acid : ink
                shop.fill(Path(CGRect(x: x, y: 58, width: 18, height: max(0, drop))), with: .color(color))
                shop.fill(Path(ellipseIn: CGRect(x: x, y: 58 + drop - 9 * CGFloat(ea), width: 18, height: 18 * CGFloat(ea))), with: .color(color))
            }
        }

        // OPEN sign: flips to OPEN on arrival, then turns over now and then.
        let arrival = smoothstep(0.7, 1.25, t) * 180
        let period = 5.0
        let cycle = max(0, t - 2.0).truncatingRemainder(dividingBy: period)
        let idleFlip = smoothstep(0, 0.7, cycle) * 360 * idle
        let angle = (180 - arrival + idleFlip) * .pi / 180
        let face = cos(angle)
        var sign = c
        sign.opacity = clamp01(eb * 2)
        var strings = Path()
        strings.move(to: pt(105, 88)); strings.addLine(to: pt(108, 95))
        strings.move(to: pt(119, 88)); strings.addLine(to: pt(116, 95))
        sign.stroke(strings, with: .color(white.opacity(0.7)), lineWidth: 0.8)
        sign.translateBy(x: 112, y: 101)
        sign.scaleBy(x: CGFloat(max(0.03, abs(face))), y: 1)
        let open = face >= 0
        sign.fill(Path(roundedRect: CGRect(x: -14, y: -6.5, width: 28, height: 13), cornerRadius: 3), with: .color(open ? acid : white))
        sign.draw(Text(open ? "OPEN" : "SOON").font(.system(size: 7.5, weight: .black)).foregroundColor(ink), at: .zero)

        // Parcel pops out of the door, then hops now and then.
        let ep = spring(t - 1.1, damping: 0.42, omega: 12)
        if ep > 0.01 {
            let hopPhase = max(0, t - 2.4).truncatingRemainder(dividingBy: 3.2)
            let hop = hopPhase < 0.5 ? sin(hopPhase / 0.5 * .pi) * 7 * idle : 0
            let squash = hopPhase < 0.08 ? 0.92 : 1.0
            let x = 112 + 38 * CGFloat(clamp01(ep))
            let y = 128 - CGFloat(sin(clamp01(ep) * .pi) * 22) - CGFloat(hop)
            var shadow = c
            shadow.opacity = 0.18 * clamp01(ep)
            shadow.fill(Path(ellipseIn: CGRect(x: x - 13 + CGFloat(hop) * 0.6, y: 129, width: 26 - CGFloat(hop) * 1.2, height: 5)), with: .color(ink))
            var parcel = c
            parcel.translateBy(x: x, y: y)
            parcel.rotate(by: .degrees((1 - clamp01(ep)) * -25 + hop * 0.8))
            parcel.scaleBy(x: CGFloat(clamp01(ep)) * CGFloat(2 - squash), y: CGFloat(clamp01(ep)) * CGFloat(squash))
            drawParcel(&parcel, size: 14, tape: violet)
        }

        sparkles(&c, t: t, idle: idle, start: 1.6, items: [
            (pt(24, 28), 8, acid), (pt(150, 70), 5, white), (pt(18, 96), 5, white),
        ])
    }

    /// An isometric parcel resting on (0,0), `size` = half width.
    private static func drawParcel(_ c: inout GraphicsContext, size s: CGFloat, tape: Color) {
        let h = s * 1.05
        let top = rounded([pt(0, -h - s), pt(s, -h - s * 0.5), pt(0, -h), pt(-s, -h - s * 0.5)], radius: 1.5)
        let left = rounded([pt(-s, -h - s * 0.5), pt(0, -h), pt(0, 0), pt(-s, -s * 0.5)], radius: 1.5)
        let right = rounded([pt(0, -h), pt(s, -h - s * 0.5), pt(s, -s * 0.5), pt(0, 0)], radius: 1.5)
        c.drawLayer { layer in
            layer.addFilter(.shadow(color: ink.opacity(0.25), radius: 4, x: 0, y: 3))
            layer.fill(left, with: .color(acid))
        }
        c.fill(left, with: .color(acid))
        c.fill(right, with: .color(acid))
        c.fill(right, with: .color(ink.opacity(0.18)))
        c.fill(top, with: .color(acid))
        c.fill(top, with: .color(white.opacity(0.35)))
        // Tape across the top and down the front.
        var band = Path()
        band.move(to: pt(-s * 0.5, -h - s * 0.75))
        band.addLine(to: pt(s * 0.5, -h - s * 0.25))
        band.addLine(to: pt(s * 0.5, -s * 0.25))
        c.stroke(band, with: .color(tape), style: StrokeStyle(lineWidth: s * 0.28, lineCap: .butt, lineJoin: .round))
        c.stroke(left, with: .color(ink.opacity(0.35)), lineWidth: 0.6)
        c.stroke(right, with: .color(ink.opacity(0.35)), lineWidth: 0.6)
    }

    // MARK: Stamp

    private static func drawStamp(_ c: inout GraphicsContext, t: Double, idle: Double, small: String, big: String) {
        softLight(&c, at: pt(100, 90), radius: 96, strength: 0.0)
        // Glow behind the parcel.
        var glow = c
        glow.addFilter(.blur(radius: 18))
        glow.fill(Path(ellipseIn: CGRect(x: 44, y: 60, width: 112, height: 90)), with: .color(acid.opacity(0.45)))

        // Parcel drops in with a bounce, then floats.
        let ep = spring(t - 0.05, damping: 0.45, omega: 11)
        let float = CGFloat(sin(t * 1.2) * 3 * idle)
        var shadow = c
        shadow.opacity = 0.2 * clamp01(ep)
        shadow.fill(Path(ellipseIn: CGRect(x: 62 - float, y: 158, width: 76 + float * 2, height: 9)), with: .color(Color.yard.scrim))
        var parcel = c
        parcel.opacity = clamp01(ep * 2)
        parcel.translateBy(x: 100, y: 156 - CGFloat(1 - ep) * 60 + float)
        drawParcel(&parcel, size: 40, tape: violet)

        // The stamp slams on, with a shock ring and a little settle.
        let es = spring(t - 0.55, damping: 0.5, omega: 14)
        if es > 0.001 {
            let scale = CGFloat(2.4 - 1.4 * es)
            var stamp = c
            stamp.opacity = clamp01(es * 3)
            stamp.translateBy(x: 132, y: 64)
            stamp.rotate(by: .degrees(-14 + sin(t * 1.1) * 2 * idle))
            stamp.scaleBy(x: scale, y: scale)
            stamp.drawLayer { layer in
                layer.addFilter(.shadow(color: ink.opacity(0.3), radius: 6, x: 0, y: 4))
                layer.fill(Path(ellipseIn: CGRect(x: -36, y: -36, width: 72, height: 72)), with: .color(violet))
            }
            stamp.stroke(Path(ellipseIn: CGRect(x: -31, y: -31, width: 62, height: 62)), with: .color(white.opacity(0.9)), style: StrokeStyle(lineWidth: 1.5, dash: [3, 2.5]))
            stamp.draw(Text(small).font(.system(size: small.count > 10 ? 5.6 : 7, weight: .heavy)).foregroundColor(white), at: pt(0, -13))
            stamp.draw(Text(big).font(.system(size: 19, weight: .black).width(.compressed)).foregroundColor(acid), at: pt(0, 4))
            stamp.fill(sparkle(center: pt(-17, 18), size: 3.5), with: .color(white))
            stamp.fill(sparkle(center: pt(0, 20), size: 3.5), with: .color(white))
            stamp.fill(sparkle(center: pt(17, 18), size: 3.5), with: .color(white))

            let ring = smoothstep(0.62, 1.15, t)
            if ring > 0, ring < 1 {
                var shock = c
                shock.opacity = 1 - ring
                let r = 36 + 30 * CGFloat(ring)
                shock.stroke(Path(ellipseIn: CGRect(x: 132 - r, y: 64 - r, width: r * 2, height: r * 2)), with: .color(acid), lineWidth: 3)
            }
        }

        sparkles(&c, t: t, idle: idle, start: 0.9, items: [
            (pt(36, 52), 9, acid), (pt(176, 132), 7, violet), (pt(52, 132), 5, violet), (pt(92, 22), 6, acid),
        ])
    }
}

// MARK: - Press tilt

/// A card press: a subtle 3D tilt toward the finger, a slight scale and a light haptic on touch.
/// Reduce Motion keeps only a dim.
struct YardTiltPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        YardTiltPressBody(configuration: configuration)
    }
}

private struct YardTiltPressBody: View {
    let configuration: ButtonStyleConfiguration
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let pressed = configuration.isPressed
        configuration.label
            .rotation3DEffect(.degrees(pressed && !reduceMotion ? 7 : 0), axis: (x: 1, y: -0.6, z: 0), perspective: 0.6)
            .scaleEffect(pressed && !reduceMotion ? 0.975 : 1)
            .opacity(pressed ? 0.94 : 1)
            .animation(Motion.resolved(.spring(response: 0.3, dampingFraction: 0.6), reduceMotion: reduceMotion), value: pressed)
            .sensoryFeedback(.impact(weight: .light), trigger: pressed) { _, new in new }
    }
}

#Preview("Illustrations — dark") {
    VStack(spacing: 16) {
        YardIllustration(.shop).frame(height: 150).background(Color.yard.acid)
        YardIllustration(.sell).frame(height: 150).background(Color.yard.studio)
        YardIllustration(.stamp(small: "YOU'RE ON THE", big: "LIST")).frame(height: 200)
    }
    .padding()
    .yardScreenBackground()
    .preferredColorScheme(.dark)
}

#Preview("Illustrations — light") {
    YardIllustration(.stamp(small: "NOW", big: "LIVE"))
        .frame(height: 220)
        .padding()
        .yardScreenBackground()
        .preferredColorScheme(.light)
}
