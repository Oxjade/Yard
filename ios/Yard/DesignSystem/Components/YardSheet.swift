import SwiftUI

/// Sheet styling: Yard background, 28pt corners, visible grabber, detents.
///
///   .sheet(isPresented: $showSizes) {
///       SizePicker(…).yardSheet(detents: [.medium])
///   }
/// Inside, use `YardSheetHeader("Choose size") { dismiss() }` for a consistent title row.
extension View {
    func yardSheet(detents: Set<PresentationDetent> = [.medium, .large], showsGrabber: Bool = true) -> some View {
        self
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .background(Color.yard.bg.ignoresSafeArea())
            .presentationDetents(detents)
            .presentationDragIndicator(showsGrabber ? .visible : .hidden)
            .presentationCornerRadius(Radius.sheet)
            .presentationBackground(Color.yard.bg)
    }
}

/// Title row for sheets: title on the left, a glass close button on the right.
struct YardSheetHeader: View {
    let title: String
    var subtitle: String? = nil
    let onClose: () -> Void

    init(_ title: String, subtitle: String? = nil, onClose: @escaping () -> Void) {
        self.title = title
        self.subtitle = subtitle
        self.onClose = onClose
    }

    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.yardTitle)
                    .foregroundStyle(Color.yard.ink)
                if let subtitle {
                    Text(subtitle)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                }
            }
            Spacer()
            GlassIconButton(systemImage: "xmark", accessibilityLabel: "Close", size: 34, action: onClose)
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.top, Spacing.xl)
        .padding(.bottom, Spacing.s)
    }
}

#Preview("Sheet — dark") {
    Color.yard.bg
        .sheet(isPresented: .constant(true)) {
            VStack {
                YardSheetHeader("Choose size", subtitle: "Fits true to size") {}
                Spacer()
            }
            .yardSheet(detents: [.medium])
        }
        .preferredColorScheme(.dark)
}

#Preview("Sheet — light") {
    Color.yard.bg
        .sheet(isPresented: .constant(true)) {
            VStack {
                YardSheetHeader("Filters") {}
                Spacer()
            }
            .yardSheet()
        }
        .preferredColorScheme(.light)
}
