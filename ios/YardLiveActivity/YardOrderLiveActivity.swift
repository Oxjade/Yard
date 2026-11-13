import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - Order tracking: Lock Screen + Dynamic Island
//
// Layout follows Design/References/03-dynamic-island-sequence.jpg: compact island = logo + ETA,
// expanded = brand / ETA / status, then an acid route card (brand → you with a moving marker)
// with Details and Track buttons. Tapping anywhere else opens the order (`widgetURL`).

struct YardOrderLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: YardOrderActivityAttributes.self) { context in
            OrderLockScreenView(attributes: context.attributes, state: context.state, isStale: context.isStale)
                .activityBackgroundTint(Color.yard.bg)
                .activitySystemActionForegroundColor(Color.yard.ink)
                .widgetURL(YardOrderActivityLink.details(orderId: context.attributes.orderId))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    OrderIslandLeading(attributes: context.attributes)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    OrderIslandTrailing(state: context.state)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.statusLine)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.yard.onPhoto.opacity(0.8))
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    OrderRouteCard(attributes: context.attributes, state: context.state, showsButtons: true)
                        .padding(.top, Spacing.xs)
                }
            } compactLeading: {
                OrderActivityLogo(height: 11)
                    .padding(.leading, Spacing.xxs)
            } compactTrailing: {
                OrderCompactTrailing(state: context.state)
            } minimal: {
                OrderActivityLogo(height: 8)
            }
            .widgetURL(YardOrderActivityLink.details(orderId: context.attributes.orderId))
            .keylineTint(Color.yard.acid)
        }
    }
}

// MARK: - Lock Screen

struct OrderLockScreenView: View {
    let attributes: YardOrderActivityAttributes
    let state: OrderActivityState
    var isStale: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            HStack(alignment: .center, spacing: Spacing.s) {
                OrderActivityLogo(height: 14, color: Color.yard.ink)
                Spacer(minLength: Spacing.s)
                Label(state.step.title, systemImage: state.step.systemImage)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.yard.ink2)
                    .lineLimit(1)
            }

            HStack(alignment: .firstTextBaseline, spacing: Spacing.m) {
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text(state.statusLine)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.yard.ink)
                        .lineLimit(2)
                    Text(isStale ? "Open Yard for the latest update" : attributes.brandName)
                        .font(.system(size: 12))
                        .foregroundStyle(Color.yard.ink2)
                        .lineLimit(1)
                }
                Spacer(minLength: Spacing.s)
                VStack(alignment: .trailing, spacing: Spacing.xxs) {
                    OrderETAFigure(state: state, size: 24, color: Color.yard.ink, alignment: .trailing)
                        .frame(maxWidth: 120, alignment: .trailing)
                    Text(orderETACaption(state))
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Color.yard.ink2)
                        .lineLimit(1)
                }
            }

            OrderRouteCard(attributes: attributes, state: state, showsButtons: false)
        }
        .padding(Spacing.l)
    }
}

// MARK: - Dynamic Island pieces (always on black)

struct OrderIslandLeading: View {
    let attributes: YardOrderActivityAttributes

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            OrderActivityLogo(height: 12)
            Text(attributes.brandName)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Color.yard.onPhoto)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.leading, Spacing.xs)
        .padding(.top, Spacing.xxs)
    }
}

struct OrderIslandTrailing: View {
    let state: OrderActivityState

    var body: some View {
        VStack(alignment: .trailing, spacing: Spacing.xxs) {
            OrderETAFigure(state: state, size: 20, color: Color.yard.acid, alignment: .trailing)
                .frame(maxWidth: 96, alignment: .trailing)
            Text(orderETACaption(state))
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(Color.yard.onPhoto.opacity(0.6))
                .lineLimit(1)
        }
        .padding(.trailing, Spacing.xs)
        .padding(.top, Spacing.xxs)
    }
}

struct OrderCompactTrailing: View {
    let state: OrderActivityState

    var body: some View {
        switch OrderETA.of(state) {
        case .countdown(let eta):
            Text(timerInterval: Date()...max(eta, Date()), countsDown: true)
                .font(.system(size: 13, weight: .semibold).monospacedDigit())
                .foregroundStyle(Color.yard.acid)
                .multilineTextAlignment(.trailing)
                .frame(width: 56, alignment: .trailing)
        case .days(let days, _):
            Text("\(days)d")
                .font(.system(size: 13, weight: .semibold).monospacedDigit())
                .foregroundStyle(Color.yard.acid)
        case .delivered:
            Image(systemName: "checkmark.seal.fill")
                .foregroundStyle(Color.yard.acid)
        case .unknown:
            Image(systemName: state.step.systemImage)
                .foregroundStyle(Color.yard.acid)
        }
    }
}

// MARK: - Previews (fixtures from YardOrderActivityAttributes; previews only)

#Preview("Lock Screen", as: .content, using: YardOrderActivityAttributes.previewAttributes) {
    YardOrderLiveActivity()
} contentStates: {
    YardOrderActivityAttributes.ContentState.previewShipped
    YardOrderActivityAttributes.ContentState.previewOutForDelivery
    YardOrderActivityAttributes.ContentState.previewDelivered
}

#Preview("Island compact", as: .dynamicIsland(.compact), using: YardOrderActivityAttributes.previewAttributes) {
    YardOrderLiveActivity()
} contentStates: {
    YardOrderActivityAttributes.ContentState.previewShipped
    YardOrderActivityAttributes.ContentState.previewOutForDelivery
}

#Preview("Island expanded", as: .dynamicIsland(.expanded), using: YardOrderActivityAttributes.previewAttributes) {
    YardOrderLiveActivity()
} contentStates: {
    YardOrderActivityAttributes.ContentState.previewPacked
    YardOrderActivityAttributes.ContentState.previewShipped
    YardOrderActivityAttributes.ContentState.previewOutForDelivery
}

#Preview("Island minimal", as: .dynamicIsland(.minimal), using: YardOrderActivityAttributes.previewAttributes) {
    YardOrderLiveActivity()
} contentStates: {
    YardOrderActivityAttributes.ContentState.previewShipped
}

#Preview("Lock Screen view — light") {
    OrderLockScreenView(attributes: .previewAttributes, state: .previewShipped)
        .background(Color.yard.bg)
        .preferredColorScheme(.light)
}

#Preview("Lock Screen view — dark") {
    OrderLockScreenView(attributes: .previewAttributes, state: .previewOutForDelivery, isStale: true)
        .background(Color.yard.bg)
        .preferredColorScheme(.dark)
}
