import SwiftUI

// Small pieces shared by SignInView and WelcomeView (auth folder only).

/// A labelled text field on `surface2` with an error line under it.
struct AuthTextField: View {
    let label: String
    @Binding var text: String
    var error: String? = nil
    var contentType: UITextContentType? = nil
    var keyboard: UIKeyboardType = .default
    var capitalization: TextInputAutocapitalization = .never

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(label)
                .font(.yardCaptionEmphasis)
                .foregroundStyle(Color.yard.ink2)
            TextField("", text: $text)
                .font(.yardBody)
                .foregroundStyle(Color.yard.ink)
                .tint(Color.yard.ink)
                .textContentType(contentType)
                .keyboardType(keyboard)
                .textInputAutocapitalization(capitalization)
                .autocorrectionDisabled(true)
                .padding(.horizontal, 14)
                .frame(height: 50)
                .background(Color.yard.surface2, in: RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Radius.small, style: .continuous)
                        .strokeBorder(error == nil ? Color.yard.line : Color.yard.danger, lineWidth: 1)
                )
                .accessibilityLabel(Text(label))
            AuthFieldError(message: error)
        }
    }
}

/// A password field with a show/hide eye.
struct AuthPasswordField: View {
    let label: String
    @Binding var text: String
    var error: String? = nil
    var isNewPassword: Bool = false
    @Binding var isRevealed: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(label)
                .font(.yardCaptionEmphasis)
                .foregroundStyle(Color.yard.ink2)
            HStack(spacing: Spacing.s) {
                Group {
                    if isRevealed {
                        TextField("", text: $text)
                    } else {
                        SecureField("", text: $text)
                    }
                }
                .font(.yardBody)
                .foregroundStyle(Color.yard.ink)
                .tint(Color.yard.ink)
                .textContentType(isNewPassword ? .newPassword : .password)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
                .accessibilityLabel(Text(label))

                Button {
                    isRevealed.toggle()
                } label: {
                    Image(systemName: isRevealed ? "eye.slash" : "eye")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Color.yard.ink2)
                        .frame(width: 36, height: 36)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(isRevealed ? "Hide password" : "Show password"))
            }
            .padding(.leading, 14)
            .padding(.trailing, Spacing.xs)
            .frame(height: 50)
            .background(Color.yard.surface2, in: RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Radius.small, style: .continuous)
                    .strokeBorder(error == nil ? Color.yard.line : Color.yard.danger, lineWidth: 1)
            )
            AuthFieldError(message: error)
        }
    }
}

/// The red line under a field (nothing when nil).
struct AuthFieldError: View {
    let message: String?

    var body: some View {
        if let message {
            Text(message)
                .font(.yardCaption)
                .foregroundStyle(Color.yard.danger)
                .fixedSize(horizontal: false, vertical: true)
                .transition(.opacity)
        }
    }
}

/// A violet text link ("Forgot password?", "Email me a sign-in link").
struct AuthTextLink: View {
    let title: String
    let action: () -> Void

    init(_ title: String, action: @escaping () -> Void) {
        self.title = title
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.yardCallout.weight(.medium))
                .foregroundStyle(Color.yard.violet)
                .padding(.vertical, Spacing.xs)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// "—— or with email ——".
struct AuthDividerLabel: View {
    let text: String

    var body: some View {
        HStack(spacing: Spacing.m) {
            Rectangle().fill(Color.yard.line).frame(height: 1)
            Text(text)
                .font(.yardCaption)
                .foregroundStyle(Color.yard.ink3)
                .fixedSize()
            Rectangle().fill(Color.yard.line).frame(height: 1)
        }
    }
}

/// The Google "G" (the website's GoogleMark path, 24×24 viewBox), drawn in the current colour.
struct AuthGoogleMark: Shape {
    private static let data = "M21.35 11.1H12v2.98h5.35c-.23 1.4-1.66 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.96S8.78 6.26 12 6.26c1.84 0 3.07.78 3.77 1.45l2.57-2.47C16.73 3.74 14.6 2.8 12 2.8 6.98 2.8 2.9 6.88 2.9 11.9S6.98 21 12 21c5.25 0 8.73-3.69 8.73-8.88 0-.6-.07-1.05-.15-1.5z"
    private static let unit: Path = SVGPathParser.parse(AuthGoogleMark.data)

    func path(in rect: CGRect) -> Path {
        let scale = min(rect.width, rect.height) / 24
        let dx = rect.minX + (rect.width - 24 * scale) / 2
        let dy = rect.minY + (rect.height - 24 * scale) / 2
        return AuthGoogleMark.unit.applying(CGAffineTransform(translationX: dx, y: dy).scaledBy(x: scale, y: scale))
    }
}

/// A "Continue with …" pill (secondary style) with the provider's mark and a loading state.
struct AuthSocialButtonView: View {
    let button: AuthSocialButton
    var isLoading: Bool = false
    let action: () -> Void

    var body: some View {
        Button {
            if !isLoading { action() }
        } label: {
            ZStack {
                HStack(spacing: Spacing.s) {
                    mark
                    Text("Continue with \(button.label)")
                        .lineLimit(1)
                }
                .opacity(isLoading ? 0 : 1)
                if isLoading {
                    ProgressView().tint(Color.yard.ink)
                }
            }
            .font(.yardBodyEmphasis)
            .frame(maxWidth: .infinity)
            .frame(height: YardButton.Size.large.height)
            .padding(.horizontal, Spacing.xl)
            .contentShape(Capsule())
        }
        .buttonStyle(AuthPillButtonStyle(style: .secondary))
        .overlay(Capsule().strokeBorder(Color.yard.line, lineWidth: 1))
        .accessibilityLabel(Text("Continue with \(button.label)"))
    }

    @ViewBuilder
    private var mark: some View {
        switch button.mark {
        case .google:
            AuthGoogleMark()
                .fill(Color.yard.ink)
                .frame(width: 18, height: 18)
        case .apple:
            Image(systemName: "apple.logo")
                .font(.system(size: 17, weight: .medium))
        case .generic:
            Image(systemName: "person.crop.circle")
                .font(.system(size: 17, weight: .medium))
        }
    }
}

/// The pill look of `YardButton` for custom labels (auth-local copy: `YardPillButtonStyle`'s
/// memberwise init is file-private because of its private `@Environment` property).
struct AuthPillButtonStyle: ButtonStyle {
    let style: YardButton.Style

    init(style: YardButton.Style) {
        self.style = style
    }

    func makeBody(configuration: Configuration) -> some View {
        AuthPillBody(configuration: configuration, style: style)
    }

    private struct AuthPillBody: View {
        let configuration: ButtonStyleConfiguration
        let style: YardButton.Style
        @Environment(\.isEnabled) private var isEnabled: Bool

        init(configuration: ButtonStyleConfiguration, style: YardButton.Style) {
            self.configuration = configuration
            self.style = style
        }

        var body: some View {
            configuration.label
                .foregroundStyle(YardButton.foreground(for: style))
                .background(YardButton.background(for: style), in: Capsule())
                .opacity(isEnabled ? 1 : 0.4)
                .scaleEffect(configuration.isPressed ? 0.97 : 1)
                .animation(Motion.snappy, value: configuration.isPressed)
        }
    }
}

/// Local onboarding answers (the website keeps these per browser too: `interests`, `aesthetics`,
/// `onboarded` in its session store). Other features may read them with the same keys.
enum AuthOnboarding {
    /// Bool: the Welcome flow was finished or skipped on this device.
    static let onboardedKey = "yard.onboarded"
    /// String: comma-separated category slugs picked in Welcome.
    static let interestsKey = "yard.interests"
    /// String: comma-separated looks (aesthetics) picked in Welcome.
    static let aestheticsKey = "yard.aesthetics"

    static func split(_ raw: String) -> [String] {
        raw.split(separator: ",").map { String($0) }.filter { !$0.isEmpty }
    }

    static func join(_ values: [String]) -> String {
        values.joined(separator: ",")
    }
}
