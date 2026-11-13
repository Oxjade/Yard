import SwiftUI

/// A compact − qty + stepper for bag rows. Server-driven: it reports the wanted value and the
/// caller updates the cart (`CartStore.setQuantity`).
///
///   QuantityStepper(value: line.qty, range: 0...min(10, line.available),
///                   isBusy: cart.busyVariantIds.contains(line.variantId)) { newQty in
///       Task { do { try await cart.setQuantity(variantId: line.variantId, qty: newQty) } catch { toast.show(error) } }
///   }
/// At the lower bound the minus becomes a trash icon (0 removes the line when `range` starts at 0).
struct QuantityStepper: View {
    let value: Int
    var range: ClosedRange<Int> = 0...10
    var isBusy: Bool = false
    let onChange: (Int) -> Void

    init(value: Int, range: ClosedRange<Int> = 0...10, isBusy: Bool = false, onChange: @escaping (Int) -> Void) {
        self.value = value
        self.range = range
        self.isBusy = isBusy
        self.onChange = onChange
    }

    private var removesOnMinus: Bool { value - 1 <= 0 && range.lowerBound <= 0 }

    var body: some View {
        HStack(spacing: 0) {
            stepButton(systemImage: removesOnMinus ? "trash" : "minus",
                       label: removesOnMinus ? "Remove" : "Decrease",
                       enabled: value - 1 >= range.lowerBound) {
                onChange(value - 1)
            }
            ZStack {
                if isBusy {
                    ProgressView().controlSize(.small).tint(Color.yard.ink)
                } else {
                    Text("\(value)")
                        .font(.yardNumber(15))
                        .foregroundStyle(Color.yard.ink)
                        .contentTransition(.numericText())
                }
            }
            .frame(minWidth: 28)
            stepButton(systemImage: "plus", label: "Increase", enabled: value + 1 <= range.upperBound) {
                onChange(value + 1)
            }
        }
        .padding(3)
        .background(Color.yard.surface2, in: Capsule())
        .disabled(isBusy)
        .sensoryFeedback(.selection, trigger: value)
        .accessibilityElement(children: .contain)
        .accessibilityValue(Text("Quantity \(value)"))
    }

    private func stepButton(systemImage: String, label: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(enabled ? Color.yard.ink : Color.yard.ink3)
                .frame(width: 30, height: 30)
                .background(Color.yard.surface, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(PressableButtonStyle())
        .disabled(!enabled)
        .accessibilityLabel(Text(label))
    }
}

#Preview("Stepper — dark") {
    VStack(spacing: 16) {
        QuantityStepper(value: 1) { _ in }
        QuantityStepper(value: 3, range: 0...3) { _ in }
        QuantityStepper(value: 2, isBusy: true) { _ in }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color.yard.bg)
    .preferredColorScheme(.dark)
}

#Preview("Stepper — light") {
    QuantityStepper(value: 2) { _ in }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.yard.bg)
        .preferredColorScheme(.light)
}
