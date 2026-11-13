import SwiftUI

/// You › Settings › Appearance: System / Light / Dark. Writes `@AppStorage("appearance")`;
/// YardApp applies it with `.preferredColorScheme` at the root.
struct AppearanceView: View {
    @AppStorage(AppearancePreference.storageKey) private var appearance: String = AppearancePreference.system.rawValue

    init() {}

    private var selection: AppearancePreference {
        AppearancePreference(rawValue: appearance) ?? .system
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                HStack(spacing: Spacing.m) {
                    ForEach(AppearancePreference.allCases) { option in
                        AppearanceSwatch(option: option, isSelected: option == selection) {
                            withAnimation(Motion.snappy) { appearance = option.rawValue }
                        }
                    }
                }

                YouSettingsGroup("Theme", footer: "System follows your iPhone's Light and Dark setting.") {
                    ForEach(AppearancePreference.allCases) { option in
                        Button {
                            withAnimation(Motion.snappy) { appearance = option.rawValue }
                        } label: {
                            SettingsRow(option.title, systemImage: option.systemImage) {
                                if option == selection {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 15, weight: .semibold))
                                        .foregroundStyle(Color.yard.ink)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(option == selection ? .isSelected : [])
                    }
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.m)
            .padding(.bottom, Spacing.xxl)
        }
        .yardScreenBackground()
        .navigationTitle("Appearance")
        .navigationBarTitleDisplayMode(.inline)
        .sensoryFeedback(.selection, trigger: appearance)
    }
}

/// A small phone-shaped preview of each appearance, drawn with fixed scheme tokens.
private struct AppearanceSwatch: View {
    let option: AppearancePreference
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: Spacing.s) {
                preview
                    .frame(height: 120)
                    .overlay(
                        RoundedRectangle(cornerRadius: Radius.small, style: .continuous)
                            .strokeBorder(isSelected ? Color.yard.acid : Color.yard.line, lineWidth: isSelected ? 3 : 1)
                    )
                Text(option.title)
                    .font(.yardCaptionEmphasis)
                    .foregroundStyle(isSelected ? Color.yard.ink : Color.yard.ink2)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityLabel(Text(option.title))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    @ViewBuilder
    private var preview: some View {
        switch option {
        case .light:
            mini.environment(\.colorScheme, .light)
        case .dark:
            mini.environment(\.colorScheme, .dark)
        case .system:
            HStack(spacing: 0) {
                mini.environment(\.colorScheme, .light)
                mini.environment(\.colorScheme, .dark)
            }
            .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
        }
    }

    private var mini: some View {
        AppearanceMiniScreen()
    }
}

/// The mini screen inside a swatch; its tokens resolve against the injected colour scheme.
private struct AppearanceMiniScreen: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(Color.yard.ink)
                .frame(width: 34, height: 6)
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(Color.yard.surface)
                .frame(height: 30)
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(Color.yard.surface)
                .frame(height: 30)
            Capsule()
                .fill(Color.yard.acid)
                .frame(width: 30, height: 8)
        }
        .padding(10)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.yard.bg)
        .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
    }
}

#Preview("AppearanceView — dark") {
    NavigationStack { AppearanceView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("AppearanceView — light") {
    NavigationStack { AppearanceView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
