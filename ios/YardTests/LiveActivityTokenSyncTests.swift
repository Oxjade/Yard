import XCTest
@testable import Yard

// Live Activity push tokens → Yard's server (LiveActivityTokenSync), with a fake uploader behind
// `LiveActivityTokenUploading` and an in-memory store: upload once, rotation, end, retries after a
// failure, push-to-start and sign-out.

private final class FakeUploader: LiveActivityTokenUploading, @unchecked Sendable {
    enum Call: Equatable {
        case register(orderId: String, token: String, timeZone: String, appVersion: String?)
        case unregister(orderId: String, token: String)
        case registerStart(token: String, timeZone: String)
        case unregisterStart(token: String)
    }

    var calls: [Call] = []
    var offline = false
    var notFound = false

    private func check() throws {
        if offline { throw URLError(.notConnectedToInternet) }
        if notFound { throw APIError(status: 404, code: "not_found", message: "Not found.") }
    }

    func register(orderId: String, token: String, timeZone: String, appVersion: String?) async throws {
        try check()
        calls.append(.register(orderId: orderId, token: token, timeZone: timeZone, appVersion: appVersion))
    }

    func unregister(orderId: String, token: String) async throws {
        try check()
        calls.append(.unregister(orderId: orderId, token: token))
    }

    func registerStart(token: String, timeZone: String, appVersion: String?) async throws {
        try check()
        calls.append(.registerStart(token: token, timeZone: timeZone))
    }

    func unregisterStart(token: String) async throws {
        try check()
        calls.append(.unregisterStart(token: token))
    }
}

private final class MemoryStore: LiveActivityTokenStoring, @unchecked Sendable {
    var saved = LiveActivityTokenSync.Snapshot()
    func load() -> LiveActivityTokenSync.Snapshot { saved }
    func save(_ snapshot: LiveActivityTokenSync.Snapshot) { saved = snapshot }
}

@MainActor
final class LiveActivityTokenSyncTests: XCTestCase {
    private func make(_ uploader: FakeUploader, _ store: MemoryStore = MemoryStore()) -> LiveActivityTokenSync {
        LiveActivityTokenSync(uploader: uploader, store: store, timeZone: { "Africa/Lagos" }, appVersion: "1.2.0")
    }

    func testUploadsANewTokenOnceWithTheTimeZone() async {
        let up = FakeUploader()
        let sync = make(up)
        await sync.tokenChanged(orderId: "or_1", token: "aa11")
        await sync.tokenChanged(orderId: "or_1", token: "aa11")
        XCTAssertEqual(up.calls, [.register(orderId: "or_1", token: "aa11", timeZone: "Africa/Lagos", appVersion: "1.2.0")])
        XCTAssertEqual(sync.snapshot.orders["or_1"], LiveActivityTokenSync.Entry(token: "aa11", uploaded: true))
    }

    func testRotationRegistersTheNewTokenAndRemovesTheOld() async {
        let up = FakeUploader()
        let sync = make(up)
        await sync.tokenChanged(orderId: "or_1", token: "aa11")
        await sync.tokenChanged(orderId: "or_1", token: "bb22")
        XCTAssertEqual(up.calls, [
            .register(orderId: "or_1", token: "aa11", timeZone: "Africa/Lagos", appVersion: "1.2.0"),
            .register(orderId: "or_1", token: "bb22", timeZone: "Africa/Lagos", appVersion: "1.2.0"),
            .unregister(orderId: "or_1", token: "aa11"),
        ])
        XCTAssertEqual(sync.snapshot.orders["or_1"]?.token, "bb22")
        XCTAssertTrue(sync.snapshot.stale.isEmpty)
    }

    func testEndedActivityUnregisters() async {
        let up = FakeUploader()
        let sync = make(up)
        await sync.tokenChanged(orderId: "or_1", token: "aa11")
        await sync.activityEnded(orderId: "or_1")
        XCTAssertEqual(up.calls.last, .unregister(orderId: "or_1", token: "aa11"))
        XCTAssertNil(sync.snapshot.orders["or_1"])
        // Ending again is a no-op.
        await sync.activityEnded(orderId: "or_1")
        XCTAssertEqual(up.calls.count, 2)
    }

    func testOfflineUploadIsKeptAndRetried() async {
        let up = FakeUploader()
        let store = MemoryStore()
        let sync = make(up, store)
        up.offline = true
        await sync.tokenChanged(orderId: "or_1", token: "aa11")
        XCTAssertEqual(up.calls, [])
        XCTAssertEqual(store.saved.orders["or_1"], LiveActivityTokenSync.Entry(token: "aa11", uploaded: false))

        // A relaunch reads the pending token back and the retry (resume()) sends it.
        up.offline = false
        let relaunched = make(up, store)
        await relaunched.retryPending()
        XCTAssertEqual(up.calls, [.register(orderId: "or_1", token: "aa11", timeZone: "Africa/Lagos", appVersion: "1.2.0")])
        XCTAssertEqual(relaunched.snapshot.orders["or_1"]?.uploaded, true)
    }

    func testOfflineUnregisterIsRetried() async {
        let up = FakeUploader()
        let sync = make(up)
        await sync.tokenChanged(orderId: "or_1", token: "aa11")
        up.offline = true
        await sync.activityEnded(orderId: "or_1")
        XCTAssertEqual(sync.snapshot.stale, [LiveActivityTokenSync.StaleToken(orderId: "or_1", token: "aa11")])
        up.offline = false
        await sync.retryPending()
        XCTAssertEqual(up.calls.last, .unregister(orderId: "or_1", token: "aa11"))
        XCTAssertTrue(sync.snapshot.stale.isEmpty)
    }

    func testNotTheShoppersOrderStopsTrying() async {
        let up = FakeUploader()
        let sync = make(up)
        up.notFound = true
        await sync.tokenChanged(orderId: "or_other", token: "aa11")
        XCTAssertNil(sync.snapshot.orders["or_other"])
    }

    func testPushToStartToken() async {
        let up = FakeUploader()
        let sync = make(up)
        await sync.startTokenChanged("cc33")
        await sync.startTokenChanged("cc33")
        await sync.startTokenChanged("dd44")
        XCTAssertEqual(up.calls, [.registerStart(token: "cc33", timeZone: "Africa/Lagos"), .registerStart(token: "dd44", timeZone: "Africa/Lagos"), .unregisterStart(token: "cc33")])
    }

    func testSignOutRemovesEveryToken() async {
        let up = FakeUploader()
        let sync = make(up)
        await sync.tokenChanged(orderId: "or_1", token: "aa11")
        await sync.startTokenChanged("cc33")
        up.calls = []
        await sync.signOut()
        XCTAssertEqual(Set(up.calls.map { "\($0)" }), Set(["\(FakeUploader.Call.unregister(orderId: "or_1", token: "aa11"))", "\(FakeUploader.Call.unregisterStart(token: "cc33"))"]))
        XCTAssertEqual(sync.snapshot, LiveActivityTokenSync.Snapshot())
    }
}
