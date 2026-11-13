import SwiftUI

/// "Track on Lock Screen" for an order that has shipped. The Orders screen can drop it into the
/// order detail's delivery section:
///
///   LiveActivityTrackButton(orderId: order.id)
///
/// It starts the Live Activity (or stops it when one is running). When Live Activities are off in
/// Settings it says so instead of showing a dead button.
@MainActor
struct LiveActivityTrackButton: View {
    let orderId: String

    @State private var manager: LiveActivityManager = .shared
    @State private var isWorking: Bool = false
    @State private var message: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            if !manager.areActivitiesEnabled {
                Label("Turn on Live Activities for Yard in Settings to track this on your Lock Screen.", systemImage: "lock.iphone")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink2)
            } else if manager.trackedOrderIds.contains(orderId) {
                YardButton("Stop tracking on Lock Screen", systemImage: "xmark.circle", style: .secondary, size: .medium, isLoading: isWorking) {
                    stop()
                }
            } else {
                YardButton("Track on Lock Screen", systemImage: "lock.iphone", style: .primary, size: .medium, isLoading: isWorking) {
                    startTracking()
                }
            }
            if let message {
                Text(message)
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink2)
            }
        }
        .sensoryFeedback(.success, trigger: manager.trackedOrderIds.contains(orderId))
    }

    private func startTracking() {
        isWorking = true
        message = nil
        Task { @MainActor in
            defer { isWorking = false }
            do {
                let order = try await LiveActivityOrder.load(orderId: orderId)
                if order.state == nil || order.isClosed {
                    message = "Tracking starts once the brand ships it."
                } else if order.state?.step == .delivered {
                    message = "This order has been delivered."
                } else if !manager.start(for: order) {
                    message = "Couldn't start tracking. Try again in a moment."
                }
            } catch {
                message = APIError.message(for: error)
            }
        }
    }

    private func stop() {
        isWorking = true
        Task { @MainActor in
            await manager.end(orderId: orderId, immediately: true)
            isWorking = false
        }
    }
}

#Preview("Track button — light") {
    LiveActivityTrackButton(orderId: "ord_preview")
        .padding(Spacing.gutter)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.yard.bg)
        .preferredColorScheme(.light)
}

#Preview("Track button — dark") {
    LiveActivityTrackButton(orderId: "ord_preview")
        .padding(Spacing.gutter)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.yard.bg)
        .preferredColorScheme(.dark)
}
