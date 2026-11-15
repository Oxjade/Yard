import SwiftUI

/// Full-width swipeable photo pager with page dots, an overlay tag (top-left) and a thumbnail
/// strip underneath. Tapping a photo opens `ProductPhotoViewer` at that photo.
@MainActor
struct ProductGallery<Overlay: View>: View {
    let images: [ProductImage]
    @Binding var index: Int
    let onOpen: (Int) -> Void
    let overlayContent: () -> Overlay
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

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
                .sensoryFeedback(.selection, trigger: index)
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
        .yardGlass(Capsule(), onPhoto: true)
        .animation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion), value: index)
        .accessibilityHidden(true)
    }

    private var thumbnails: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Spacing.s) {
                    ForEach(Array(images.enumerated()), id: \.offset) { offset, image in
                        Button {
                            withAnimation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion)) { index = offset }
                        } label: {
                            RemoteImage(url: image.url, contentMode: .fill, maxPixelSize: 200)
                                .frame(width: 56, height: 68)
                                .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))
                                .overlay(
                                    RoundedRectangle(cornerRadius: Radius.small, style: .continuous)
                                        .strokeBorder(offset == index ? Color.yard.ink : Color.yard.line, lineWidth: offset == index ? 2 : 1)
                                )
                                .opacity(offset == index ? 1 : 0.7)
                                .animation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion), value: index)
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
                withAnimation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion)) { proxy.scrollTo(newValue, anchor: .center) }
            }
        }
    }
}

/// Full-screen photo viewer: swipe between photos, pinch or double-tap to zoom, drag to pan when
/// zoomed, swipe down to close.
@MainActor
struct ProductPhotoViewer: View {
    let images: [ProductImage]
    @State private var index: Int
    @State private var dismissOffset: CGFloat = 0
    @State private var isZoomed: Bool = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

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
                            withAnimation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion)) { dismissOffset = 0 }
                        }
                    }
            )

            HStack {
                if images.count > 1 {
                    Text("\(index + 1) / \(images.count)")
                        .font(.yardCaptionEmphasis)
                        .monospacedDigit()
                        .foregroundStyle(Color.yard.onPhoto)
                        .yardNumericTransition(Double(index))
                        .padding(.horizontal, Spacing.m)
                        .padding(.vertical, 6)
                        .yardGlass(Capsule(), onPhoto: true)
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
        .sensoryFeedback(.selection, trigger: index)
        .onChange(of: index) { _, _ in isZoomed = false }
    }
}

/// One photo that zooms (pinch / double-tap toward the tapped point) and pans while zoomed. Pan
/// and pinch overshoot the edges with resistance and settle back with `Motion.spring`; under
/// Reduce Motion they stop at the edge and settle with a short fade.
@MainActor
private struct ProductZoomableImage: View {
    let url: URL?
    @Binding var isZoomed: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    static let maxScale: CGFloat = 5
    static let doubleTapScale: CGFloat = 2.5

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            RemoteImage(url: url, contentMode: .fit, maxPixelSize: 2000)
                .frame(width: size.width, height: size.height)
                .scaleEffect(scale)
                .offset(offset)
                .contentShape(Rectangle())
                .gesture(
                    MagnifyGesture()
                        .onChanged { value in
                            let target = lastScale * value.magnification
                            scale = reduceMotion ? min(max(target, 1), Self.maxScale) : Self.rubberScale(target)
                        }
                        .onEnded { _ in settle(in: size) }
                )
                .gesture(
                    DragGesture()
                        .onChanged { value in
                            let raw = CGSize(width: lastOffset.width + value.translation.width,
                                             height: lastOffset.height + value.translation.height)
                            offset = livePan(raw, in: size)
                        }
                        .onEnded { _ in settle(in: size) },
                    including: scale > 1 ? .all : .subviews
                )
                .onTapGesture(count: 2, coordinateSpace: .local) { location in
                    toggleZoom(at: location, in: size)
                }
        }
        .accessibilityElement()
        .accessibilityAddTraits(.isImage)
        .accessibilityLabel(Text("Photo"))
        .accessibilityHint(Text("Double-tap to zoom"))
    }

    /// Pinch past 1× or 5× gives a little, then settles back.
    static func rubberScale(_ s: CGFloat) -> CGFloat {
        if s < 1 { return 1 - RubberBand.value(1 - s, limit: 0, dimension: 0.25) }
        if s > maxScale { return maxScale + RubberBand.value(s - maxScale, limit: 0, dimension: 1) }
        return s
    }

    /// How far a photo zoomed to `scale` may pan before its edge leaves the screen edge.
    private func limits(scale: CGFloat, in size: CGSize) -> CGSize {
        CGSize(width: max(0, size.width * (scale - 1) / 2), height: max(0, size.height * (scale - 1) / 2))
    }

    private func clamp(_ o: CGSize, scale: CGFloat, in size: CGSize) -> CGSize {
        let l = limits(scale: scale, in: size)
        return CGSize(width: min(l.width, max(-l.width, o.width)), height: min(l.height, max(-l.height, o.height)))
    }

    private func livePan(_ raw: CGSize, in size: CGSize) -> CGSize {
        if reduceMotion { return clamp(raw, scale: scale, in: size) }
        let l = limits(scale: max(1, scale), in: size)
        return CGSize(width: RubberBand.value(raw.width, limit: l.width, dimension: size.width * 0.2),
                      height: RubberBand.value(raw.height, limit: l.height, dimension: size.height * 0.2))
    }

    private func settle(in size: CGSize) {
        let s = min(max(scale, 1), Self.maxScale)
        let o = s <= 1.01 ? CGSize.zero : clamp(offset, scale: s, in: size)
        withAnimation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion)) {
            scale = s <= 1.01 ? 1 : s
            offset = o
        }
        lastScale = s <= 1.01 ? 1 : s
        lastOffset = o
        isZoomed = s > 1.01
    }

    private func toggleZoom(at location: CGPoint, in size: CGSize) {
        withAnimation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion)) {
            if scale > 1.01 {
                scale = 1
                offset = .zero
            } else {
                let s = Self.doubleTapScale
                // Keep the tapped point under the finger.
                let toward = CGSize(width: (size.width / 2 - location.x) * (s - 1),
                                    height: (size.height / 2 - location.y) * (s - 1))
                scale = s
                offset = clamp(toward, scale: s, in: size)
            }
        }
        lastScale = scale
        lastOffset = offset
        isZoomed = scale > 1.01
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
