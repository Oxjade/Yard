import SwiftUI
import UIKit

/// A person's round avatar: their profile photo, or their initials on acid when there is none.
///
/// - `localImage` (an optimistic preview while an upload runs) wins over `photoURL`.
/// - `photoURL` is cookie-scoped (`/api/media/…?as=shopper`); `ImagePipeline` sends the session
///   cookie. While it loads, and if it fails (removed, offline, 404), the initials show: never a
///   grey box. A replaced photo has a new URL, so the old one is never shown from a cache.
/// - The photo fades in over the initials (a plain swap under Reduce Motion).
///
///   PersonAvatar(initials: shopper.initials, photoURL: Config.url(for: shopper.photoSrc), size: 60)
struct PersonAvatar: View {
    let initials: String
    var photoURL: URL?
    var localImage: UIImage?
    var size: CGFloat
    /// Dims the photo (a failed upload shows the previous photo dimmed, as the website).
    var dimmed: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var loaded: UIImage?
    @State private var loadedURL: URL?

    init(initials: String, photoURL: URL?, localImage: UIImage? = nil, size: CGFloat, dimmed: Bool = false) {
        self.initials = initials
        self.photoURL = photoURL
        self.localImage = localImage
        self.size = size
        self.dimmed = dimmed
        let pixels = PersonAvatar.pixelSize(for: size)
        let cached: UIImage? = photoURL.flatMap { ImagePipeline.shared.cachedImage(for: $0, maxPixelSize: pixels) }
        _loaded = State(initialValue: cached)
        _loadedURL = State(initialValue: cached == nil ? nil : photoURL)
    }

    /// Decode at 3× the point size (one size on the server: the uploaded square, ≤1024 px).
    static func pixelSize(for size: CGFloat) -> CGFloat { min(1024, max(64, size * 3)) }

    /// The local preview, else the loaded photo, else (the moment `photoURL` changes, before
    /// `load()` runs) whatever the cache already holds for the new URL, such as the square the
    /// app just uploaded: no flash of initials between the preview and the server photo.
    private var shownImage: UIImage? {
        if let localImage { return localImage }
        guard let photoURL else { return nil }
        if loadedURL == photoURL, let loaded { return loaded }
        return ImagePipeline.shared.cachedImage(for: photoURL, maxPixelSize: PersonAvatar.pixelSize(for: size))
    }

    var body: some View {
        ZStack {
            Circle().fill(Color.yard.acid)
            Text(initials)
                .font(.yardDisplay(max(12, size * 0.4)))
                .foregroundStyle(Color.yard.onAcid)
                .minimumScaleFactor(0.5)
                .lineLimit(1)
                .padding(size * 0.12)
            if let image = shownImage {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: size, height: size)
                    .opacity(dimmed ? 0.6 : 1)
                    .transition(.opacity)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(Color.yard.scrim.opacity(0.08), lineWidth: 1))
        .animation(Motion.resolved(Motion.crossfade, reduceMotion: reduceMotion), value: shownImage)
        .task(id: photoURL) { await load() }
        .accessibilityHidden(true)
    }

    @MainActor
    private func load() async {
        guard let url = photoURL else {
            loaded = nil
            loadedURL = nil
            return
        }
        let pixels = PersonAvatar.pixelSize(for: size)
        if let hit = ImagePipeline.shared.cachedImage(for: url, maxPixelSize: pixels) {
            loaded = hit
            loadedURL = url
            return
        }
        do {
            let image = try await ImagePipeline.shared.image(for: url, maxPixelSize: pixels)
            guard !Task.isCancelled else { return }
            loaded = image
            loadedURL = url
        } catch {
            guard !Task.isCancelled else { return }
            // Removed, replaced, offline: the initials stay.
            loaded = nil
            loadedURL = nil
        }
    }
}

#Preview("PersonAvatar — dark") {
    HStack(spacing: 16) {
        PersonAvatar(initials: "AO", photoURL: nil, size: 60)
        PersonAvatar(initials: "AO", photoURL: URL(string: "https://yardstore.space/does-not-exist.jpg"), size: 44)
        PersonAvatar(initials: "AO", photoURL: nil, size: 28)
    }
    .padding()
    .background(Color.yard.bg)
    .preferredColorScheme(.dark)
}

#Preview("PersonAvatar — light") {
    PersonAvatar(initials: "AO", photoURL: nil, size: 88)
        .padding()
        .background(Color.yard.bg)
        .preferredColorScheme(.light)
}
