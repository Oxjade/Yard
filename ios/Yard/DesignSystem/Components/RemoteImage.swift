import SwiftUI
import UIKit
import ImageIO

/// Loads, downsamples and caches remote images (memory cache + URLCache on disk).
/// Used by `RemoteImage`; call directly to prefetch: `Task { _ = try? await ImagePipeline.shared.image(for: url) }`.
final class ImagePipeline: @unchecked Sendable {
    static let shared = ImagePipeline()

    private let memory = NSCache<NSString, UIImage>()
    private let session: URLSession

    init() {
        memory.countLimit = 400
        memory.totalCostLimit = 120 * 1024 * 1024
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(memoryCapacity: 32 * 1024 * 1024, diskCapacity: 300 * 1024 * 1024)
        config.requestCachePolicy = .returnCacheDataElseLoad
        config.timeoutIntervalForRequest = 30
        config.httpCookieStorage = HTTPCookieStorage.shared
        session = URLSession(configuration: config)
    }

    private func key(_ url: URL, _ maxPixelSize: CGFloat) -> NSString {
        "\(url.absoluteString)#\(Int(maxPixelSize))" as NSString
    }

    /// A decoded image already in memory, if any (synchronous; for first paint without flicker).
    func cachedImage(for url: URL, maxPixelSize: CGFloat = 1200) -> UIImage? {
        memory.object(forKey: key(url, maxPixelSize))
    }

    /// Fetches (or returns cached) and downsamples so the longest side is at most `maxPixelSize` pixels.
    func image(for url: URL, maxPixelSize: CGFloat = 1200) async throws -> UIImage {
        let cacheKey = key(url, maxPixelSize)
        if let hit = memory.object(forKey: cacheKey) { return hit }
        var request = URLRequest(url: url)
        request.setValue("1", forHTTPHeaderField: "X-Yard-Client")
        let (data, response) = try await session.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw URLError(.badServerResponse)
        }
        guard let image = ImagePipeline.downsample(data: data, maxPixelSize: maxPixelSize) else {
            throw URLError(.cannotDecodeContentData)
        }
        let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
        memory.setObject(image, forKey: cacheKey, cost: cost)
        return image
    }

    /// ImageIO thumbnailing: decodes straight to the target size (low memory for long grids).
    static func downsample(data: Data, maxPixelSize: CGFloat) -> UIImage? {
        let sourceOptions: [CFString: Any] = [kCGImageSourceShouldCache: false]
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions as CFDictionary) else { return nil }
        let thumbOptions: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: max(1, maxPixelSize),
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbOptions as CFDictionary) else { return nil }
        return UIImage(cgImage: cg)
    }
}

/// An async remote image: shimmer while loading, fade-in on arrival, `placeholder` on failure.
/// It fills the space it is given (like `Color.clear`), so size it from outside:
///
///   RemoteImage(url: product.coverURL)
///       .aspectRatio(product.tileAspectRatio, contentMode: .fit)    // tile
///       .clipShape(.yardImage)
///   RemoteImage(path: brand.logoSrc, contentMode: .fit).frame(width: 80, height: 80)
///   RemoteImage(url: url) { Image(systemName: "photo") }            // custom failure placeholder
///
/// `maxPixelSize` caps the decoded size (pixels, longest side): ~700 for grid tiles, 1600 for
/// full-screen photos.
struct RemoteImage<Placeholder: View>: View {
    let url: URL?
    var contentMode: ContentMode = .fill
    var maxPixelSize: CGFloat = 1200
    let placeholder: () -> Placeholder

    @State private var image: UIImage?
    @State private var failed: Bool = false

    init(url: URL?, contentMode: ContentMode = .fill, maxPixelSize: CGFloat = 1200, @ViewBuilder placeholder: @escaping () -> Placeholder) {
        self.url = url
        self.contentMode = contentMode
        self.maxPixelSize = maxPixelSize
        self.placeholder = placeholder
        let cached: UIImage? = url.flatMap { ImagePipeline.shared.cachedImage(for: $0, maxPixelSize: maxPixelSize) }
        self._image = State(initialValue: cached)
    }

    var body: some View {
        Color.clear
            .overlay {
                ZStack {
                    if let image {
                        Image(uiImage: image)
                            .resizable()
                            .aspectRatio(contentMode: contentMode)
                            .transition(.opacity)
                    } else if failed || url == nil {
                        ZStack {
                            Color.yard.surface2
                            placeholder()
                        }
                    } else {
                        Skeleton(cornerRadius: 0)
                    }
                }
            }
            .clipped()
            .task(id: url) {
                await load()
            }
            .accessibilityHidden(true)
    }

    private func load() async {
        guard let url else { return }
        if let cached = ImagePipeline.shared.cachedImage(for: url, maxPixelSize: maxPixelSize) {
            image = cached
            return
        }
        image = nil
        failed = false
        do {
            let loaded = try await ImagePipeline.shared.image(for: url, maxPixelSize: maxPixelSize)
            guard !Task.isCancelled else { return }
            withAnimation(Motion.fade) { image = loaded }
        } catch {
            guard !Task.isCancelled else { return }
            failed = true
        }
    }
}

/// The default failure placeholder: a muted photo glyph.
struct RemoteImageFallback: View {
    var body: some View {
        Image(systemName: "photo")
            .font(.system(size: 20, weight: .regular))
            .foregroundStyle(Color.yard.ink3)
    }
}

extension RemoteImage where Placeholder == RemoteImageFallback {
    init(url: URL?, contentMode: ContentMode = .fill, maxPixelSize: CGFloat = 1200) {
        self.init(url: url, contentMode: contentMode, maxPixelSize: maxPixelSize) { RemoteImageFallback() }
    }

    /// Resolves an API media path (`/api/media/…`) with `Config.url(for:)`.
    init(path: String?, contentMode: ContentMode = .fill, maxPixelSize: CGFloat = 1200) {
        self.init(url: Config.url(for: path), contentMode: contentMode, maxPixelSize: maxPixelSize) { RemoteImageFallback() }
    }
}

#Preview("RemoteImage — dark") {
    VStack(spacing: 12) {
        RemoteImage(url: nil)
            .aspectRatio(0.8, contentMode: .fit)
            .clipShape(.yardImage)
        RemoteImage(url: URL(string: "https://yardstore.space/does-not-exist.jpg"))
            .frame(height: 120)
            .clipShape(.yardImage)
    }
    .padding()
    .background(Color.yard.bg)
    .preferredColorScheme(.dark)
}

#Preview("RemoteImage — light") {
    RemoteImage(url: nil)
        .aspectRatio(1, contentMode: .fit)
        .clipShape(.yardImage)
        .padding()
        .background(Color.yard.bg)
        .preferredColorScheme(.light)
}
