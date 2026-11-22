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

            RoleChoiceCard(
                title: "Shop on Yard",
                message: "Find independent brands, follow them and catch their drops.",
                cta: "Start shopping",
                fill: Color.yard.acid,
                ink: Color.yard.onAcid,
                art: .shop
            ) {
                Haptics.impact(.medium)
                onboarded = true
                studio.recordRole(.shop)
            }
            .offset(y: appeared || reduceMotion ? 0 : 60)
            .opacity(appeared ? 1 : 0)

            RoleChoiceCard(
                title: "Sell on Yard",
                message: "Open your shop in about a minute. Yard reviews every brand.",
                cta: "Apply to sell",
                fill: Color.yard.studio,
                ink: Color.yard.onPhoto,
                art: .sell
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

/// One big bold choice card with its animated illustration and a black pill.
struct RoleChoiceCard: View {
    let title: String
    let message: String
    let cta: String
    let fill: Color
    let ink: Color
    let art: YardIllustration.Kind
    /// A fixed illustration moment (snapshots); nil animates.
    var illustrationTime: Double? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: Spacing.s) {
                // The art takes the room above the words (it scales to fit) and never covers them.
                YardIllustration(art, fixedTime: illustrationTime)
                    .frame(maxWidth: 230, minHeight: 84, maxHeight: 170)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
                    .layoutPriority(-1)
                Text(title)
                    .yardDisplay(44)
                    .foregroundStyle(ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
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
            .padding(.horizontal, Spacing.l)
            .padding(.top, Spacing.s)
            .padding(.bottom, Spacing.l)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .frame(minHeight: 250)
            .background(fill, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        }
        .buttonStyle(YardTiltPressStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("\(title). \(message)"))
        .accessibilityAddTraits(.isButton)
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
