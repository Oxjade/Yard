import SwiftUI
import UIKit

/// Chips (or colour swatches when the values carry hex codes) for one option axis.
/// Values with no stock for the other chosen options are disabled (struck through), unless the
/// brand is still opening, when every value reads as open (website rule).
@MainActor
struct ProductOptionPicker: View {
    let option: ProductOption
    let model: ProductDetailModel
    var showsHeader: Bool = true
    var showsInvalid: Bool = false
    var onChoose: (String) -> Void = { _ in }

    private var chosen: String? { model.selection[option.name] }
    private var isSize: Bool { ProductDetailModel.isSizeName(option.name) }
    private var hasSwatches: Bool { option.values.contains { $0.hex != nil } }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            if showsHeader {
                HStack(spacing: Spacing.xs) {
                    Text(option.name)
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.ink2)
                    if let chosen {
                        Text(chosen)
                            .font(.yardCallout.weight(.semibold))
                            .foregroundStyle(Color.yard.ink)
                    }
                }
                .padding(.horizontal, Spacing.gutter)
            }
            ChipRow {
                ForEach(option.values, id: \.value) { value in
                    let enabled = isEnabled(value.value)
                    if hasSwatches && !isSize {
                        swatch(value, enabled: enabled)
                    } else {
                        Chip(value.value, isSelected: chosen == value.value, isEnabled: enabled) {
                            choose(value.value)
                        }
                        .accessibilityHint(Text(enabled ? "" : "Sold out"))
                    }
                }
            }
            if showsInvalid && chosen == nil {
                Text(model.isOpening ? "Choose a size to hear when it goes on sale." : "Choose a size to add this to your bag.")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.danger)
                    .padding(.horizontal, Spacing.gutter)
                    .transition(.opacity)
            }
        }
        .sensoryFeedback(.selection, trigger: chosen)
    }

    private func isEnabled(_ value: String) -> Bool {
        if model.isOpening { return true }
        return model.stock(for: value, in: option) > 0
    }

    private func choose(_ value: String) {
        withAnimation(Motion.snappy) {
            model.choose(value, for: option)
        }
        onChoose(value)
    }

    private func swatch(_ value: ProductOption.Value, enabled: Bool) -> some View {
        let selected = chosen == value.value
        return Button {
            choose(value.value)
        } label: {
            HStack(spacing: Spacing.s) {
                Circle()
                    .fill(ProductSwatchColor.color(hex: value.hex) ?? Color.yard.surface2)
                    .frame(width: 18, height: 18)
                    .overlay(Circle().strokeBorder(Color.yard.line, lineWidth: 1))
                Text(value.value)
                    .font(.yardCallout.weight(.semibold))
                    .strikethrough(!enabled, color: Color.yard.ink3)
                    .lineLimit(1)
            }
            .foregroundStyle(enabled ? Color.yard.ink : Color.yard.ink3)
            .padding(.leading, Spacing.s)
            .padding(.trailing, Spacing.l)
            .frame(minHeight: 36)
            .background(Color.yard.surface2, in: Capsule())
            .overlay(Capsule().strokeBorder(selected ? Color.yard.ink : Color.yard.line, lineWidth: selected ? 2 : 1))
            .contentShape(Capsule())
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityLabel(Text(enabled ? value.value : "\(value.value), sold out"))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// A colour swatch's fill comes from the product data (the brand's own hex), not from the theme:
/// it is content, like a photo.
enum ProductSwatchColor {
    static func color(hex: String?) -> Color? {
        guard var s = hex?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
        if s.hasPrefix("#") { s.removeFirst() }
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        return Color(uiColor: UIColor(yardHex: v))
    }
}

/// The "Select a size" sheet: option chips, stock line, quantity and the main action.
@MainActor
struct ProductSizeSheet: View {
    let model: ProductDetailModel
    let isAdding: Bool
    let onAdd: () -> Void
    let onNotify: () -> Void

    @Environment(CartStore.self) private var cart
    @Environment(\.dismiss) private var dismiss
    @State private var showsInvalid: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            YardSheetHeader("Select a size", subtitle: subtitle) { dismiss() }

            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.l) {
                    ForEach(model.otherOptions, id: \.name) { option in
                        ProductOptionPicker(option: option, model: model)
                    }
                    if let size = model.sizeOption {
                        ProductOptionPicker(option: size, model: model, showsHeader: model.otherOptions.isEmpty == false, showsInvalid: showsInvalid) { _ in
                            showsInvalid = false
                        }
                    }
                    ProductStockLineView(model: model)
                        .padding(.horizontal, Spacing.gutter)
                }
                .padding(.vertical, Spacing.xs)
            }
            .scrollBounceBehavior(.basedOnSize)

            actionButton
                .padding(.horizontal, Spacing.gutter)
                .padding(.bottom, Spacing.m)
        }
    }

    private var subtitle: String? {
        guard let p = model.product else { return nil }
        let colour = model.otherOptions.first.flatMap { model.selection[$0.name] }
        return colour.map { "\(p.title), \($0)" } ?? p.title
    }

    @ViewBuilder
    private var actionButton: some View {
        let action = model.action(cart: cart)
        switch action {
        case .opening, .soldOut:
            if let v = model.variant {
                YardButton(model.isWatching(v.id) ? "Stop watching" : "Notify me",
                           systemImage: "bell",
                           style: model.isWatching(v.id) ? .secondary : .primary,
                           isLoading: model.watchBusy) {
                    onNotify()
                }
            } else if action == .opening {
                YardButton("Notify me", systemImage: "bell") {
                    withAnimation(Motion.snappy) { showsInvalid = true }
                }
            } else {
                YardButton("Sold out", style: .secondary) {}
                    .disabled(true)
            }
        case .chooseSize:
            YardButton("Add to bag", systemImage: "bag") {
                withAnimation(Motion.snappy) { showsInvalid = true }
            }
        case .limit:
            YardButton("Add to bag", style: .secondary) {}
                .disabled(true)
        case .ready:
            YardButton("Add to bag", systemImage: "bag", isLoading: isAdding) {
                onAdd()
            }
        }
    }
}

/// "● Only 2 left" (website `StockLine`).
@MainActor
struct ProductStockLineView: View {
    let model: ProductDetailModel

    var body: some View {
        let line = model.stockLine()
        HStack(spacing: Spacing.s) {
            Circle()
                .fill(color(line.tone))
                .frame(width: 6, height: 6)
            Text(line.text)
                .font(.yardCallout)
                .foregroundStyle(line.tone == .low ? Color.yard.ink : Color.yard.ink2)
                .contentTransition(.opacity)
        }
        .animation(Motion.snappy, value: line.text)
    }

    private func color(_ tone: ProductDetailModel.StockTone) -> Color {
        switch tone {
        case .ok: return Color.yard.violet
        case .low: return Color.yard.acid
        case .out: return Color.yard.ink3
        case .muted: return Color.yard.ink3.opacity(0.6)
        }
    }
}
