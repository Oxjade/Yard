import SwiftUI

/// Full-width swipeable photo pager with page dots, an overlay tag (top-left) and a thumbnail
/// strip underneath. Tapping a photo opens `ProductPhotoViewer` at that photo.
struct ProductGallery<Overlay: View>: View {
    let images: [ProductImage]
    @Binding var index: Int
    let onOpen: (Int) -> Void
    let overlayContent: () -> Overlay

    init(images: [ProductImage], index: Binding<Int>, onOpen: @escaping (Int) -> Void, @ViewBuilder overlay: @escaping () -> Overlay) {
        self.images = images
        self._index = index
        self.onOpen = onOpen
        self.overlayContent = overlay
    }

    /// Pager aspect (w/h): the first image's, kept between 3:4 and 1:1; 4:5 when unknown.
    private var aspect: CGFloat {
        let raw = images.first?.aspectRatio ?? 0.8
        return CGFloat(min(max(raw, 0.75), 1.0))
    }

    var body: some View {
        VStack(spacing: Spacing.m) {
            pager
            if images.count > 1 {
                thumbnails
            }
        }
    }

    private var pager: some View {
        ZStack(alignment: .bottom) {
            if images.isEmpty {
                Rectangle()
                    .fill(Color.yard.surface2)
                    .overlay {
                        Image(systemName: "photo")
                            .font(.system(size: 36, weight: .regular))
                            .foregroundStyle(Color.yard.ink3)
                    }
            } else {
                TabView(selection: $index) {
                    ForEach(Array(images.enumerated()), id: \.offset) { offset, image in
                        Button {
                            onOpen(offset)
                        } label: {
                            RemoteImage(url: image.url, contentMode: .fill, maxPixelSize: 1400)
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                                .clipped()
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(image.alt.isEmpty ? "Photo \(offset + 1) of \(images.count)" : image.alt))
                        .accessibilityHint(Text("Opens the photo full screen"))
                        .tag(offset)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
            }

            if images.count > 1 {
                dots
                    .padding(.bottom, Spacing.m)
            }
        }
        .aspectRatio(aspect, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .background(Color.yard.surface2)
        .clipShape(.yardImage)
        .overlay(alignment: .topLeading) {
            overlayContent()
                .padding(Spacing.m)
        }
        .padding(.horizontal, Spacing.s)
    }

    private var dots: some View {
        HStack(spacing: 5) {
            ForEach(0..<images.count, id: \.self) { i in
                Capsule()
                    .fill(Color.yard.onPhoto.opacity(i == index ? 1 : 0.45))
                    .frame(width: i == index ? 18 : 6, height: 6)
            }
        }
        .padding(.horizontal, Spacing.s)
        .padding(.vertical, 6)
        .background(Color.yard.scrim.opacity(0.28), in: Capsule())
        .animation(Motion.snappy, value: index)
        .accessibilityHidden(true)
    }

    private var thumbnails: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.s) {
                    ForEach(Array(images.enumerated()), id: \.offset) { offset, image in
                        Button {
                            withAnimation(Motion.spring) { index = offset }
                        } label: {
                            RemoteImage(url: image.url, contentMode: .fill, maxPixelSize: 200)
                                .frame(width: 56, height: 68)
                                .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
                                .overlay(
                                    RoundedRectangle(cornerRadius: Radius.small, style: .continuous)
                                        .strokeBorder(offset == index ? Color.yard.ink : Color.yard.line, lineWidth: offset == index ? 2 : 1)
                                )
                                .opacity(offset == index ? 1 : 0.7)
                        }
                        .buttonStyle(PressableButtonStyle())
                        .id(offset)
                        .accessibilityLabel(Text("Show photo \(offset + 1)"))
                        .accessibilityAddTraits(offset == index ? .isSelected : [])
                    }
                }
                .padding(.horizontal, Spacing.gutter)
            }
            .onChange(of: index) { _, newValue in
                withAnimation(Motion.spring) { proxy.scrollTo(newValue, anchor: .center) }
            }
        }
    }
}

/// Full-screen photo viewer: swipe between photos, pinch or double-tap to zoom, drag to pan when
/// zoomed, swipe down to close.
struct ProductPhotoViewer: View {
    let images: [ProductImage]
    @State private var index: Int
    @State private var dismissOffset: CGFloat = 0
    @State private var isZoomed: Bool = false
    @Environment(\.dismiss) private var dismiss

    init(images: [ProductImage], startIndex: Int) {
        self.images = images
        self._index = State(initialValue: startIndex)
    }

    private var backgroundOpacity: Double {
        let progress = min(1, abs(dismissOffset) / 300)
        return 1 - progress * 0.7
    }

    var body: some View {
        ZStack(alignment: .top) {
            Color.yard.scrim
                .opacity(backgroundOpacity)
                .ignoresSafeArea()

            TabView(selection: $index) {
                ForEach(Array(images.enumerated()), id: \.offset) { offset, image in
                    ProductZoomableImage(url: image.url, isZoomed: $isZoomed)
                        .tag(offset)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()
            .offset(y: dismissOffset)
            .simultaneousGesture(
                DragGesture(minimumDistance: 20)
                    .onChanged { value in
                        guard !isZoomed else { return }
                        let dx = abs(value.translation.width)
                        let dy = value.translation.height
                        if dy > 0 && dy > dx { dismissOffset = dy }
                    }
                    .onEnded { value in
                        guard !isZoomed else { return }
                        if dismissOffset > 120 || value.predictedEndTranslation.height > 260 {
                            dismiss()
                        } else {
                            withAnimation(Motion.spring) { dismissOffset = 0 }
                        }
                    }
            )

            HStack {
                if images.count > 1 {
                    Text("\(index + 1) / \(images.count)")
                        .font(.yardCaptionEmphasis)
                        .monospacedDigit()
                        .foregroundStyle(Color.yard.onPhoto)
                        .padding(.horizontal, Spacing.m)
                        .padding(.vertical, 6)
                        .background(.ultraThinMaterial, in: Capsule())
                }
                Spacer()
                GlassIconButton(systemImage: "xmark", accessibilityLabel: "Close") {
                    dismiss()
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.s)
            .opacity(dismissOffset > 0 ? 0 : 1)
        }
        .environment(\.colorScheme, .dark)
        .statusBarHidden(true)
        .onChange(of: index) { _, _ in isZoomed = false }
    }
}

/// One photo that zooms (pinch / double-tap) and pans while zoomed.
private struct ProductZoomableImage: View {
    let url: URL?
    @Binding var isZoomed: Bool

    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        RemoteImage(url: url, contentMode: .fit, maxPixelSize: 2000)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .scaleEffect(scale)
            .offset(offset)
            .contentShape(Rectangle())
            .gesture(
                MagnifyGesture()
                    .onChanged { value in
                        scale = min(max(lastScale * value.magnification, 1), 5)
                    }
                    .onEnded { _ in
                        lastScale = scale
                        if scale <= 1.01 { reset() } else { isZoomed = true }
                    }
            )
            .gesture(
                DragGesture()
                    .onChanged { value in
                        offset = CGSize(width: lastOffset.width + value.translation.width,
                                        height: lastOffset.height + value.translation.height)
                    }
                    .onEnded { _ in lastOffset = offset },
                including: scale > 1 ? .all : .subviews
            )
            .onTapGesture(count: 2) {
                withAnimation(Motion.spring) {
                    if scale > 1 {
                        reset()
                    } else {
                        scale = 2.5
                        lastScale = 2.5
                        isZoomed = true
                    }
                }
            }
            .accessibilityAddTraits(.isImage)
            .accessibilityHint(Text("Double-tap to zoom"))
    }

    private func reset() {
        scale = 1
        lastScale = 1
        offset = .zero
        lastOffset = .zero
        isZoomed = false
    }
}

#Preview("Gallery — dark") {
    ProductGalleryPreview()
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("Gallery — light") {
    ProductGalleryPreview()
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}

#Preview("Photo viewer") {
    ProductPhotoViewer(images: PreviewFixtures.products.prefix(3).compactMap { $0.images.first }, startIndex: 0)
}

private struct ProductGalleryPreview: View {
    @State private var index = 0
    var body: some View {
        ScrollView {
            ProductGallery(images: PreviewFixtures.products.prefix(4).compactMap { $0.images.first }, index: $index, onOpen: { _ in }) {
                Tag("New Arrival", style: .acid)
            }
        }
        .background(Color.yard.bg)
    }
}
