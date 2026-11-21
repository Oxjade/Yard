import SwiftUI

/// "What brings you to Yard?" — full screen after a sign-up (or for an account with no recorded
/// choice). Shop goes straight in; Sell opens the short application. Presented by RootView;
/// it closes itself once the choice is recorded (`studio.needsRoleChoice` turns false).
@MainActor
struct RoleChoiceView: View {
    @Environment(StudioStore.self) private var studio
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    @AppStorage(AuthOnboarding.onboardedKey) private var onboarded: Bool = false

    @State private var appeared: Bool = false
    @State private var path: [SellerFlowRoute] = []

    var body: some View {
        NavigationStack(path: $path) {
            content
                .navigationDestination(for: SellerFlowRoute.self) { route in
                    switch route {
                    case .application:
                        SellerApplicationView(onClose: { finishWithoutApplying() })
                    }
                }
        }
        .tint(Color.yard.ink)
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            YardLogo(color: colorScheme == .dark ? Color.yard.acid : Color.yard.ink)
                .frame(height: 30)
                .frame(maxWidth: 84, alignment: .leading)
                .accessibilityLabel(Text("Yard"))
            Text("What brings you to Yard?")
                .yardDisplay(52)
                .foregroundStyle(Color.yard.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)

            RoleCard(
                title: "Shop on Yard",
                message: "Find independent brands, follow them and catch their drops.",
                cta: "Start shopping",
                fill: Color.yard.acid,
                ink: Color.yard.onAcid,
                art: AnyView(ShopArtwork())
            ) {
                Haptics.impact(.medium)
                onboarded = true
                studio.recordRole(.shop)
            }
            .offset(y: appeared || reduceMotion ? 0 : 60)
            .opacity(appeared ? 1 : 0)

            RoleCard(
                title: "Sell on Yard",
                message: "Open your shop in about a minute. Yard reviews every brand.",
                cta: "Apply to sell",
                fill: Color.yard.studio,
                ink: Color.yard.onPhoto,
                art: AnyView(SellArtwork())
            ) {
                Haptics.impact(.medium)
                path.append(.application)
            }
            .offset(y: appeared || reduceMotion ? 0 : 90)
            .opacity(appeared ? 1 : 0)
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.top, Spacing.l)
        .padding(.bottom, Spacing.l)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .yardScreenBackground()
        .toolbar(.hidden, for: .navigationBar)
        .onAppear {
            withAnimation(Motion.resolved(.spring(response: 0.55, dampingFraction: 0.78), reduceMotion: reduceMotion)) {
                appeared = true
            }
        }
    }

    /// Closed the application without sending it: they chose to sell, so don't ask again; the
    /// You tab keeps "Sell on Yard" for later.
    private func finishWithoutApplying() {
        studio.recordRole(.sell)
    }
}

enum SellerFlowRoute: Hashable {
    case application
}

/// One big bold choice card with its drawn artwork and a black pill.
private struct RoleCard: View {
    let title: String
    let message: String
    let cta: String
    let fill: Color
    let ink: Color
    let art: AnyView
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack(alignment: .topTrailing) {
                art
                    .frame(width: 150, height: 130)
                    .padding(.top, Spacing.m)
                    .padding(.trailing, Spacing.m)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: Spacing.s) {
                    Spacer(minLength: 0)
                    Text(title)
                        .yardDisplay(44)
                        .foregroundStyle(ink)
                    Text(message)
                        .font(.yardCallout)
                        .foregroundStyle(ink.opacity(0.8))
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.leading)
                    HStack(spacing: Spacing.s) {
                        Text(cta).font(.yardBodyEmphasis)
                        Image(systemName: "arrow.right").font(.system(size: 15, weight: .bold))
                    }
                    .foregroundStyle(Color.yard.onPhoto)
                    .padding(.horizontal, Spacing.l)
                    .frame(height: 48)
                    .background(Color.yard.scrim, in: Capsule())
                    .padding(.top, Spacing.xs)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
                .padding(Spacing.l)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .frame(minHeight: 220)
            .background(fill, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(title). \(message)"))
        .accessibilityAddTraits(.isButton)
    }
}

/// Shop: three tilted product tiles and a heart, drawn in shapes (black on acid).
private struct ShopArtwork: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var lifted = false

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.yard.scrim.opacity(0.12))
                .frame(width: 70, height: 90)
                .rotationEffect(.degrees(-14))
                .offset(x: -36, y: 10)
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.yard.scrim)
                .frame(width: 72, height: 94)
                .overlay {
                    Image(systemName: "bag.fill")
                        .font(.system(size: 26, weight: .bold))
                        .foregroundStyle(Color.yard.acid)
                }
                .rotationEffect(.degrees(lifted ? 6 : 2))
                .offset(x: 10, y: lifted ? -6 : 0)
            Circle()
                .fill(Color.yard.onPhoto)
                .frame(width: 40, height: 40)
                .overlay {
                    Image(systemName: "heart.fill")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(Color.yard.studio)
                }
                .offset(x: 52, y: 40)
        }
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1.6).repeatForever(autoreverses: true)) { lifted = true }
        }
    }
}

/// Sell: a shop sign with a rising sales line, drawn in shapes (white on violet).
private struct SellArtwork: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drawn: CGFloat = 0

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.yard.scrim)
                .frame(width: 120, height: 86)
                .rotationEffect(.degrees(-6))
            SalesLine()
                .trim(from: 0, to: drawn)
                .stroke(Color.yard.acid, style: StrokeStyle(lineWidth: 5, lineCap: .round, lineJoin: .round))
                .frame(width: 92, height: 50)
                .rotationEffect(.degrees(-6))
            Image(systemName: "sparkle")
                .font(.system(size: 26, weight: .bold))
                .foregroundStyle(Color.yard.onPhoto)
                .offset(x: 56, y: -46)
        }
        .onAppear {
            if reduceMotion {
                drawn = 1
            } else {
                withAnimation(.easeOut(duration: 1.1).delay(0.3)) { drawn = 1 }
            }
        }
    }
}

private struct SalesLine: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let pts: [CGPoint] = [
            CGPoint(x: 0, y: 0.85), CGPoint(x: 0.22, y: 0.6), CGPoint(x: 0.42, y: 0.7),
            CGPoint(x: 0.64, y: 0.35), CGPoint(x: 0.8, y: 0.45), CGPoint(x: 1, y: 0.05),
        ]
        for (i, pt) in pts.enumerated() {
            let point = CGPoint(x: rect.minX + pt.x * rect.width, y: rect.minY + pt.y * rect.height)
            if i == 0 { p.move(to: point) } else { p.addLine(to: point) }
        }
        return p
    }
}

#Preview("Role choice — dark") {
    RoleChoiceView()
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("Role choice — light") {
    RoleChoiceView()
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
