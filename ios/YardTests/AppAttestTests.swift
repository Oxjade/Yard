import XCTest
@testable import Yard

// App attestation (docs/APP.md "App attestation"): the request binding (the server's own test
// vectors), the header, the register-then-assert flow with a fake App Attest service, and the
// APIClient plumbing over a stubbed URLSession.

private final class FakeDevice: AppAttestDevice, @unchecked Sendable {
    var isSupported = true
    var generated = 0
    var attestHashes: [Data] = []
    var assertionHashes: [Data] = []
    var assertionFails = false

    func generateKey() async throws -> String {
        generated += 1
        return "a2V5LWlk\(generated)="
    }

    func attestKey(_ keyId: String, clientDataHash: Data) async throws -> Data {
        attestHashes.append(clientDataHash)
        return Data("attestation-for-\(keyId)".utf8)
    }

    func generateAssertion(_ keyId: String, clientDataHash: Data) async throws -> Data {
        if assertionFails { throw NSError(domain: "DCErrorDomain", code: 3) }
        assertionHashes.append(clientDataHash)
        return Data([0xA2, 0x01, 0x02])
    }
}

private final class FakeKeys: AppAttestKeyStore, @unchecked Sendable {
    var keyId: String?
    func load() -> String? { keyId }
    func save(_ keyId: String) { self.keyId = keyId }
    func remove() { keyId = nil }
}

private final class FakeServer: AppAttestServer, @unchecked Sendable {
    var configValue = AppAttestConfig(mode: "monitor", ios: AppAttestConfig.IOS(environment: "production"))
    var purposes: [String] = []
    var registerAccepts = true
    var registered: [(keyId: String, attestation: Data, challenge: String)] = []

    func config() async throws -> AppAttestConfig { configValue }

    func challenge(purpose: String) async throws -> String? {
        purposes.append(purpose)
        return purpose == "register" ? "registerChallenge0123456789abcdefghijklmnop" : "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"
    }

    func register(keyId: String, attestation: Data, challenge: String) async throws -> Bool {
        registered.append((keyId, attestation, challenge))
        return registerAccepts
    }
}

/// Decodes the header back to its JSON object.
private func decodeHeader(_ value: String) throws -> [String: Any] {
    var b64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while b64.count % 4 != 0 { b64 += "=" }
    let data = try XCTUnwrap(Data(base64Encoded: b64))
    return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
}

final class AppAttestBindingTests: XCTestCase {
    private let challenge = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"

    func testMatchesTheServersVectors() {
        let body = Data(#"{"email":"ada@gmail.com"}"#.utf8)
        XCTAssertEqual(AppAttest.hex(AppAttest.sha256(body)), "a4d4a13430d3032e196cf1a3f5e573f54d13769cb9ea43ebd8b242741422082b")
        XCTAssertEqual(
            AppAttest.clientData(method: "post", path: "/api/auth/magic-link", body: body, challenge: challenge),
            "yard-attest/v1\nPOST\n/api/auth/magic-link\na4d4a13430d3032e196cf1a3f5e573f54d13769cb9ea43ebd8b242741422082b\n\(challenge)"
        )
        XCTAssertEqual(AppAttest.hex(AppAttest.clientDataHash(method: "POST", path: "/api/auth/magic-link", body: body, challenge: challenge)), "ab584e9ffe9296b16aaf23d060fc3709c180247ae4e83212e1e20c79b6b0bcbc")
        XCTAssertEqual(AppAttest.hex(AppAttest.sha256(Data())), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    }

    func testHeaderIsUnpaddedBase64URLJSON() throws {
        let value = AppAttest.headerValue(challenge: challenge, keyId: "KWp6hF0ouS8w3Nfk6Hnav517UfTre78VpXJTgct53gk=", assertion: Data([1, 2, 3]))
        XCTAssertFalse(value.contains("="))
        XCTAssertFalse(value.contains("+"))
        XCTAssertFalse(value.contains("/"))
        let json = try decodeHeader(value)
        XCTAssertEqual(json["v"] as? Int, 1)
        XCTAssertEqual(json["p"] as? String, "ios")
        XCTAssertEqual(json["c"] as? String, challenge)
        XCTAssertEqual(json["k"] as? String, "KWp6hF0ouS8w3Nfk6Hnav517UfTre78VpXJTgct53gk=")
        XCTAssertEqual(json["a"] as? String, "AQID")
    }

    func testOnlyTheProtectedPostsAreAttested() {
        XCTAssertTrue(AppAttest.isProtected(method: "POST", path: "/api/auth/sign-up"))
        XCTAssertTrue(AppAttest.isProtected(method: "POST", path: "/api/auth/password/forgot"))
        XCTAssertTrue(AppAttest.isProtected(method: "POST", path: "/api/auth/magic-link"))
        XCTAssertTrue(AppAttest.isProtected(method: "POST", path: "/api/studio/apply"))
        XCTAssertFalse(AppAttest.isProtected(method: "GET", path: "/api/studio/apply"))
        XCTAssertFalse(AppAttest.isProtected(method: "POST", path: "/api/auth/sign-in"))
        XCTAssertFalse(AppAttest.isProtected(method: "POST", path: "/api/app/attest/challenge"))
    }

    func testConfigDecodesAndKnowsWhenIOSIsOn() throws {
        let on = try JSONDecoder().decode(AppAttestConfig.self, from: Data(#"{"mode":"monitor","android":{"cloudProjectNumber":"1"},"ios":{"environment":"production"}}"#.utf8))
        XCTAssertTrue(on.iosOn)
        let iosOff = try JSONDecoder().decode(AppAttestConfig.self, from: Data(#"{"mode":"enforce","android":null,"ios":null}"#.utf8))
        XCTAssertFalse(iosOff.iosOn)
        XCTAssertFalse(AppAttestConfig(mode: "off", ios: AppAttestConfig.IOS(environment: "production")).iosOn)
    }
}

final class AppAttestorTests: XCTestCase {
    private let body = Data(#"{"email":"ada@gmail.com"}"#.utf8)

    func testFirstCallRegistersAKeyThenAsserts() async throws {
        let device = FakeDevice(), keys = FakeKeys(), server = FakeServer()
        let attestor = AppAttestor(device: device, keys: keys, server: server)
        let value = await attestor.headerValue(method: "POST", path: "/api/auth/magic-link", body: body)

        let json = try decodeHeader(try XCTUnwrap(value))
        XCTAssertEqual(json["k"] as? String, "a2V5LWlk1=")
        XCTAssertEqual(json["c"] as? String, "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG")
        XCTAssertEqual(server.purposes, ["register", "request"])
        XCTAssertEqual(device.attestHashes, [AppAttest.registrationHash(challenge: "registerChallenge0123456789abcdefghijklmnop")])
        XCTAssertEqual(server.registered.map { $0.keyId }, ["a2V5LWlk1="])
        XCTAssertEqual(keys.keyId, "a2V5LWlk1=")
        XCTAssertEqual(device.assertionHashes, [AppAttest.clientDataHash(method: "POST", path: "/api/auth/magic-link", body: body, challenge: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG")])
    }

    func testLaterCallsReuseTheRegisteredKey() async {
        let device = FakeDevice(), keys = FakeKeys(), server = FakeServer()
        let attestor = AppAttestor(device: device, keys: keys, server: server)
        _ = await attestor.headerValue(method: "POST", path: "/api/auth/sign-up", body: body)
        let second = await attestor.headerValue(method: "POST", path: "/api/auth/sign-up", body: body)
        XCTAssertNotNil(second)
        XCTAssertEqual(device.generated, 1)
        XCTAssertEqual(server.purposes, ["register", "request", "request"])
    }

    func testUnsupportedDeviceSendsNothingAndAsksNothing() async {
        let device = FakeDevice(), server = FakeServer()
        device.isSupported = false
        let value = await AppAttestor(device: device, keys: FakeKeys(), server: server).headerValue(method: "POST", path: "/api/auth/sign-up", body: body)
        XCTAssertNil(value)
        XCTAssertTrue(server.purposes.isEmpty)
    }

    func testIOSOffOnTheServerSendsNothing() async {
        let device = FakeDevice(), server = FakeServer()
        server.configValue = AppAttestConfig(mode: "monitor", ios: nil)
        let value = await AppAttestor(device: device, keys: FakeKeys(), server: server).headerValue(method: "POST", path: "/api/auth/sign-up", body: body)
        XCTAssertNil(value)
        XCTAssertEqual(device.generated, 0)
        XCTAssertTrue(server.purposes.isEmpty)
    }

    func testARefusedRegistrationKeepsNoKey() async {
        let keys = FakeKeys(), server = FakeServer()
        server.registerAccepts = false
        let value = await AppAttestor(device: FakeDevice(), keys: keys, server: server).headerValue(method: "POST", path: "/api/auth/sign-up", body: body)
        XCTAssertNil(value)
        XCTAssertNil(keys.keyId)
    }

    func testAFailedAssertionDropsTheKey() async {
        let device = FakeDevice(), keys = FakeKeys()
        keys.keyId = "b2xkLWtleQ=="
        device.assertionFails = true
        let value = await AppAttestor(device: device, keys: keys, server: FakeServer()).headerValue(method: "POST", path: "/api/auth/sign-up", body: body)
        XCTAssertNil(value)
        XCTAssertNil(keys.keyId)
    }
}

// MARK: - APIClient plumbing

private final class StubProtocol: URLProtocol {
    struct Seen {
        let path: String
        let header: String?
        let body: Data
    }

    static var seen: [Seen] = []
    static var status = 200
    static var responseBody = Data(#"{"ok":true}"#.utf8)

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var body = request.httpBody ?? Data()
        if body.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(&buffer, maxLength: buffer.count)
                if n <= 0 { break }
                body.append(buffer, count: n)
            }
            stream.close()
        }
        StubProtocol.seen.append(Seen(path: request.url?.path ?? "", header: request.value(forHTTPHeaderField: AppAttest.header), body: body))
        let response = HTTPURLResponse(url: request.url!, statusCode: StubProtocol.status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: StubProtocol.responseBody)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class AppAttestClientTests: XCTestCase {
    private func client(_ attestor: AppAttestor?) -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        return APIClient(session: URLSession(configuration: config), attestor: attestor)
    }

    override func setUp() {
        super.setUp()
        StubProtocol.seen = []
        StubProtocol.status = 200
        StubProtocol.responseBody = Data(#"{"ok":true}"#.utf8)
    }

    func testProtectedCallCarriesAHeaderBoundToTheBodySent() async throws {
        let device = FakeDevice()
        let api = client(AppAttestor(device: device, keys: FakeKeys(), server: FakeServer()))
        try await api.send(.post, "/api/auth/magic-link", body: AuthEmailBody(email: "ada@gmail.com"))

        let seen = try XCTUnwrap(StubProtocol.seen.last)
        XCTAssertEqual(seen.path, "/api/auth/magic-link")
        let json = try decodeHeader(try XCTUnwrap(seen.header))
        XCTAssertEqual(json["p"] as? String, "ios")
        XCTAssertEqual(device.assertionHashes, [AppAttest.clientDataHash(method: "POST", path: "/api/auth/magic-link", body: seen.body, challenge: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG")])
    }

    func testOtherCallsAndNoAttestorSendNoHeader() async throws {
        let device = FakeDevice()
        try await client(AppAttestor(device: device, keys: FakeKeys(), server: FakeServer())).send(.post, "/api/auth/sign-in", body: AuthEmailBody(email: "ada@gmail.com"))
        XCTAssertNil(StubProtocol.seen.last?.header)
        XCTAssertTrue(device.assertionHashes.isEmpty)
        try await client(nil).send(.post, "/api/auth/magic-link", body: AuthEmailBody(email: "ada@gmail.com"))
        XCTAssertNil(StubProtocol.seen.last?.header)
    }

    func testARefusedAttestationForgetsTheKey() async {
        let keys = FakeKeys()
        let api = client(AppAttestor(device: FakeDevice(), keys: keys, server: FakeServer()))
        StubProtocol.status = 400
        StubProtocol.responseBody = Data(#"{"error":{"code":"validation","message":"Update the app.","fields":{"attest":"Update the app."}}}"#.utf8)
        do {
            try await api.send(.post, "/api/auth/sign-up", body: AuthEmailBody(email: "ada@gmail.com"))
            XCTFail("expected the 400")
        } catch let error as APIError {
            XCTAssertEqual(error.fields["attest"], "Update the app.")
        } catch {
            XCTFail("unexpected \(error)")
        }
        XCTAssertNil(keys.keyId)
    }
}
