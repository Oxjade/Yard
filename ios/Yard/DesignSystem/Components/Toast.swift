import SwiftUI
import Observation

/// A short message at the top of the screen.
struct Toast: Identifiable, Equatable, Sendable {
    enum Style: Sendable, Equatable {
        case info
        case success
        case error
    }

    let id = UUID()
    let message: String
    let style: Style
    /// SF Symbol; defaults per style when nil.
    let systemImage: String?

    init(_ message: String, style: Style = .info, systemImage: String? = nil) {
        self.message = message
        self.style = style
        self.systemImage = systemImage
    }

    var resolvedSystemImage: String {
        if let systemImage { return systemImage }
        switch style {
        case .info: return "info.circle.fill"
        case .success: return "checkmark.circle.fill"
        case .error: return "exclamationmark.triangle.fill"
        }
    }
}

/// Environment-driven toasts. Injected at the root; the root hosts them (`.yardToastHost(_:)`).
///
///   @Environment(ToastCenter.self) private var toast
///   toast.show("Added to your bag", style: .success)
///   toast.show(error)                        // any Error → its user-facing message
@Observable
@MainActor
final class ToastCenter {
    private(set) var current: Toast?
    private var dismissTask: Task<Void, Never>?

    init() {}

    func show(_ message: String, style: Toast.Style = .info, systemImage: String? = nil, duration: TimeInterval = 2.6) {
        show(Toast(message, style: style, systemImage: systemImage), duration: duration)
    }

    func show(_ toast: Toast, duration: TimeInterval = 2.6) {
        dismissTask?.cancel()
        withAnimation(Motion.spring) { current = toast }
        let id = toast.id
        dismissTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(duration * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.dismiss(id: id)
        }
    }

    /// Shows an error's user-facing message (cancellations are ignored).
    func show(_ error: Error) {
        if let api = error as? APIError, api.isCancelled { return }
        show(APIError.message(for: error), style: .error)
    }

    func dismiss() {
        dismissTask?.cancel()
        withAnimation(Motion.spring) { current = nil }
    }

    private func dismiss(id: UUID) {
        guard current?.id == id else { return }
        withAnimation(Motion.spring) { current = nil }
    }
}

/// The toast capsule.
struct ToastView: View {
    let toast: Toast

    private var iconColor: Color {
        switch toast.style {
        case .info: return Color.yard.ink
        case .success: return Color.yard.success
        case .error: return Color.yard.danger
        }
    }

    var body: some View {
        HStack(spacing: Spacing.s) {
            Image(systemName: toast.resolvedSystemImage)
                .foregroundStyle(iconColor)
            Text(toast.message)
                .font(.yardCallout.weight(.semibold))
                .foregroundStyle(Color.yard.ink)
                .multilineTextAlignment(.leading)
                .lineLimit(3)
        }
        .padding(.horizontal, Spacing.l)
        .padding(.vertical, Spacing.m)
        .background(.ultraThinMaterial, in: Capsule())
        .overlay(Capsule().strokeBorder(Color.yard.line, lineWidth: 1))
        .shadow(color: Color.yard.scrim.opacity(0.18), radius: 16, y: 6)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }
}

@MainActor
private struct ToastHostModifier: ViewModifier {
    let center: ToastCenter

    func body(content: Content) -> some View {
        content.overlay(alignment: .top) {
            if let toast = center.current {
                ToastView(toast: toast)
                    .padding(.horizontal, Spacing.gutter)
                    .padding(.top, Spacing.s)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .onTapGesture { center.dismiss() }
                    .id(toast.id)
            }
        }
    }
}

extension View {
    /// Shows `center`'s toasts over this view. The root applies it once; sheets apply it too.
    @MainActor
    func yardToastHost(_ center: ToastCenter) -> some View {
        modifier(ToastHostModifier(center: center))
    }
}

#Preview("Toast — dark") {
    VStack(spacing: 12) {
        ToastView(toast: Toast("Added to your bag", style: .success))
        ToastView(toast: Toast("Only 1 left.", style: .error))
        ToastView(toast: Toast("Reminder set", style: .info, systemImage: "bell.fill"))
    }
    .padding()
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.yard.bg)
    .preferredColorScheme(.dark)
}

#Preview("Toast — light") {
    VStack(spacing: 12) {
        ToastView(toast: Toast("Added to your bag", style: .success))
        ToastView(toast: Toast("Only 1 left.", style: .error))
    }
    .padding()
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.yard.bg)
    .preferredColorScheme(.light)
}
