import XCTest
import UIKit
@testable import Yard

// MARK: - Crop geometry (mirrors the website's photo-crop.ts tests)

final class ProfilePhotoCropTests: XCTestCase {
    private let wide = CGSize(width: 2000, height: 1000)
    private let frame: CGFloat = 300

    func testClampZoom() {
        XCTAssertEqual(ProfilePhotoCrop.clampZoom(0.2), 1)
        XCTAssertEqual(ProfilePhotoCrop.clampZoom(2.5), 2.5)
        XCTAssertEqual(ProfilePhotoCrop.clampZoom(9), 4)
        XCTAssertEqual(ProfilePhotoCrop.clampZoom(CGFloat.nan), 1)
        XCTAssertEqual(ProfilePhotoCrop.clampZoom(CGFloat.infinity), 1)
    }

    func testDisplayScaleCoversTheFrameWithTheShortSide() {
        XCTAssertEqual(ProfilePhotoCrop.displayScale(image: wide, frame: frame, zoom: 1), 0.3, accuracy: 1e-9)
        XCTAssertEqual(ProfilePhotoCrop.displayScale(image: wide, frame: frame, zoom: 2), 0.6, accuracy: 1e-9)
        // Zoom is clamped inside.
        XCTAssertEqual(ProfilePhotoCrop.displayScale(image: wide, frame: frame, zoom: 0.5), 0.3, accuracy: 1e-9)
    }

    func testClampOffsetKeepsTheFrameCovered() {
        let max = ProfilePhotoCrop.maxOffset(image: wide, frame: frame, zoom: 1)
        XCTAssertEqual(max.width, 150, accuracy: 1e-9)
        XCTAssertEqual(max.height, 0, accuracy: 1e-9)
        let o = ProfilePhotoCrop.clampOffset(image: wide, frame: frame, zoom: 1, offset: CGSize(width: 500, height: 50))
        XCTAssertEqual(o.width, 150, accuracy: 1e-9)
        XCTAssertEqual(o.height, 0, accuracy: 1e-9)
        let n = ProfilePhotoCrop.clampOffset(image: wide, frame: frame, zoom: 1, offset: CGSize(width: -500, height: CGFloat.nan))
        XCTAssertEqual(n.width, -150, accuracy: 1e-9)
        XCTAssertEqual(n.height, 0)
    }

    func testSourceSquareCentredAndMoved() {
        let centred = ProfilePhotoCrop.sourceSquare(image: wide, frame: frame, zoom: 1, offset: .zero)
        XCTAssertEqual(centred.minX, 500, accuracy: 1e-6)
        XCTAssertEqual(centred.minY, 0, accuracy: 1e-6)
        XCTAssertEqual(centred.width, 1000, accuracy: 1e-6)
        XCTAssertEqual(centred.height, 1000, accuracy: 1e-6)

        // The photo dragged fully right shows its left edge.
        let left = ProfilePhotoCrop.sourceSquare(image: wide, frame: frame, zoom: 1, offset: CGSize(width: 400, height: 0))
        XCTAssertEqual(left.minX, 0, accuracy: 1e-6)

        let zoomed = ProfilePhotoCrop.sourceSquare(image: wide, frame: frame, zoom: 2, offset: .zero)
        XCTAssertEqual(zoomed.width, 500, accuracy: 1e-6)
        XCTAssertEqual(zoomed.minX, 750, accuracy: 1e-6)
        XCTAssertEqual(zoomed.minY, 250, accuracy: 1e-6)
    }

    func testSourceSquareNeverLeavesTheImage() {
        let tall = CGSize(width: 900, height: 1600)
        for x in stride(from: -900.0, through: 900.0, by: 150.0) {
            for y in stride(from: -900.0, through: 900.0, by: 150.0) {
                for z in [1.0, 1.7, 4.0] {
                    let r = ProfilePhotoCrop.sourceSquare(image: tall, frame: 320, zoom: CGFloat(z), offset: CGSize(width: x, height: y))
                    XCTAssertGreaterThanOrEqual(r.minX, -1e-6)
                    XCTAssertGreaterThanOrEqual(r.minY, -1e-6)
                    XCTAssertLessThanOrEqual(r.maxX, tall.width + 1e-6)
                    XCTAssertLessThanOrEqual(r.maxY, tall.height + 1e-6)
                }
            }
        }
    }

    func testOutputSideNeverScalesUpAndCapsAt1024() {
        XCTAssertEqual(ProfilePhotoCrop.outputSide(1000), 1000)
        XCTAssertEqual(ProfilePhotoCrop.outputSide(3000), 1024)
        XCTAssertEqual(ProfilePhotoCrop.outputSide(0.2), 1)
        XCTAssertEqual(ProfilePhotoCrop.outputSide(CGFloat.nan), 1)
    }

    func testZoomKeepsTheCentrePoint() {
        let r = ProfilePhotoCrop.zoomTo(image: wide, frame: frame, fromZoom: 1, fromOffset: CGSize(width: 100, height: 0), nextZoom: 2)
        XCTAssertEqual(r.zoom, 2)
        XCTAssertEqual(r.offset.width, 200, accuracy: 1e-9)
        let back = ProfilePhotoCrop.zoomTo(image: wide, frame: frame, fromZoom: 2, fromOffset: r.offset, nextZoom: 1)
        XCTAssertEqual(back.offset.width, 100, accuracy: 1e-9)
        // Past the range: clamped, and the offset clamped for the new zoom.
        let out = ProfilePhotoCrop.zoomTo(image: wide, frame: frame, fromZoom: 4, fromOffset: CGSize(width: 1000, height: 0), nextZoom: 0.5)
        XCTAssertEqual(out.zoom, 1)
        XCTAssertEqual(out.offset.width, 150, accuracy: 1e-9)
    }

    func testRubberBandResistsPastTheLimit() {
        XCTAssertEqual(ProfilePhotoCrop.rubberBand(40, limit: 100, dimension: 80), 40)
        XCTAssertEqual(ProfilePhotoCrop.rubberBand(-100, limit: 100, dimension: 80), -100)
        let a = ProfilePhotoCrop.rubberBand(150, limit: 100, dimension: 80)
        let b = ProfilePhotoCrop.rubberBand(400, limit: 100, dimension: 80)
        XCTAssertGreaterThan(a, 100)
        XCTAssertLessThan(a, 150)
        XCTAssertGreaterThan(b, a)
        XCTAssertLessThan(b, 180)
        XCTAssertEqual(ProfilePhotoCrop.rubberBand(-150, limit: 100, dimension: 80), -a, accuracy: 1e-9)
        XCTAssertEqual(ProfilePhotoCrop.rubberBand(CGFloat.nan, limit: 100, dimension: 80), 0)
    }

    func testRubberZoomGivesALittleThenStops() {
        XCTAssertEqual(ProfilePhotoCrop.rubberZoom(2), 2)
        let low = ProfilePhotoCrop.rubberZoom(0.3)
        XCTAssertLessThan(low, 1)
        XCTAssertGreaterThan(low, 0.85)
        let high = ProfilePhotoCrop.rubberZoom(10)
        XCTAssertGreaterThan(high, 4)
        XCTAssertLessThan(high, 4.6)
    }

    func testRenderedJPEGIsTheCroppedSquare() throws {
        let image = Self.solidImage(CGSize(width: 200, height: 100))
        let jpeg = try XCTUnwrap(ProfilePhotoCrop.renderJPEG(image, frame: 100, zoom: 1, offset: .zero))
        XCTAssertEqual(jpeg.prefix(2), Data([0xFF, 0xD8]), "a JPEG")
        let decoded = try XCTUnwrap(UIImage(data: jpeg))
        XCTAssertEqual(decoded.size.width * decoded.scale, 100)
        XCTAssertEqual(decoded.size.height * decoded.scale, 100)
    }

    func testRenderedJPEGIsAtMost1024() throws {
        let image = Self.solidImage(CGSize(width: 3000, height: 2000))
        let jpeg = try XCTUnwrap(ProfilePhotoCrop.renderJPEG(image, frame: 320, zoom: 1, offset: .zero))
        let decoded = try XCTUnwrap(UIImage(data: jpeg))
        XCTAssertEqual(decoded.size.width * decoded.scale, 1024)
        XCTAssertEqual(decoded.size.height * decoded.scale, 1024)
    }

    static func solidImage(_ size: CGSize, scale: CGFloat = 1) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale
        format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).image { ctx in
            UIColor.systemTeal.setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
        }
    }
}

// MARK: - Preparing a picked photo

final class ProfilePhotoPrepTests: XCTestCase {
    func testUnreadableBytes() {
        let result = ProfilePhotoPrep.image(from: Data("not a photo".utf8))
        XCTAssertEqual(result.failureValue, .unreadable)
        XCTAssertEqual(ProfilePhotoPrep.image(from: Data()).failureValue, .unreadable)
    }

    func testTooSmall() throws {
        let tiny = ProfilePhotoCropTests.solidImage(CGSize(width: 40, height: 300))
        let png = try XCTUnwrap(tiny.pngData())
        XCTAssertEqual(ProfilePhotoPrep.image(from: png).failureValue, .tooSmall)
        XCTAssertEqual(ProfilePhotoPrep.image(from: tiny).failureValue, .tooSmall)
        XCTAssertEqual(ProfilePhotoPrep.Problem.tooSmall.message, "This photo is smaller than 64 px on a side. Use a larger one.")
    }

    func testNormalisedToScaleOnePixels() throws {
        let retina = ProfilePhotoCropTests.solidImage(CGSize(width: 100, height: 80), scale: 3)
        let image = try XCTUnwrap(ProfilePhotoPrep.image(from: retina).successValue)
        XCTAssertEqual(image.scale, 1)
        XCTAssertEqual(image.size.width, 300)
        XCTAssertEqual(image.size.height, 240)
        XCTAssertEqual(image.imageOrientation, .up)
    }

    func testDecodesFileBytes() throws {
        let photo = ProfilePhotoCropTests.solidImage(CGSize(width: 640, height: 480))
        let jpeg = try XCTUnwrap(photo.jpegData(compressionQuality: 0.8))
        let image = try XCTUnwrap(ProfilePhotoPrep.image(from: jpeg).successValue)
        XCTAssertEqual(image.size.width * image.scale, 640)
        XCTAssertEqual(image.size.height * image.scale, 480)
    }
}

private extension Result {
    var failureValue: Failure? {
        if case .failure(let f) = self { return f }
        return nil
    }

    var successValue: Success? {
        if case .success(let s) = self { return s }
        return nil
    }
}

// MARK: - Request building

final class ProfilePhotoRequestTests: XCTestCase {
    func testMultipartBodyHasExactlyOneFilePart() throws {
        let jpeg = Data([0xFF, 0xD8, 0xFF, 0xD9])
        let body = ProfilePhotoAPI.multipartBody(jpeg: jpeg, boundary: "B")
        var expected = Data("--B\r\nContent-Disposition: form-data; name=\"file\"; filename=\"photo.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n".utf8)
        expected.append(jpeg)
        expected.append(Data("\r\n--B--\r\n".utf8))
        XCTAssertEqual(body, expected)
        let text = String(decoding: body, as: UTF8.self)
        XCTAssertEqual(text.components(separatedBy: "Content-Disposition").count - 1, 1)
    }

    func testUploadRequestHeaders() throws {
        let jpeg = Data(repeating: 7, count: 1234)
        let built = try ProfilePhotoAPI.uploadRequest(jpeg: jpeg, boundary: "YardBoundary-test")
        let r = built.request
        XCTAssertEqual(r.httpMethod, "POST")
        XCTAssertNil(r.httpBody, "the body goes through upload(for:from:)")
        XCTAssertEqual(r.url?.path, "/api/account/photo")
        let items = URLComponents(url: try XCTUnwrap(r.url), resolvingAgainstBaseURL: false)?.queryItems ?? []
        XCTAssertEqual(items, [URLQueryItem(name: "as", value: "shopper")])
        XCTAssertEqual(r.value(forHTTPHeaderField: "Content-Type"), "multipart/form-data; boundary=YardBoundary-test")
        XCTAssertEqual(r.value(forHTTPHeaderField: "Content-Length"), String(built.body.count))
        XCTAssertEqual(r.value(forHTTPHeaderField: "X-Yard-Client"), "1")
        XCTAssertEqual(r.value(forHTTPHeaderField: "Origin"), Config.origin)
        XCTAssertEqual(built.body.count, ProfilePhotoAPI.multipartBody(jpeg: jpeg, boundary: "YardBoundary-test").count)
    }

    func testRetryAfter() {
        XCTAssertEqual(ProfilePhotoAPI.retryAfter("120"), 120)
        XCTAssertEqual(ProfilePhotoAPI.retryAfter(" 30 "), 30)
        XCTAssertNil(ProfilePhotoAPI.retryAfter(nil))
        XCTAssertNil(ProfilePhotoAPI.retryAfter("0"))
        XCTAssertNil(ProfilePhotoAPI.retryAfter("Wed, 21 Oct 2026 07:28:00 GMT"))
    }
}

// MARK: - Copy

final class ProfilePhotoCopyTests: XCTestCase {
    private func failure(_ status: Int, _ code: String, _ message: String = "Server says no.", retryAfter: Int? = nil) -> ProfilePhotoFailure {
        ProfilePhotoFailure(api: APIError(status: status, code: code, message: message), retryAfter: retryAfter)
    }

    func testWebsiteSentences() {
        XCTAssertEqual(ProfilePhotoCopy.uploadError(failure(413, "too_large")), "Photos can be up to 10 MB.")
        XCTAssertEqual(ProfilePhotoCopy.uploadError(failure(415, "unsupported_type")), "Yard couldn't read this as a JPEG, PNG or WebP photo. Try another one.")
        XCTAssertEqual(ProfilePhotoCopy.uploadError(failure(429, "rate_limited", retryAfter: 180)), "You've changed your photo a lot. Try again in 3 min.")
        XCTAssertEqual(ProfilePhotoCopy.uploadError(failure(429, "rate_limited")), "You've changed your photo a lot. Try again in 10 min.")
        XCTAssertEqual(ProfilePhotoCopy.uploadError(failure(422, "rule", "Demo accounts can't change their photo.")), "Demo accounts can't change their photo.")
        XCTAssertEqual(ProfilePhotoCopy.uploadError(failure(422, "rule", "This photo is smaller than 64 px on a side. Use a larger one.")), "This photo is smaller than 64 px on a side. Use a larger one.")
        XCTAssertEqual(ProfilePhotoCopy.uploadError(failure(401, "unauthorized")), "Sign in again to change your photo.")
        XCTAssertEqual(ProfilePhotoCopy.uploadError(failure(-1, "decoding")), "Your photo wasn't saved. Try again.")
        XCTAssertEqual(ProfilePhotoCopy.removeError(failure(422, "rule", "Demo accounts can't change their photo.")), "Demo accounts can't change their photo.")
    }

    func testRetryableLikeTheWebsite() {
        XCTAssertTrue(ProfilePhotoCopy.isRetryable(failure(0, "network")))
        XCTAssertTrue(ProfilePhotoCopy.isRetryable(failure(429, "rate_limited")))
        XCTAssertTrue(ProfilePhotoCopy.isRetryable(failure(503, "http_503")))
        XCTAssertFalse(ProfilePhotoCopy.isRetryable(failure(422, "rule")))
        XCTAssertFalse(ProfilePhotoCopy.isRetryable(failure(415, "unsupported_type")))
        XCTAssertFalse(ProfilePhotoCopy.isRetryable(failure(401, "unauthorized")))
    }

    func testFormatWait() {
        XCTAssertEqual(ProfilePhotoCopy.formatWait(40), "40 s")
        XCTAssertEqual(ProfilePhotoCopy.formatWait(0), "1 s")
        XCTAssertEqual(ProfilePhotoCopy.formatWait(180), "3 min")
        XCTAssertEqual(ProfilePhotoCopy.formatWait(7200), "2 h")
    }
}

// MARK: - Decoding

final class ProfilePhotoDecodingTests: XCTestCase {
    func testShopperPhotoSrc() throws {
        let json = Data(#"{"id":"usr_1","name":"Ada Obi","email":"ada@example.com","photoSrc":"/api/media/med_1?as=shopper"}"#.utf8)
        let shopper = try JSONDecoder().decode(Shopper.self, from: json)
        XCTAssertEqual(shopper.photoSrc, "/api/media/med_1?as=shopper")
        let none = try JSONDecoder().decode(Shopper.self, from: Data(#"{"id":"usr_1","name":"Ada","email":"a@b.c","photoSrc":null}"#.utf8))
        XCTAssertNil(none.photoSrc)
        let empty = try JSONDecoder().decode(Shopper.self, from: Data(#"{"id":"usr_1","name":"Ada","email":"a@b.c","photoSrc":""}"#.utf8))
        XCTAssertNil(empty.photoSrc)
    }

    func testAccountPhoto() throws {
        let json = Data(#"{"account":{"name":"Ada Obi","email":"ada@example.com","emailVerified":true,"hasPassword":true,"signInProviders":[],"pendingEmail":null,"demo":false,"photo":{"mediaId":"med_2","src":"/api/media/med_2?as=shopper","width":1024,"height":1024}}}"#.utf8)
        let account = try JSONDecoder().decode(YouAccountResponse.self, from: json).account
        XCTAssertEqual(account.photo?.mediaId, "med_2")
        XCTAssertEqual(account.photo?.src, "/api/media/med_2?as=shopper")
        XCTAssertEqual(account.photo?.width, 1024)
        XCTAssertEqual(account.initials, "AO")
        let without = try JSONDecoder().decode(YouAccountResponse.self, from: Data(#"{"account":{"name":"Ada","email":"a@b.c","photo":null}}"#.utf8)).account
        XCTAssertNil(without.photo)
    }
}

// MARK: - State

@MainActor
final class YouProfilePhotoModelTests: XCTestCase {
    nonisolated private static func account(photo: String?) -> YouAccount {
        YouAccount(
            name: "Ada Obi", email: "ada@example.com", emailVerified: true, hasPassword: true,
            signInProviders: [], pendingEmail: nil, demo: false,
            photo: photo.map { YouAccount.Photo(mediaId: "med", src: $0, width: 1024, height: 1024) }
        )
    }

    private let preview = ProfilePhotoCropTests.solidImage(CGSize(width: 10, height: 10))
    private let jpeg = Data([0xFF, 0xD8, 0xFF, 0xD9])

    func testSuccessfulUploadClearsThePreview() async {
        var sent: [Data] = []
        let model = YouProfilePhotoModel(
            uploader: { data, progress in
                sent.append(data)
                progress(0.5)
                return Self.account(photo: "/api/media/med_new?as=shopper")
            },
            remover: { Self.account(photo: nil) }
        )
        let result = await model.save(jpeg: jpeg, preview: preview)
        XCTAssertEqual(result?.photo?.src, "/api/media/med_new?as=shopper")
        XCTAssertEqual(sent, [jpeg])
        XCTAssertEqual(model.busy, .idle)
        XCTAssertNil(model.pendingImage)
        XCTAssertNil(model.pendingJPEG)
        XCTAssertNil(model.problem)
        XCTAssertEqual(model.savedCount, 1)
        XCTAssertEqual(model.progress, 1)
    }

    func testRetryableFailureKeepsTheSquareThenRetrySucceeds() async {
        var attempts = 0
        let model = YouProfilePhotoModel(
            uploader: { _, _ in
                attempts += 1
                if attempts == 1 { throw ProfilePhotoFailure(api: APIError(status: 503, code: "http_503", message: "Yard is having trouble right now. Try again in a moment."), retryAfter: nil) }
                return Self.account(photo: "/api/media/med_ok?as=shopper")
            },
            remover: { Self.account(photo: nil) }
        )
        let first = await model.save(jpeg: jpeg, preview: preview)
        XCTAssertNil(first)
        XCTAssertEqual(model.problem?.canRetry, true)
        XCTAssertTrue(model.hasFailedUpload)
        XCTAssertNil(model.optimisticImage, "a failed upload shows the old photo, dimmed")
        XCTAssertEqual(model.pendingJPEG, jpeg)

        let second = await model.retry()
        XCTAssertEqual(second?.photo?.src, "/api/media/med_ok?as=shopper")
        XCTAssertEqual(attempts, 2)
        XCTAssertNil(model.problem)
        XCTAssertFalse(model.hasFailedUpload)
    }

    func testRuleFailureIsNotRetryableAndCanBeDiscarded() async {
        let model = YouProfilePhotoModel(
            uploader: { _, _ in throw ProfilePhotoFailure(api: APIError(status: 422, code: "rule", message: "Demo accounts can't change their photo."), retryAfter: nil) },
            remover: { Self.account(photo: nil) }
        )
        _ = await model.save(jpeg: jpeg, preview: preview)
        XCTAssertEqual(model.problem, YouProfilePhotoModel.Problem(text: "Demo accounts can't change their photo.", canRetry: false))
        model.discard()
        XCTAssertNil(model.problem)
        XCTAssertNil(model.pendingJPEG)
        XCTAssertNil(model.pendingImage)
        let again = await model.retry()
        XCTAssertNil(again, "nothing left to retry")
    }

    func testCancelledUploadIsSilent() async {
        let model = YouProfilePhotoModel(
            uploader: { _, _ in throw ProfilePhotoFailure(api: APIError(status: 0, code: "cancelled", message: "Cancelled."), retryAfter: nil) },
            remover: { Self.account(photo: nil) }
        )
        _ = await model.save(jpeg: jpeg, preview: preview)
        XCTAssertNil(model.problem)
        XCTAssertNil(model.pendingImage)
    }

    func testRemove() async {
        var removeCalls = 0
        let model = YouProfilePhotoModel(
            uploader: { _, _ in Self.account(photo: "/x") },
            remover: {
                removeCalls += 1
                if removeCalls == 1 { throw ProfilePhotoFailure(api: APIError(status: 429, code: "rate_limited", message: "Too many."), retryAfter: 60) }
                return Self.account(photo: nil)
            }
        )
        let failed = await model.remove()
        XCTAssertNil(failed)
        XCTAssertEqual(model.problem?.text, "You've removed your photo a lot. Try again in 60 s.")
        XCTAssertEqual(model.removedCount, 0)
        let removed = await model.remove()
        XCTAssertNotNil(removed)
        XCTAssertNil(removed?.photo)
        XCTAssertNil(model.problem)
        XCTAssertEqual(model.removedCount, 1)
        XCTAssertEqual(model.busy, .idle)
    }

    func testPreCropProblems() {
        let model = YouProfilePhotoModel(uploader: { _, _ in Self.account(photo: nil) }, remover: { Self.account(photo: nil) })
        model.report(ProfilePhotoPrep.Problem.unreadable.message)
        XCTAssertEqual(model.problem?.canRetry, false)
        XCTAssertFalse(model.hasFailedUpload)
        model.clearProblem()
        XCTAssertNil(model.problem)
    }
}
