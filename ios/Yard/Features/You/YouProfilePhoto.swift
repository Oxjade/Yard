import SwiftUI
import UIKit
import ImageIO
import Observation

// Settings › Your details: the profile photo (docs/APP.md › Profile photo; web
// src/components/market/account/account-photo.tsx and src/lib/media/photo-crop.ts).
//   POST   /api/account/photo?as=shopper   multipart/form-data, one part `file` → { account } (adds or replaces)
//   DELETE /api/account/photo?as=shopper                                   → { account } with photo null
// The person picks a photo (library or camera), positions it in a square (drag + pinch), and the
// app uploads the square as a JPEG of at most 1024 × 1024 (quality 0.9; the re-encode drops EXIF
// and GPS). The new photo shows at once while it uploads; on failure the old one comes back with
// the reason and, when sending again could work, Try again.

// MARK: - Crop geometry

/// Square crop geometry, a port of the website's `photo-crop.ts` (same numbers, same rules).
/// The crop screen shows the photo inside a square frame `frame` points wide. At zoom 1 the photo
/// just covers the frame (its short side fills it); `offset` is the photo's centre relative to
/// the frame's centre, in frame points.
enum ProfilePhotoCrop {
    static let minZoom: CGFloat = 1
    static let maxZoom: CGFloat = 4
    /// The longest side Yard uploads, and the shortest side the server takes.
    static let outputMax: Int = 1024
    static let minSide: CGFloat = 64
    /// The server's hard limit on a side (the app never sends more than `outputMax`).
    static let maxSide: CGFloat = 8000
    static let jpegQuality: CGFloat = 0.9
    /// Pixels kept in memory for cropping (more than enough for a 1024 px output at zoom 4).
    static let workingMax: CGFloat = 4096

    static func clampZoom(_ z: CGFloat) -> CGFloat {
        guard z.isFinite else { return minZoom }
        return min(maxZoom, max(minZoom, z))
    }

    /// Image pixels → frame points at this zoom.
    static func displayScale(image: CGSize, frame: CGFloat, zoom: CGFloat) -> CGFloat {
        let short = min(image.width, image.height)
        guard short > 0, frame > 0 else { return 1 }
        return (frame / short) * clampZoom(zoom)
    }

    /// How far the photo's centre may move from the frame's centre on each axis (frame points).
    static func maxOffset(image: CGSize, frame: CGFloat, zoom: CGFloat) -> CGSize {
        let s = displayScale(image: image, frame: frame, zoom: zoom)
        return CGSize(width: max(0, (image.width * s - frame) / 2), height: max(0, (image.height * s - frame) / 2))
    }

    /// Keeps the frame covered: the photo's edge never moves inside the frame.
    static func clampOffset(image: CGSize, frame: CGFloat, zoom: CGFloat, offset: CGSize) -> CGSize {
        let m = maxOffset(image: image, frame: frame, zoom: zoom)
        func c(_ v: CGFloat, _ limit: CGFloat) -> CGFloat {
            guard v.isFinite else { return 0 }
            let r = min(limit, max(-limit, v))
            return r == 0 ? 0 : r   // no -0
        }
        return CGSize(width: c(offset.width, m.width), height: c(offset.height, m.height))
    }

    /// The square of the original image the frame shows, in image pixels.
    static func sourceSquare(image: CGSize, frame: CGFloat, zoom: CGFloat, offset: CGSize) -> CGRect {
        let s = displayScale(image: image, frame: frame, zoom: zoom)
        let o = clampOffset(image: image, frame: frame, zoom: zoom, offset: offset)
        let size = min(frame / s, image.width, image.height)
        let cx = image.width / 2 - o.width / s
        let cy = image.height / 2 - o.height / s
        let sx = min(image.width - size, max(0, cx - size / 2))
        let sy = min(image.height - size, max(0, cy - size / 2))
        return CGRect(x: sx, y: sy, width: size, height: size)
    }

    /// The uploaded square's side: the cropped area, never scaled up, at most `outputMax`.
    static func outputSide(_ sourceSize: CGFloat) -> Int {
        guard sourceSize.isFinite else { return 1 }
        return max(1, min(outputMax, Int(sourceSize.rounded())))
    }

    /// Zooming keeps the point under the frame's centre where it is: the offset scales with the
    /// zoom change, then is clamped for the new zoom.
    static func zoomTo(image: CGSize, frame: CGFloat, fromZoom: CGFloat, fromOffset: CGSize, nextZoom: CGFloat) -> (zoom: CGFloat, offset: CGSize) {
        let zoom = clampZoom(nextZoom)
        let k = zoom / clampZoom(fromZoom)
        let scaled = CGSize(width: fromOffset.width * k, height: fromOffset.height * k)
        return (zoom, clampOffset(image: image, frame: frame, zoom: zoom, offset: scaled))
    }

    /// UIScrollView-style resistance past a limit: free inside ±`limit`, then each extra point
    /// moves less, never more than `dimension` past the edge. Drag and pinch overshoot with it,
    /// then settle back.
    static func rubberBand(_ value: CGFloat, limit: CGFloat, dimension: CGFloat) -> CGFloat {
        RubberBand.value(value, limit: limit, dimension: dimension)
    }

    /// A pinch past the zoom range gives a little (down to ~0.85×, up to ~4.6×), then settles back.
    static func rubberZoom(_ z: CGFloat) -> CGFloat {
        guard z.isFinite else { return minZoom }
        if z < minZoom { return minZoom - rubberBand(minZoom - z, limit: 0, dimension: 0.15) }
        if z > maxZoom { return maxZoom + rubberBand(z - maxZoom, limit: 0, dimension: 0.6) }
        return z
    }

    /// Draws the cropped square as a JPEG of at most `outputMax` px (no metadata: a fresh encode).
    /// `image` must be upright at scale 1 (see `ProfilePhotoPrep`).
    static func renderJPEG(_ image: UIImage, frame: CGFloat, zoom: CGFloat, offset: CGSize) -> Data? {
        let size = image.size
        guard size.width >= 1, size.height >= 1 else { return nil }
        let square = sourceSquare(image: size, frame: frame, zoom: zoom, offset: offset)
        let side = outputSide(square.width)
        let k = CGFloat(side) / square.width
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format)
        let jpeg = renderer.jpegData(withCompressionQuality: jpegQuality) { ctx in
            UIColor(yardHex: 0x080808).setFill()
            ctx.fill(CGRect(x: 0, y: 0, width: side, height: side))
            image.draw(in: CGRect(x: -square.minX * k, y: -square.minY * k, width: size.width * k, height: size.height * k))
        }
        return jpeg.isEmpty ? nil : jpeg
    }
}

// MARK: - Preparing a picked photo

/// Turns what the picker or camera gave into an upright, scale-1 `UIImage` small enough to crop.
/// HEIC, JPEG, PNG and WebP all decode on the device (ImageIO), so the server only ever gets a JPEG.
enum ProfilePhotoPrep {
    enum Problem: Error, Equatable {
        case unreadable
        case tooSmall

        /// The website's copy.
        var message: String {
            switch self {
            case .unreadable: return "This photo couldn't be read. Try another one."
            case .tooSmall: return "This photo is smaller than 64 px on a side. Use a larger one."
            }
        }
    }

    /// From file bytes (library). Orientation applied; longest side at most `workingMax`.
    static func image(from data: Data) -> Result<UIImage, Problem> {
        guard !data.isEmpty,
              let image = ImagePipeline.downsample(data: data, maxPixelSize: ProfilePhotoCrop.workingMax) else {
            return .failure(.unreadable)
        }
        return check(normalized(image))
    }

    /// From the camera (a `UIImage` with an orientation flag).
    static func image(from picked: UIImage) -> Result<UIImage, Problem> {
        check(normalized(picked))
    }

    static func check(_ image: UIImage) -> Result<UIImage, Problem> {
        if image.size.width < 1 || image.size.height < 1 { return .failure(.unreadable) }
        if min(image.size.width, image.size.height) < ProfilePhotoCrop.minSide { return .failure(.tooSmall) }
        return .success(image)
    }

    /// Redraws upright at scale 1 (pixel size = point size), capped at `workingMax`.
    static func normalized(_ image: UIImage) -> UIImage {
        let pixelW = image.size.width * image.scale
        let pixelH = image.size.height * image.scale
        guard pixelW >= 1, pixelH >= 1 else { return image }
        let k = min(1, ProfilePhotoCrop.workingMax / max(pixelW, pixelH))
        if image.imageOrientation == .up && image.scale == 1 && k == 1 { return image }
        let target = CGSize(width: (pixelW * k).rounded(), height: (pixelH * k).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
    }
}

// MARK: - API

/// A failed photo request: the API error plus the server's `Retry-After` (seconds) on a 429.
struct ProfilePhotoFailure: Error, Equatable, Sendable {
    let api: APIError
    let retryAfter: Int?
}

enum ProfilePhotoAPI {
    static let path = "/api/account/photo"
    static let query: [URLQueryItem] = [URLQueryItem(name: "as", value: "shopper")]

    /// Exactly one part named `file` and nothing else (the server refuses extra fields).
    static func multipartBody(jpeg: Data, boundary: String) -> Data {
        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"photo.jpg\"\r\n".utf8))
        body.append(Data("Content-Type: image/jpeg\r\n\r\n".utf8))
        body.append(jpeg)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        return body
    }

    /// POST with the shared client's headers (`X-Yard-Client`, `Origin`), a multipart content type
    /// and an explicit `Content-Length` (the server answers 411 to chunked uploads).
    static func uploadRequest(jpeg: Data, boundary: String = "YardBoundary-\(UUID().uuidString)") throws -> (request: URLRequest, body: Data) {
        var request = try APIClient.shared.makeRequest(.post, path, query: query, body: nil)
        let body = multipartBody(jpeg: jpeg, boundary: boundary)
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue(String(body.count), forHTTPHeaderField: "Content-Length")
        request.timeoutInterval = 90
        return (request, body)
    }

    /// Uploads the square; `progress` gets 0…1 as the body is sent (on the main actor).
    static func upload(jpeg: Data, progress: @escaping @MainActor (Double) -> Void) async throws -> YouAccount {
        let built: (request: URLRequest, body: Data)
        do {
            built = try uploadRequest(jpeg: jpeg)
        } catch let api as APIError {
            throw ProfilePhotoFailure(api: api, retryAfter: nil)
        }
        let delegate = ProfilePhotoUploadDelegate(progress: progress)
        let result: (Data, URLResponse)
        do {
            result = try await APIClient.shared.session.upload(for: built.request, from: built.body, delegate: delegate)
        } catch {
            throw ProfilePhotoFailure(api: APIError.network(error), retryAfter: nil)
        }
        return try decode(result)
    }

    static func remove() async throws -> YouAccount {
        let request: URLRequest
        do {
            request = try APIClient.shared.makeRequest(.delete, path, query: query, body: nil)
        } catch let api as APIError {
            throw ProfilePhotoFailure(api: api, retryAfter: nil)
        }
        let result: (Data, URLResponse)
        do {
            result = try await APIClient.shared.session.data(for: request)
        } catch {
            throw ProfilePhotoFailure(api: APIError.network(error), retryAfter: nil)
        }
        return try decode(result)
    }

    private static func decode(_ result: (Data, URLResponse)) throws -> YouAccount {
        guard let http = result.1 as? HTTPURLResponse else {
            throw ProfilePhotoFailure(api: APIError(status: 0, code: "network", message: "We couldn't reach Yard. Try again."), retryAfter: nil)
        }
        guard (200..<300).contains(http.statusCode) else {
            let api = APIClient.error(status: http.statusCode, data: result.0)
            throw ProfilePhotoFailure(api: api, retryAfter: retryAfter(http.value(forHTTPHeaderField: "Retry-After")))
        }
        do {
            return try APIClient.shared.decoder.decode(YouAccountResponse.self, from: result.0).account
        } catch {
            throw ProfilePhotoFailure(api: APIError.decoding(error), retryAfter: nil)
        }
    }

    /// `Retry-After` in seconds (the server sends whole seconds).
    static func retryAfter(_ header: String?) -> Int? {
        guard let raw = header?.trimmingCharacters(in: .whitespaces), let n = Int(raw), n > 0 else { return nil }
        return n
    }
}

/// Reports upload progress for one task.
private final class ProfilePhotoUploadDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let progress: @MainActor (Double) -> Void

    init(progress: @escaping @MainActor (Double) -> Void) {
        self.progress = progress
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard totalBytesExpectedToSend > 0 else { return }
        let fraction = min(1, max(0, Double(totalBytesSent) / Double(totalBytesExpectedToSend)))
        let report = progress
        Task { @MainActor in report(fraction) }
    }
}

// MARK: - Copy

enum ProfilePhotoCopy {
    static let footer = "Shows to brands you message or buy from."
    static let demo = "Demo accounts can't change their photo."
    static let saved = "Photo saved"
    static let removed = "Photo removed"
    static let uploadFallback = "Your photo wasn't saved. Try again."
    static let removeFallback = "Your photo wasn't removed. Try again."
    static let cameraDenied = "Yard can't use the camera. Allow it in Settings › Yard › Camera."
    static let renderFailed = "This photo couldn't be prepared. Try another one."

    /// The website's `uploadError`: its own sentences for 413 / 415 / 429, else the server's message.
    static func uploadError(_ failure: ProfilePhotoFailure) -> String {
        let api = failure.api
        switch api.code {
        case "too_large": return "Photos can be up to 10 MB."
        case "unsupported_type": return "Yard couldn't read this as a JPEG, PNG or WebP photo. Try another one."
        case "rate_limited": return "You've changed your photo a lot. Try again in \(formatWait(failure.retryAfter ?? 600))."
        default: break
        }
        if api.status == 413 { return "Photos can be up to 10 MB." }
        if api.status == 415 { return "Yard couldn't read this as a JPEG, PNG or WebP photo. Try another one." }
        if api.status == 429 { return "You've changed your photo a lot. Try again in \(formatWait(failure.retryAfter ?? 600))." }
        if api.status == 401 { return "Sign in again to change your photo." }
        if api.status == -1 || api.message.isEmpty { return uploadFallback }
        return api.message
    }

    static func removeError(_ failure: ProfilePhotoFailure) -> String {
        let api = failure.api
        if api.status == 429 { return "You've removed your photo a lot. Try again in \(formatWait(failure.retryAfter ?? 600))." }
        if api.status == 401 { return "Sign in again to change your photo." }
        if api.status == -1 || api.message.isEmpty { return removeFallback }
        return api.message
    }

    /// The website's retry rule: sending again could work offline, when rate limited, or on a 5xx.
    static func isRetryable(_ failure: ProfilePhotoFailure) -> Bool {
        let s = failure.api.status
        return s == 0 || s == 429 || s >= 500
    }

    /// "40 s", "3 min", "2 h" (web `formatWait`).
    static func formatWait(_ seconds: Int) -> String {
        if seconds < 90 { return "\(max(1, seconds)) s" }
        if seconds < 5400 { return "\(Int((Double(seconds) / 60).rounded())) min" }
        return "\(Int((Double(seconds) / 3600).rounded())) h"
    }
}

// MARK: - State

/// The photo section's state: optimistic preview, upload progress, error and retry, removal.
/// The network calls are injected so tests drive every branch without a server.
@Observable
@MainActor
final class YouProfilePhotoModel {
    typealias Uploader = (Data, @escaping @MainActor (Double) -> Void) async throws -> YouAccount
    typealias Remover = () async throws -> YouAccount

    enum Busy: Equatable {
        case idle
        case uploading
        case removing
    }

    struct Problem: Equatable {
        let text: String
        /// Try again sends the same square once more.
        let canRetry: Bool
    }

    private(set) var busy: Busy = .idle
    /// 0…1 while uploading.
    private(set) var progress: Double = 0
    /// The cropped square, shown before the server answers; kept after a failure for Try again.
    private(set) var pendingImage: UIImage?
    private(set) var pendingJPEG: Data?
    private(set) var problem: Problem?
    /// Bumps on every success (haptics, toasts).
    private(set) var savedCount = 0
    private(set) var removedCount = 0

    private let uploader: Uploader
    private let remover: Remover

    init(uploader: @escaping Uploader, remover: @escaping Remover) {
        self.uploader = uploader
        self.remover = remover
    }

    /// The real endpoints.
    convenience init() {
        let upload: Uploader = { jpeg, progress in try await ProfilePhotoAPI.upload(jpeg: jpeg, progress: progress) }
        let remove: Remover = { try await ProfilePhotoAPI.remove() }
        self.init(uploader: upload, remover: remove)
    }

    var isBusy: Bool { busy != .idle }
    /// An upload failed and its square is still here (the avatar shows the old photo, dimmed).
    var hasFailedUpload: Bool { problem != nil && pendingJPEG != nil && busy == .idle }
    /// The image every avatar should show right now instead of the server's photo, if any.
    var optimisticImage: UIImage? { hasFailedUpload ? nil : pendingImage }

    /// A problem found before anything was sent (unreadable, too small, camera denied).
    func report(_ text: String) {
        problem = Problem(text: text, canRetry: false)
    }

    func clearProblem() {
        problem = nil
    }

    /// Shows `preview` at once, then uploads. Returns the account on success.
    func save(jpeg: Data, preview: UIImage) async -> YouAccount? {
        guard busy == .idle else { return nil }
        pendingImage = preview
        pendingJPEG = jpeg
        return await send()
    }

    /// Sends the kept square again.
    func retry() async -> YouAccount? {
        guard busy == .idle, pendingJPEG != nil else { return nil }
        return await send()
    }

    /// Drops a failed upload (the old photo stays).
    func discard() {
        guard busy == .idle else { return }
        pendingImage = nil
        pendingJPEG = nil
        problem = nil
        progress = 0
    }

    func remove() async -> YouAccount? {
        guard busy == .idle else { return nil }
        busy = .removing
        problem = nil
        defer { busy = .idle }
        do {
            let account = try await remover()
            pendingImage = nil
            pendingJPEG = nil
            removedCount += 1
            return account
        } catch {
            let failure = Self.failure(error)
            if failure.api.isCancelled { return nil }
            problem = Problem(text: ProfilePhotoCopy.removeError(failure), canRetry: false)
            return nil
        }
    }

    private func send() async -> YouAccount? {
        guard let jpeg = pendingJPEG else { return nil }
        busy = .uploading
        progress = 0
        problem = nil
        defer { busy = .idle }
        do {
            let account = try await uploader(jpeg) { [weak self] fraction in
                guard let self, self.busy == .uploading else { return }
                self.progress = max(self.progress, fraction)
            }
            progress = 1
            pendingImage = nil
            pendingJPEG = nil
            savedCount += 1
            return account
        } catch {
            let failure = Self.failure(error)
            if failure.api.isCancelled {
                pendingImage = nil
                pendingJPEG = nil
                return nil
            }
            problem = Problem(text: ProfilePhotoCopy.uploadError(failure), canRetry: ProfilePhotoCopy.isRetryable(failure))
            return nil
        }
    }

    static func failure(_ error: Error) -> ProfilePhotoFailure {
        if let f = error as? ProfilePhotoFailure { return f }
        if let api = error as? APIError { return ProfilePhotoFailure(api: api, retryAfter: nil) }
        return ProfilePhotoFailure(api: APIError.network(error), retryAfter: nil)
    }
}
