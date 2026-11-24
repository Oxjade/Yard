import SwiftUI
import PhotosUI
import UIKit

/// The pill composer: photo button (shopper inbox attachments), growing text field, acid send.
/// When the shopper can't send, it shows why instead (blocked, paused, closed…).
/// Yard Support can carry an order as a removable chip ("Get help from Yard"); it goes with the next send.
@MainActor
struct InboxComposer: View {
    let placeholder: String
    let disabledReason: String?
    /// Photos need a conversation or a brand to upload against.
    let allowsPhotos: Bool
    var focus: FocusState<Bool>.Binding
    /// Yard Support: the order attached to the next message, shown as a chip.
    let attachedOrder: SupportOrderChip?
    let onRemoveOrder: () -> Void
    let onSend: (String, [Data]) -> Void

    init(placeholder: String, disabledReason: String?, allowsPhotos: Bool, focus: FocusState<Bool>.Binding, attachedOrder: SupportOrderChip? = nil, onRemoveOrder: @escaping () -> Void = {}, onSend: @escaping (String, [Data]) -> Void) {
        self.placeholder = placeholder
        self.disabledReason = disabledReason
        self.allowsPhotos = allowsPhotos
        self.focus = focus
        self.attachedOrder = attachedOrder
        self.onRemoveOrder = onRemoveOrder
        self.onSend = onSend
    }

    @Environment(ToastCenter.self) private var toast

    @State private var text = ""
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var photos: [Data] = []
    @State private var isPreparing = false
    @State private var sendCount = 0

    private static let maxPhotos = 4
    private static let maxLength = 2000

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canSend: Bool { (!trimmed.isEmpty || !photos.isEmpty || attachedOrder != nil) && !isPreparing && text.count <= Self.maxLength }

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(Color.yard.line).frame(height: 1)
            if let disabledReason {
                HStack(spacing: Spacing.s) {
                    Image(systemName: "lock")
                        .foregroundStyle(Color.yard.ink3)
                    Text(disabledReason)
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.ink2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, Spacing.gutter)
                .padding(.vertical, Spacing.m)
            } else {
                VStack(alignment: .leading, spacing: Spacing.s) {
                    if let order = attachedOrder { orderChip(order) }
                    if !photos.isEmpty || isPreparing { attachmentsRow }
                    inputRow
                    if text.count > Self.maxLength - 200 {
                        Text("\(text.count)/\(Self.maxLength)")
                            .font(.yardMicro)
                            .foregroundStyle(text.count > Self.maxLength ? Color.yard.danger : Color.yard.ink3)
                            .frame(maxWidth: .infinity, alignment: .trailing)
                            .padding(.trailing, Spacing.s)
                    }
                }
                .padding(.horizontal, Spacing.m)
                .padding(.vertical, Spacing.s)
            }
        }
        .background(.ultraThinMaterial)
        .background(Color.yard.bg.opacity(0.6))
        .sensoryFeedback(.impact(weight: .light), trigger: sendCount)
        .onChange(of: pickerItems) { _, items in
            guard !items.isEmpty else { return }
            Task { @MainActor in await loadPhotos(items) }
        }
    }

    private var inputRow: some View {
        HStack(alignment: .bottom, spacing: Spacing.s) {
            if allowsPhotos {
                PhotosPicker(selection: $pickerItems, maxSelectionCount: max(1, Self.maxPhotos - photos.count), matching: .images) {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Color.yard.ink)
                        .frame(width: 40, height: 40)
                        .background(Circle().fill(Color.yard.surface2))
                }
                .disabled(photos.count >= Self.maxPhotos || isPreparing)
                .accessibilityLabel(Text("Add a photo"))
            }
            TextField(placeholder, text: $text, axis: .vertical)
                .font(.yardBody)
                .foregroundStyle(Color.yard.ink)
                .lineLimit(1...5)
                .focused(focus)
                .padding(.horizontal, Spacing.m)
                .padding(.vertical, 10)
                .frame(minHeight: 40)
                .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Color.yard.surface2))
                .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Color.yard.line, lineWidth: 1))
            Button {
                send()
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(canSend ? Color.yard.onAcid : Color.yard.ink3)
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(canSend ? Color.yard.acid : Color.yard.surface2))
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
            .accessibilityLabel(Text("Send message"))
            .animation(Motion.snappy, value: canSend)
        }
    }

    /// "Order YD-…" with a remove button (web composer's order chip).
    private func orderChip(_ order: SupportOrderChip) -> some View {
        HStack(spacing: Spacing.xs) {
            Image(systemName: "shippingbox")
                .font(.yardCaption)
                .foregroundStyle(Color.yard.ink2)
            Text("Order \(order.reference)")
                .font(.yardCaptionEmphasis)
                .foregroundStyle(Color.yard.ink)
                .monospacedDigit()
                .lineLimit(1)
            Button {
                withAnimation(Motion.snappy) { onRemoveOrder() }
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Color.yard.ink2)
                    .frame(width: 24, height: 24)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Remove order \(order.reference)"))
        }
        .padding(.leading, Spacing.m)
        .padding(.trailing, Spacing.xs)
        .padding(.vertical, 2)
        .background(Capsule().fill(Color.yard.surface2))
        .overlay(Capsule().strokeBorder(Color.yard.line, lineWidth: 1))
        .padding(.horizontal, Spacing.xs)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Attached: order \(order.reference)"))
    }

    private var attachmentsRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.s) {
                ForEach(Array(photos.enumerated()), id: \.offset) { i, data in
                    ZStack(alignment: .topTrailing) {
                        if let image = UIImage(data: data) {
                            Image(uiImage: image)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 64, height: 64)
                                .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
                        }
                        Button {
                            withAnimation(Motion.snappy) { _ = photos.remove(at: i) }
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(Color.yard.ink)
                                .frame(width: 22, height: 22)
                                .background(Circle().fill(Color.yard.surface2))
                                .overlay(Circle().strokeBorder(Color.yard.line, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        .offset(x: 6, y: -6)
                        .accessibilityLabel(Text("Remove photo"))
                    }
                    .padding(.top, 6)
                    .padding(.trailing, 6)
                }
                if isPreparing {
                    Skeleton(cornerRadius: Radius.small)
                        .frame(width: 64, height: 64)
                        .padding(.top, 6)
                }
            }
            .padding(.horizontal, Spacing.xs)
        }
    }

    private func loadPhotos(_ items: [PhotosPickerItem]) async {
        isPreparing = true
        defer {
            isPreparing = false
            pickerItems = []
        }
        var skipped = 0
        for item in items {
            guard photos.count < Self.maxPhotos else { break }
            guard let raw = try? await item.loadTransferable(type: Data.self), let jpeg = InboxPhotoPrep.jpeg(from: raw) else {
                skipped += 1
                continue
            }
            photos.append(jpeg)
        }
        if skipped > 0 {
            toast.show(skipped == 1 ? "That photo couldn't be added. Try another." : "Some photos couldn't be added.", style: .error)
        }
    }

    private func send() {
        guard canSend else { return }
        onSend(trimmed, photos)
        text = ""
        photos = []
        sendCount += 1
    }
}
