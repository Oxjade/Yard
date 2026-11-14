import SwiftUI

/// The shopper's conversation with Yard Support (route `.support(orderId:orderReference:)`, also
/// opened by `/inbox?support=1[&order=&orderRef=]` links and the "Yard Support replied"
/// notification). The inbox thread UI over /api/support/…; with an order it opens with that order
/// as a chip above the composer, sent with the next message ("Get help from Yard").
@MainActor
struct SupportConversationView: View {
    let orderId: String?
    let orderReference: String?

    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @State private var model: InboxThreadModel

    init(orderId: String? = nil, orderReference: String? = nil) {
        self.orderId = orderId
        self.orderReference = orderReference
        var chip: SupportOrderChip? = nil
        if let orderId, !orderId.isEmpty {
            let reference = (orderReference?.isEmpty == false) ? (orderReference ?? orderId) : orderId
            chip = SupportOrderChip(orderId: orderId, reference: reference)
        }
        _model = State(initialValue: InboxThreadModel(supportOrder: chip))
    }

    var body: some View {
        if session.isSignedIn {
            InboxThreadScreen(model: model)
        } else {
            Group {
                if session.hasLoaded {
                    EmptyState.signedOut(title: "Yard Support", message: "Sign in to message Yard's team about an order, a payment or your account.") {
                        router.present(.signIn)
                    }
                } else {
                    InboxThreadSkeleton()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.yard.bg.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

/// Yard's mark for Yard Support: the Yard logo (acid) on black, in place of a brand's avatar.
struct InboxSupportMark: View {
    var size: CGFloat = 40

    init(size: CGFloat = 40) {
        self.size = size
    }

    var body: some View {
        ZStack {
            Circle().fill(Color.yard.scrim)
            YardLogo(color: Color.yard.acid)
                .frame(width: size * 0.62)
        }
        .frame(width: size, height: size)
        .overlay(Circle().strokeBorder(Color.yard.line, lineWidth: 1))
        .accessibilityElement()
        .accessibilityLabel(Text("Yard Support"))
    }
}

#Preview("SupportConversationView — dark") {
    NavigationStack { InboxThreadScreen(model: InboxThreadPreviewData.supportModel()) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("SupportConversationView — light") {
    NavigationStack { SupportConversationView(orderId: "mo_1", orderReference: "YD-4821") }
        .yardPreviewEnvironment(signedIn: false)
        .preferredColorScheme(.light)
}
