import SwiftUI

/// A pill-shaped segmented control with a sliding selection (reference 07: Status / Details).
///
///   SegmentedPill(selection: $tab, options: [.status, .details]) { $0.title }
///   SegmentedPill(selection: $phase, options: ["live", "upcoming"]) { $0.capitalized }
struct SegmentedPill<Value: Hashable>: View {
    @Binding var selection: Value
    let options: [Value]
    let title: (Value) -> String
    @Namespace private var namespace

    init(selection: Binding<Value>, options: [Value], title: @escaping (Value) -> String) {
        self._selection = selection
        self.options = options
        self.title = title
    }

    var body: some View {
        HStack(spacing: 0) {
            ForEach(options, id: \.self) { option in
                let isSelected = option == selection
                Button {
                    withAnimation(Motion.spring) { selection = option }
                } label: {
                    Text(title(option))
                        .font(.yardCallout.weight(.semibold))
                        .foregroundStyle(isSelected ? Color.yard.ink : Color.yard.ink2)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity)
                        .frame(height: 36)
                        .background {
                            if isSelected {
                                Capsule()
                                    .fill(Color.yard.surface)
                                    .shadow(color: Color.yard.scrim.opacity(0.08), radius: 4, y: 1)
                                    .matchedGeometryEffect(id: "segment", in: namespace)
                            }
                        }
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(isSelected ? .isSelected : [])
            }
        }
        .padding(4)
        .background(Color.yard.surface2, in: Capsule())
        .sensoryFeedback(.selection, trigger: selection)
    }
}

#Preview("Segmented — dark") {
    SegmentedPreview().preferredColorScheme(.dark)
}

#Preview("Segmented — light") {
    SegmentedPreview().preferredColorScheme(.light)
}

private struct SegmentedPreview: View {
    @State private var tab = "Status"
    var body: some View {
        SegmentedPill(selection: $tab, options: ["Status", "Details"]) { $0 }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.yard.bg)
    }
}
