import SwiftUI
import UIKit

/// "Today" / "Yesterday" / "Wed 4 Nov" between days.
struct InboxDaySeparator: View {
    let label: String

    var body: some View {
        Text(label)
            .font(.yardCaptionEmphasis)
            .foregroundStyle(Color.yard.ink2)
            .padding(.horizontal, Spacing.m)
            .padding(.vertical, Spacing.xs)
            .background(Capsule().fill(Color.yard.surface2))
            .frame(maxWidth: .infinity)
            .padding(.vertical, Spacing.s)
            .accessibilityAddTraits(.isHeader)
    }
}

/// The bubble shape: mine on acid (right), theirs on surface2 (left).
private struct InboxBubble<Content: View>: View {
    let mine: Bool
    @ViewBuilder let content: () -> Content

    var body: some View {
        content()
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(mine ? Color.yard.acid : Color.yard.surface2)
            )
    }
}

/// One message from the server: text, photos, shared product or order, held/removed states.
struct InboxMessageRow: View {
    let message: InboxMessage
    let showsTime: Bool
    let productImage: URL?
    var onOpenPhotos: ([InboxAttachment], Int) -> Void = { _, _ in }

    @Environment(Router.self) private var router

    var body: some View {
        if message.isSystem {
            systemRow
        } else {
            bubbleRow
        }
    }

    private var mine: Bool { message.isMine }

    private var systemRow: some View {
        Text(message.body ?? "")
            .font(.yardCaption)
            .foregroundStyle(Color.yard.ink2)
            .multilineTextAlignment(.center)
            .padding(.horizontal, Spacing.xl)
            .padding(.vertical, Spacing.xs)
            .frame(maxWidth: .infinity)
    }

    private var bubbleRow: some View {
        VStack(alignment: mine ? .trailing : .leading, spacing: Spacing.xs) {
            if message.safetyNotice && !mine {
                Label(InboxFormat.safetyCopy, systemImage: "shield.lefthalf.filled")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink2)
                    .padding(.horizontal, Spacing.m)
                    .padding(.vertical, Spacing.s)
                    .background(RoundedRectangle(cornerRadius: Radius.small, style: .continuous).strokeBorder(Color.yard.line, lineWidth: 1))
            }
            if message.isRemoved {
                InboxBubble(mine: false) {
                    Label("Message removed by Yard.", systemImage: "nosign")
                        .font(.yardCallout.italic())
                        .foregroundStyle(Color.yard.ink3)
                }
            } else {
                if let product = message.product {
                    InboxProductCardView(card: product, imageURL: productImage) {
                        router.push(.product(slug: product.slug))
                    }
                }
                if let order = message.order {
                    InboxOrderCardView(card: order) {
                        router.push(.order(id: order.orderId))
                    }
                }
                if !message.attachments.isEmpty {
                    InboxPhotoGrid(attachments: message.attachments) { index in
                        onOpenPhotos(message.attachments, index)
                    }
                }
                if let text = message.body, !text.isEmpty {
                    InboxBubble(mine: mine) {
                        Text(text)
                            .font(.yardBody)
                            .foregroundStyle(mine ? Color.yard.onAcid : Color.yard.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .opacity(message.isHeld ? 0.6 : 1)
                    .contextMenu {
                        Button {
                            UIPasteboard.general.string = text
                        } label: {
                            Label("Copy", systemImage: "doc.on.doc")
                        }
                    }
                }
            }
            if message.isHeld && mine {
                VStack(alignment: .trailing, spacing: Spacing.xxs) {
                    Tag("Held for review")
                    Text(InboxFormat.heldCopy)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink3)
                        .multilineTextAlignment(.trailing)
                }
            }
            if showsTime, let date = message.date {
                Text(InboxFormat.time(date))
                    .font(.yardMicro)
                    .foregroundStyle(Color.yard.ink3)
                    .monospacedDigit()
                    .padding(.horizontal, Spacing.xs)
            }
        }
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
        .padding(mine ? .leading : .trailing, 56)
        .accessibilityElement(children: .contain)
    }
}

/// A send that the server hasn't confirmed: dimmed bubble with "Sending…", or failed with retry.
struct InboxPendingRow: View {
    let pending: InboxPendingMessage
    let onRetry: () -> Void
    let onDiscard: () -> Void

    var body: some View {
        VStack(alignment: .trailing, spacing: Spacing.xs) {
            if !pending.photos.isEmpty {
                HStack(spacing: Spacing.xs) {
                    ForEach(Array(pending.photos.enumerated()), id: \.offset) { _, data in
                        if let image = UIImage(data: data) {
                            Image(uiImage: image)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 96, height: 120)
                                .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
                        }
                    }
                }
            }
            if !pending.text.isEmpty {
                Text(pending.text)
                    .font(.yardBody)
                    .foregroundStyle(Color.yard.onAcid)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Color.yard.acid))
            }
            if let failure = pending.failedMessage {
                VStack(alignment: .trailing, spacing: Spacing.xs) {
                    Text(failure)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.danger)
                        .multilineTextAlignment(.trailing)
                    HStack(spacing: Spacing.s) {
                        YardButton("Discard", style: .ghost, size: .small, fullWidth: false, action: onDiscard)
                        YardButton("Retry", systemImage: "arrow.clockwise", style: .secondary, size: .small, fullWidth: false, action: onRetry)
                    }
                }
            } else {
                Text("Sending…")
                    .font(.yardMicro)
                    .foregroundStyle(Color.yard.ink3)
            }
        }
        .opacity(pending.isFailed ? 1 : 0.7)
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.leading, 56)
    }
}

/// Photos on a message: one tall, or a 2-column grid.
struct InboxPhotoGrid: View {
    let attachments: [InboxAttachment]
    let onOpen: (Int) -> Void

    private let columns = [GridItem(.flexible(), spacing: 4), GridItem(.flexible(), spacing: 4)]

    var body: some View {
        Group {
            if attachments.count == 1, let a = attachments.first {
                photo(a, index: 0)
                    .frame(width: 220, height: 275)
            } else {
                LazyVGrid(columns: columns, spacing: 4) {
                    ForEach(Array(attachments.enumerated()), id: \.offset) { i, a in
                        photo(a, index: i)
                            .frame(height: 124)
                    }
                }
                .frame(width: 252)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Radius.image, style: .continuous))
    }

    private func photo(_ a: InboxAttachment, index: Int) -> some View {
        Button {
            onOpen(index)
        } label: {
            RemoteImage(url: a.url, contentMode: .fill, maxPixelSize: 800)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .clipped()
                .contentShape(Rectangle())
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityLabel(Text("Open photo \(index + 1) of \(attachments.count)"))
    }
}

/// A shared piece: photo (from the catalogue), name, size, price when shared, View.
struct InboxProductCardView: View {
    let card: InboxProductCard
    let imageURL: URL?
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            VStack(alignment: .leading, spacing: Spacing.s) {
                ZStack {
                    Rectangle().fill(Color.yard.surface2)
                    if let imageURL {
                        RemoteImage(url: imageURL, contentMode: .fill, maxPixelSize: 700)
                    } else {
                        Image(systemName: "tag")
                            .font(.title2)
                            .foregroundStyle(Color.yard.ink3)
                    }
                }
                .frame(width: 216, height: 270)
                .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text(card.name)
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.ink)
                        .lineLimit(1)
                    if let v = card.variantLabel, !v.isEmpty {
                        Text(v)
                            .font(.yardCaption)
                            .foregroundStyle(Color.yard.ink2)
                            .lineLimit(1)
                    }
                    HStack(spacing: Spacing.xs) {
                        Text(card.price.formatted)
                            .font(.yardCaptionEmphasis)
                            .foregroundStyle(Color.yard.ink)
                            .monospacedDigit()
                        Text("price when shared")
                            .font(.yardCaption)
                            .foregroundStyle(Color.yard.ink3)
                    }
                }
                .padding(.horizontal, Spacing.xxs)
            }
            .padding(Spacing.s)
            .frame(width: 232, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: Radius.image, style: .continuous).fill(Color.yard.surface))
            .overlay(RoundedRectangle(cornerRadius: Radius.image, style: .continuous).strokeBorder(Color.yard.line, lineWidth: 1))
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityHint(Text("Opens the product"))
    }
}

/// An order attached to a message: reference, status, placed, items, total, Open order.
struct InboxOrderCardView: View {
    let card: InboxOrderCard
    let onOpen: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            HStack {
                Text(card.reference)
                    .font(.yardBodyEmphasis)
                    .foregroundStyle(Color.yard.ink)
                    .monospacedDigit()
                Spacer(minLength: Spacing.s)
                Tag(InboxFormat.orderStatus(card.status), style: card.status == "delivered" ? .success : .neutral)
            }
            row("Placed", InboxFormat.shortDate(card.placedAt))
            row("Items", String(card.itemCount))
            row("Total", card.total.formatted, emphasis: true)
            YardButton("Open order", style: .secondary, size: .small, action: onOpen)
                .padding(.top, Spacing.xs)
        }
        .padding(Spacing.m)
        .frame(width: 264)
        .background(RoundedRectangle(cornerRadius: Radius.image, style: .continuous).fill(Color.yard.surface))
        .overlay(RoundedRectangle(cornerRadius: Radius.image, style: .continuous).strokeBorder(Color.yard.line, lineWidth: 1))
    }

    private func row(_ title: String, _ value: String, emphasis: Bool = false) -> some View {
        HStack {
            Text(title)
                .font(.yardCaption)
                .foregroundStyle(Color.yard.ink3)
            Spacer()
            Text(value)
                .font(emphasis ? .yardCaptionEmphasis : .yardCaption)
                .foregroundStyle(emphasis ? Color.yard.ink : Color.yard.ink2)
                .monospacedDigit()
        }
    }
}

/// The order this thread is about, pinned under the header.
struct InboxOrderContextBar: View {
    let card: InboxOrderCard
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: Spacing.m) {
                Image(systemName: "shippingbox")
                    .font(.yardBody)
                    .foregroundStyle(Color.yard.ink)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(Color.yard.surface2))
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text("About order \(card.reference)")
                        .font(.yardCaptionEmphasis)
                        .foregroundStyle(Color.yard.ink)
                        .lineLimit(1)
                    Text("\(InboxFormat.orderStatus(card.status)) · \(card.itemCount) \(card.itemCount == 1 ? "item" : "items") · \(card.total.formatted)")
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                        .lineLimit(1)
                }
                Spacer(minLength: Spacing.s)
                Image(systemName: "chevron.right")
                    .font(.yardCaptionEmphasis)
                    .foregroundStyle(Color.yard.ink3)
            }
            .padding(.horizontal, Spacing.m)
            .padding(.vertical, Spacing.s)
            .background(RoundedRectangle(cornerRadius: Radius.small + 4, style: .continuous).fill(Color.yard.surface))
            .overlay(RoundedRectangle(cornerRadius: Radius.small + 4, style: .continuous).strokeBorder(Color.yard.line, lineWidth: 1))
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityHint(Text("Opens the order"))
    }
}

/// Full-screen photo viewer (lightbox) for message photos.
struct InboxPhotoViewer: View {
    let attachments: [InboxAttachment]
    @State var index: Int
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.yard.scrim.ignoresSafeArea()
            TabView(selection: $index) {
                ForEach(Array(attachments.enumerated()), id: \.offset) { i, a in
                    RemoteImage(url: a.url, contentMode: .fit, maxPixelSize: 1600)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .tag(i)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: attachments.count > 1 ? .automatic : .never))
            GlassIconButton(systemImage: "xmark", accessibilityLabel: "Close photo") { dismiss() }
                .padding(Spacing.gutter)
        }
    }
}

/// Bubble-shaped loading placeholders.
struct InboxThreadSkeleton: View {
    var body: some View {
        VStack(spacing: Spacing.m) {
            ForEach(0..<6, id: \.self) { i in
                let mine = i % 3 == 1
                HStack {
                    if mine { Spacer(minLength: 80) }
                    Skeleton(cornerRadius: 20)
                        .frame(width: CGFloat([180, 230, 140, 210, 160, 240][i]), height: CGFloat(i % 2 == 0 ? 44 : 64))
                    if !mine { Spacer(minLength: 80) }
                }
            }
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.top, Spacing.l)
        .frame(maxHeight: .infinity, alignment: .top)
        .accessibilityLabel(Text("Loading messages"))
    }
}
