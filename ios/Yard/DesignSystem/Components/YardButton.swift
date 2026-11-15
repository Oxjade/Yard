import SwiftUI

/// Yard's pill button.
///
///   YardButton("Add to bag", systemImage: "bag", isLoading: adding) { … }            // primary (acid)
///   YardButton("Choose size", style: .secondary, fullWidth: false) { … }
///   YardButton("Follow", style: .onPhoto) { … }                                       // white on photos
///   YardButton("Delete address", style: .destructive) { … }
///   YardButton("Clear", style: .ghost, size: .small) { … }
///
/// Disable with `.disabled(_:)`. While `isLoading` the label is replaced by a spinner and taps
/// are ignored. Add `.sensoryFeedback` at the call site when the tap changes state.
struct YardButton: View {
    enum Style: Sendable {
        /// Acid fill, black text — the one main action on a screen.
        case primary
        /// `surface2` fill, `ink` text.
        case secondary
        /// White fill, black text — on top of photos (brand hero Follow).
        case onPhoto
        /// `danger` text on `surface2`.
        case destructive
        /// Text only, `ink`.
        case ghost
        /// `ink` fill, `bg` text — strong neutral (e.g. selected state, "Following").
        case inverted
    }

    enum Size: Sendable {
        /// 52pt tall.
        case large
        /// 44pt tall.
        case medium
        /// 34pt tall, caption-sized text.
        case small

        var height: CGFloat {
            switch self {
            case .large: return 52
            case .medium: return 44
            case .small: return 34
            }
        }
    }

    let title: String
    var systemImage: String? = nil
    var style: Style = .primary
    var size: Size = .large
    var isLoading: Bool = false
    var fullWidth: Bool = true
    let action: () -> Void

    init(_ title: String, systemImage: String? = nil, style: Style = .primary, size: Size = .large, isLoading: Bool = false, fullWidth: Bool = true, action: @escaping () -> Void) {
        self.title = title
        self.systemImage = systemImage
        self.style = style
        self.size = size
        self.isLoading = isLoading
        self.fullWidth = fullWidth
        self.action = action
    }

    var body: some View {
        Button {
            if !isLoading { action() }
        } label: {
            ZStack {
                HStack(spacing: Spacing.s) {
                    if let systemImage {
                        Image(systemName: systemImage)
                    }
                    Text(title)
                        .lineLimit(1)
                }
                .opacity(isLoading ? 0 : 1)
                if isLoading {
                    ProgressView()
                        .tint(YardButton.foreground(for: style))
                }
            }
            .font(size == .small ? Font.yardCaptionEmphasis : Font.yardBodyEmphasis)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .frame(height: size.height)
            .padding(.horizontal, size == .small ? Spacing.m : Spacing.xl)
            .contentShape(Capsule())
        }
        .buttonStyle(YardPillButtonStyle(style: style))
        .accessibilityLabel(Text(title))
        .accessibilityValue(isLoading ? Text("Loading") : Text(""))
    }

    static func foreground(for style: Style) -> Color {
        switch style {
        case .primary: return Color.yard.onAcid
        case .secondary: return Color.yard.ink
        case .onPhoto: return Color.yard.onPhotoInk
        case .destructive: return Color.yard.danger
        case .ghost: return Color.yard.ink
        case .inverted: return Color.yard.bg
        }
    }

    static func background(for style: Style) -> Color {
        switch style {
        case .primary: return Color.yard.acid
        case .secondary: return Color.yard.surface2
        case .onPhoto: return Color.yard.onPhoto
        case .destructive: return Color.yard.surface2
        case .ghost: return Color.clear
        case .inverted: return Color.yard.ink
        }
    }
}

/// The pill style behind `YardButton`; also usable on any `Button` label:
/// `Button { … } label: { … }.buttonStyle(YardPillButtonStyle(style: .secondary))`.
struct YardPillButtonStyle: ButtonStyle {
    var style: YardButton.Style = .primary
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(style: YardButton.Style = .primary) {
        self.style = style
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(YardButton.foreground(for: style))
            .background(YardButton.background(for: style), in: Capsule())
            .overlay {
                // A brief darkening on press: the button reads as pushed even with Reduce Motion on.
                Capsule().fill(Color.yard.scrim.opacity(configuration.isPressed ? 0.08 : 0))
            }
            .opacity(isEnabled ? 1 : 0.4)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.97 : 1)
            .animation(Motion.resolved(Motion.press, reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

/// A subtle press-scale style for tappable cards and tiles (no colour change).
/// `scale` defaults to the large-card value; Reduce Motion keeps only the dim.
struct PressableButtonStyle: ButtonStyle {
    var scale: CGFloat = Motion.cardPressScale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(scale: CGFloat = Motion.cardPressScale) {
        self.scale = scale
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? scale : 1)
            .opacity(configuration.isPressed ? 0.92 : 1)
            .animation(Motion.resolved(Motion.press, reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

/// Large photo cards (drop cards, hero tiles): a gentle compression and a slight darkening,
/// so the card feels pressed into the page. Reduce Motion keeps only the darkening.
struct YardCardPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init() {}

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .brightness(configuration.isPressed ? -0.04 : 0)
            .scaleEffect(configuration.isPressed && !reduceMotion ? Motion.cardPressScale : 1)
            .animation(Motion.resolved(Motion.press, reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

/// Quick-link cells and other small tiles: compresses to `Motion.pressScale`, lays a highlight
/// over `shape`, and gives a light tap on touch-down.
struct YardTilePressStyle<S: Shape>: ButtonStyle {
    let shape: S
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(shape: S) {
        self.shape = shape
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background {
                shape.fill(Color.yard.ink.opacity(configuration.isPressed ? 0.07 : 0))
            }
            .scaleEffect(configuration.isPressed && !reduceMotion ? Motion.pressScale : 1)
            .animation(Motion.resolved(Motion.press, reduceMotion: reduceMotion), value: configuration.isPressed)
            .sensoryFeedback(.impact(weight: .light, intensity: 0.7), trigger: configuration.isPressed) { _, pressed in pressed }
    }
}

extension YardTilePressStyle where S == Rectangle {
    init() { self.init(shape: Rectangle()) }
}

#Preview("Buttons — dark") {
    ButtonsPreview().preferredColorScheme(.dark)
}

#Preview("Buttons — light") {
    ButtonsPreview().preferredColorScheme(.light)
}

private struct ButtonsPreview: View {
    var body: some View {
        VStack(spacing: 12) {
            YardButton("Add to bag", systemImage: "bag") {}
            YardButton("Paying…", isLoading: true) {}
            YardButton("Choose size", style: .secondary) {}
            YardButton("Follow", style: .onPhoto) {}
            YardButton("Remove", style: .destructive, size: .medium) {}
            HStack {
                YardButton("Following", style: .inverted, size: .small, fullWidth: false) {}
                YardButton("Clear", style: .ghost, size: .small, fullWidth: false) {}
                YardButton("Disabled", size: .small, fullWidth: false) {}.disabled(true)
            }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.yard.bg)
    }
}
