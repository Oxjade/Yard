import SwiftUI
import SafariServices

/// The payment provider's hosted page (Paystack / Bachs) in an in-app Safari sheet. Card details
/// are typed there, never in Yard. The provider redirects to the website's confirmation page when
/// done; the checkout polls the server meanwhile and closes this sheet once the payment settles.
/// `onFinish` runs when the shopper taps Done.
struct BagPaymentSafariView: UIViewControllerRepresentable {
    let url: URL
    let onFinish: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onFinish: onFinish)
    }

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let config = SFSafariViewController.Configuration()
        config.entersReaderIfAvailable = false
        config.barCollapsingEnabled = true
        let controller = SFSafariViewController(url: url, configuration: config)
        controller.dismissButtonStyle = .done
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {
        context.coordinator.onFinish = onFinish
    }

    final class Coordinator: NSObject, SFSafariViewControllerDelegate {
        var onFinish: () -> Void

        init(onFinish: @escaping () -> Void) {
            self.onFinish = onFinish
        }

        func safariViewControllerDidFinish(_ controller: SFSafariViewController) {
            onFinish()
        }
    }
}

/// Identifiable wrapper so the payment page can drive `.fullScreenCover(item:)`.
struct BagPaymentPage: Identifiable, Equatable {
    let checkoutId: String
    let url: URL
    var id: String { checkoutId + "|" + url.absoluteString }
}
