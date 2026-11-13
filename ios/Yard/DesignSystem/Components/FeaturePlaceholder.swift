import SwiftUI

/// Temporary body for a feature screen that hasn't been built yet. Feature agents replace the
/// placeholder files (keeping the type name and init) and stop using this.
struct FeaturePlaceholder: View {
    let title: String
    var detail: String? = nil

    init(_ title: String, detail: String? = nil) {
        self.title = title
        self.detail = detail
    }

    var body: some View {
        EmptyState(title: title, message: detail ?? "This screen is on its way.", systemImage: "hammer")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.yard.bg.ignoresSafeArea())
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
    }
}
