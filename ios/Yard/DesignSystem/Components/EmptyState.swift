import SwiftUI

/// Honest empty and error states, built on `ContentUnavailableView` with Yard's colours.
///
///   EmptyState(title: "Nothing saved yet", message: "Tap the heart on any piece to keep it here.",
///              systemImage: "heart", actionTitle: "Browse", action: { router.select(.home) })
///   EmptyState.error(error) { await load() }       // shows APIError.message + "Try again"
///   EmptyState.signedOut(message: "Sign in to see your orders.") { router.present(.signIn) }
struct EmptyState: View {
    let title: String
    var message: String? = nil
    var systemImage: String = "sparkles"
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    init(title: String, message: String? = nil, systemImage: String = "sparkles", actionTitle: String? = nil, action: (() -> Void)? = nil) {
        self.title = title
        self.message = message
        self.systemImage = systemImage
        self.actionTitle = actionTitle
        self.action = action
    }

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(title)
                    .font(.yardTitle)
                    .foregroundStyle(Color.yard.ink)
            } icon: {
                Image(systemName: systemImage)
                    .foregroundStyle(Color.yard.ink3)
            }
        } description: {
            if let message {
                Text(message)
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
            }
        } actions: {
            if let actionTitle, let action {
                YardButton(actionTitle, style: .secondary, size: .medium, fullWidth: false, action: action)
            }
        }
    }

    /// An error with a retry button. `retry` runs in a Task.
    static func error(_ error: Error, retry: @escaping @MainActor () async -> Void) -> EmptyState {
        EmptyState(
            title: "Couldn't load this",
            message: APIError.message(for: error),
            systemImage: "wifi.exclamationmark",
            actionTitle: "Try again",
            action: { Task { @MainActor in await retry() } }
        )
    }

    /// A message-only error with a retry button.
    static func error(message: String, retry: @escaping @MainActor () async -> Void) -> EmptyState {
        EmptyState(
            title: "Couldn't load this",
            message: message,
            systemImage: "wifi.exclamationmark",
            actionTitle: "Try again",
            action: { Task { @MainActor in await retry() } }
        )
    }

    /// Signed-out gate for shopper-only screens.
    static func signedOut(title: String = "Sign in to Yard", message: String, signIn: @escaping () -> Void) -> EmptyState {
        EmptyState(title: title, message: message, systemImage: "person.crop.circle", actionTitle: "Sign in", action: signIn)
    }
}

#Preview("Empty — dark") {
    VStack {
        EmptyState(title: "Your bag is empty", message: "Pieces you add from any brand land here.", systemImage: "bag", actionTitle: "Start shopping") {}
        EmptyState.error(message: "You're offline. Check your connection and try again.") {}
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.yard.bg)
    .preferredColorScheme(.dark)
}

#Preview("Empty — light") {
    EmptyState.signedOut(message: "Sign in to see your orders.") {}
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.yard.bg)
        .preferredColorScheme(.light)
}
