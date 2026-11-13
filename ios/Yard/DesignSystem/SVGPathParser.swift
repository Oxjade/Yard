import SwiftUI

/// A small SVG path-data parser producing a SwiftUI `Path` in the path's own coordinates.
///
/// Supports M/m, L/l, H/h, V/v, C/c, S/s, Q/q, T/t, Z/z with implicit command repetition
/// (extra coordinate pairs after M are treated as L, as the SVG spec says). Arcs (A/a) are not
/// supported and are skipped. Used by `YardLogoShape`; reusable for any simple icon path.
enum SVGPathParser {
    static func parse(_ data: String) -> Path {
        var scanner = Scanner(Array(data.utf8))
        var path = Path()
        var current = CGPoint.zero
        var subpathStart = CGPoint.zero
        var lastControl: CGPoint? = nil      // for S/s (cubic reflection)
        var lastQuadControl: CGPoint? = nil  // for T/t (quadratic reflection)
        var command: UInt8 = 0

        while true {
            scanner.skipSeparators()
            if scanner.isAtEnd { break }
            if let c = scanner.peekCommand() {
                command = c
                scanner.advance()
            } else if command == 0 {
                break // numbers before any command: malformed
            }
            let relative = command >= 97 // lowercase
            let upper = relative ? command - 32 : command

            switch upper {
            case 77: // M
                guard let x = scanner.number(), let y = scanner.number() else { return path }
                let p = relative ? CGPoint(x: current.x + x, y: current.y + y) : CGPoint(x: x, y: y)
                path.move(to: p)
                current = p
                subpathStart = p
                lastControl = nil
                lastQuadControl = nil
                // Subsequent pairs are implicit line-tos.
                command = relative ? 108 : 76
            case 76: // L
                guard let x = scanner.number(), let y = scanner.number() else { return path }
                let p = relative ? CGPoint(x: current.x + x, y: current.y + y) : CGPoint(x: x, y: y)
                path.addLine(to: p)
                current = p
                lastControl = nil
                lastQuadControl = nil
            case 72: // H
                guard let x = scanner.number() else { return path }
                let p = CGPoint(x: relative ? current.x + x : x, y: current.y)
                path.addLine(to: p)
                current = p
                lastControl = nil
                lastQuadControl = nil
            case 86: // V
                guard let y = scanner.number() else { return path }
                let p = CGPoint(x: current.x, y: relative ? current.y + y : y)
                path.addLine(to: p)
                current = p
                lastControl = nil
                lastQuadControl = nil
            case 67: // C
                guard let x1 = scanner.number(), let y1 = scanner.number(),
                      let x2 = scanner.number(), let y2 = scanner.number(),
                      let x = scanner.number(), let y = scanner.number() else { return path }
                let o = relative ? current : .zero
                let c1 = CGPoint(x: o.x + x1, y: o.y + y1)
                let c2 = CGPoint(x: o.x + x2, y: o.y + y2)
                let p = CGPoint(x: o.x + x, y: o.y + y)
                path.addCurve(to: p, control1: c1, control2: c2)
                current = p
                lastControl = c2
                lastQuadControl = nil
            case 83: // S
                guard let x2 = scanner.number(), let y2 = scanner.number(),
                      let x = scanner.number(), let y = scanner.number() else { return path }
                let o = relative ? current : .zero
                let c1: CGPoint
                if let lc = lastControl {
                    c1 = CGPoint(x: 2 * current.x - lc.x, y: 2 * current.y - lc.y)
                } else {
                    c1 = current
                }
                let c2 = CGPoint(x: o.x + x2, y: o.y + y2)
                let p = CGPoint(x: o.x + x, y: o.y + y)
                path.addCurve(to: p, control1: c1, control2: c2)
                current = p
                lastControl = c2
                lastQuadControl = nil
            case 81: // Q
                guard let x1 = scanner.number(), let y1 = scanner.number(),
                      let x = scanner.number(), let y = scanner.number() else { return path }
                let o = relative ? current : .zero
                let c = CGPoint(x: o.x + x1, y: o.y + y1)
                let p = CGPoint(x: o.x + x, y: o.y + y)
                path.addQuadCurve(to: p, control: c)
                current = p
                lastQuadControl = c
                lastControl = nil
            case 84: // T
                guard let x = scanner.number(), let y = scanner.number() else { return path }
                let o = relative ? current : .zero
                let c: CGPoint
                if let lq = lastQuadControl {
                    c = CGPoint(x: 2 * current.x - lq.x, y: 2 * current.y - lq.y)
                } else {
                    c = current
                }
                let p = CGPoint(x: o.x + x, y: o.y + y)
                path.addQuadCurve(to: p, control: c)
                current = p
                lastQuadControl = c
                lastControl = nil
            case 90: // Z
                path.closeSubpath()
                current = subpathStart
                lastControl = nil
                lastQuadControl = nil
                command = 0 // Z takes no arguments; the next token must be a command
            case 65: // A — unsupported: consume its 7 arguments and draw a straight line.
                var args: [CGFloat] = []
                for _ in 0..<7 {
                    guard let n = scanner.number() else { return path }
                    args.append(n)
                }
                let p = relative ? CGPoint(x: current.x + args[5], y: current.y + args[6]) : CGPoint(x: args[5], y: args[6])
                path.addLine(to: p)
                current = p
                lastControl = nil
                lastQuadControl = nil
            default:
                return path
            }
        }
        return path
    }

    /// A byte scanner over ASCII path data.
    private struct Scanner {
        let bytes: [UInt8]
        var index: Int = 0

        init(_ bytes: [UInt8]) { self.bytes = bytes }

        var isAtEnd: Bool { index >= bytes.count }

        mutating func advance() { index += 1 }

        mutating func skipSeparators() {
            while index < bytes.count {
                let b = bytes[index]
                // space, tab, LF, CR, comma
                if b == 32 || b == 9 || b == 10 || b == 13 || b == 44 { index += 1 } else { break }
            }
        }

        /// The command letter at the cursor, if the next token is one (not the `e` of an exponent).
        func peekCommand() -> UInt8? {
            guard index < bytes.count else { return nil }
            let b = bytes[index]
            let isLetter = (b >= 65 && b <= 90) || (b >= 97 && b <= 122)
            if isLetter && b != 101 && b != 69 { return b }
            return nil
        }

        /// Reads one number: optional sign, digits, optional fraction, optional exponent.
        mutating func number() -> CGFloat? {
            skipSeparators()
            guard index < bytes.count else { return nil }
            let start = index
            if bytes[index] == 43 || bytes[index] == 45 { index += 1 } // + -
            var sawDigit = false
            var sawDot = false
            while index < bytes.count {
                let b = bytes[index]
                if b >= 48 && b <= 57 {
                    sawDigit = true
                    index += 1
                } else if b == 46 && !sawDot { // .
                    sawDot = true
                    index += 1
                } else {
                    break
                }
            }
            if sawDigit, index < bytes.count, bytes[index] == 101 || bytes[index] == 69 { // e E
                var j = index + 1
                if j < bytes.count, bytes[j] == 43 || bytes[j] == 45 { j += 1 }
                if j < bytes.count, bytes[j] >= 48 && bytes[j] <= 57 {
                    index = j
                    while index < bytes.count, bytes[index] >= 48 && bytes[index] <= 57 { index += 1 }
                }
            }
            guard sawDigit else {
                index = start
                return nil
            }
            let text = String(decoding: bytes[start..<index], as: UTF8.self)
            guard let value = Double(text) else { return nil }
            return CGFloat(value)
        }
    }
}
