import CryptoKit
import DeviceCheck
import Foundation
import Security

/// App attestation (docs/APP.md "App attestation"): the protected calls (sign-up, password reset,
/// magic link, the Sell on Yard application) carry `X-Yard-Attest`, an App Attest assertion bound to
/// exactly that request, so a script can't pretend to be the app.
///
///     clientData     = "yard-attest/v1\n" + METHOD + "\n" + path + "\n" + hex(sha256(body)) + "\n" + challenge
///     clientDataHash = sha256(clientData)
///     header         = base64url({"v":1,"p":"ios","c":challenge,"k":keyId,"a":base64(assertion)}), unpadded
///
/// Once per install the app generates a key, attests it against a "register" challenge and registers
/// it (POST /api/app/attest/register); the key id is kept in the Keychain. Any failure (simulator,
/// unsupported device, offline, Apple's service down) sends the request without the header: the app
/// never blocks the user; the server's mode decides.
enum AppAttest {
    static let header = "X-Yard-Attest"
    static let version = "yard-attest/v1"

    /// POST paths the server checks (src/server/http/human-check.ts).
    static let protectedPaths: Set<String> = [
        "/api/auth/sign-up",
        "/api/auth/password/forgot",
        "/api/auth/magic-link",
        "/api/studio/apply",
        "/api/studio/onboarding/submit",
    ]

    static func isProtected(method: String, path: String) -> Bool {
        method.uppercased() == "POST" && protectedPaths.contains(path)
    }

    static func sha256(_ data: Data) -> Data {
        Data(SHA256.hash(data: data))
    }

    static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    static func clientData(method: String, path: String, body: Data, challenge: String) -> String {
        [version, method.uppercased(), path, hex(sha256(body)), challenge].joined(separator: "\n")
    }

    /// The 32 bytes `generateAssertion` signs.
    static func clientDataHash(method: String, path: String, body: Data, challenge: String) -> Data {
        sha256(Data(clientData(method: method, path: path, body: body, challenge: challenge).utf8))
    }

    /// What `attestKey` signs at registration: sha256 of the challenge's UTF-8 bytes.
    static func registrationHash(challenge: String) -> Data {
        sha256(Data(challenge.utf8))
    }

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// The header value. Keys are written in a fixed order (v, p, c, k, a), so the output is stable.
    static func headerValue(challenge: String, keyId: String, assertion: Data) -> String {
        func quoted(_ s: String) -> String {
            // Challenges and key ids are base64/base64url: no characters need escaping, but be safe.
            let escaped = s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
            return "\"" + escaped + "\""
        }
        let json = "{\"v\":1,\"p\":\"ios\",\"c\":\(quoted(challenge)),\"k\":\(quoted(keyId)),\"a\":\(quoted(assertion.base64EncodedString()))}"
        return base64URL(Data(json.utf8))
    }
}

// MARK: - The pieces behind protocols (tests use fakes)

/// `DCAppAttestService`, wrapped so tests can fake it.
protocol AppAttestDevice: Sendable {
    var isSupported: Bool { get }
    func generateKey() async throws -> String
    func attestKey(_ keyId: String, clientDataHash: Data) async throws -> Data
    func generateAssertion(_ keyId: String, clientDataHash: Data) async throws -> Data
}

/// Where the registered key id is kept (the Keychain in the app).
protocol AppAttestKeyStore: Sendable {
    func load() -> String?
    func save(_ keyId: String)
    func remove()
}

/// GET /api/app/attest/config.
struct AppAttestConfig: Decodable, Sendable, Equatable {
    struct IOS: Decodable, Sendable, Equatable {
        let environment: String?
    }

    let mode: String
    let ios: IOS?

    init(mode: String, ios: IOS?) {
        self.mode = mode
        self.ios = ios
    }

    /// True when the server verifies iOS requests (monitor or enforce, and iOS configured).
    var iosOn: Bool { mode != "off" && ios != nil }
}

/// The three attestation endpoints.
protocol AppAttestServer: Sendable {
    func config() async throws -> AppAttestConfig
    /// A single-use challenge for "request" or "register", or nil when the server has attestation off.
    func challenge(purpose: String) async throws -> String?
    /// True when the server verified and stored the key.
    func register(keyId: String, attestation: Data, challenge: String) async throws -> Bool
}

// MARK: - The attestor

/// Makes `X-Yard-Attest` for one protected request, registering this install's key first if needed.
/// An actor, so two requests never generate or register keys at the same time.
actor AppAttestor {
    private let device: AppAttestDevice
    private let keys: AppAttestKeyStore
    private let server: AppAttestServer

    init(device: AppAttestDevice, keys: AppAttestKeyStore, server: AppAttestServer) {
        self.device = device
        self.keys = keys
        self.server = server
    }

    /// The app's attestor: the real App Attest service, the Keychain and the Yard API.
    static let live = AppAttestor(device: DeviceAppAttest(), keys: KeychainAppAttestKeyStore(), server: APIAppAttestServer())

    /// The header for this request, or nil (send the request without it).
    func headerValue(method: String, path: String, body: Data) async -> String? {
        guard device.isSupported else { return nil }
        do {
            guard try await server.config().iosOn else { return nil }
            guard let keyId = try await registeredKey() else { return nil }
            guard let challenge = try await server.challenge(purpose: "request"), !challenge.isEmpty else { return nil }
            let hash = AppAttest.clientDataHash(method: method, path: path, body: body, challenge: challenge)
            let assertion: Data
            do {
                assertion = try await device.generateAssertion(keyId, clientDataHash: hash)
            } catch {
                // The key is gone or invalid (e.g. the app was restored to another device): start over next time.
                keys.remove()
                return nil
            }
            return AppAttest.headerValue(challenge: challenge, keyId: keyId, assertion: assertion)
        } catch {
            return nil
        }
    }

    /// The server refused this install's attestation (400 `attest`): register a new key next time.
    func forgetKey() {
        keys.remove()
    }

    /// The stored key id, or a newly generated, attested and registered one. Nil when registration fails.
    private func registeredKey() async throws -> String? {
        if let keyId = keys.load(), !keyId.isEmpty { return keyId }
        guard let challenge = try await server.challenge(purpose: "register"), !challenge.isEmpty else { return nil }
        let keyId = try await device.generateKey()
        let attestation = try await device.attestKey(keyId, clientDataHash: AppAttest.registrationHash(challenge: challenge))
        guard try await server.register(keyId: keyId, attestation: attestation, challenge: challenge) else { return nil }
        keys.save(keyId)
        return keyId
    }
}

// MARK: - Live implementations

/// `DCAppAttestService.shared`. Not supported on the simulator (isSupported is false there).
struct DeviceAppAttest: AppAttestDevice {
    var isSupported: Bool { DCAppAttestService.shared.isSupported }

    func generateKey() async throws -> String {
        try await DCAppAttestService.shared.generateKey()
    }

    func attestKey(_ keyId: String, clientDataHash: Data) async throws -> Data {
        try await DCAppAttestService.shared.attestKey(keyId, clientDataHash: clientDataHash)
    }

    func generateAssertion(_ keyId: String, clientDataHash: Data) async throws -> Data {
        try await DCAppAttestService.shared.generateAssertion(keyId, clientDataHash: clientDataHash)
    }
}

/// The key id in the Keychain (this device only, after first unlock).
struct KeychainAppAttestKeyStore: AppAttestKeyStore {
    private let service = "space.yardstore.app.appattest"
    private let account = "keyId"

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    func load() -> String? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func save(_ keyId: String) {
        remove()
        var q = query
        q[kSecValueData as String] = Data(keyId.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        _ = SecItemAdd(q as CFDictionary, nil)
    }

    func remove() {
        _ = SecItemDelete(query as CFDictionary)
    }
}

private struct AppAttestChallengeResponse: Decodable {
    let challenge: String?
}

private struct AppAttestRegisterResponse: Decodable {
    let registered: Bool?
}

private struct AppAttestChallengeBody: Encodable {
    let purpose: String
}

private struct AppAttestRegisterBody: Encodable {
    let keyId: String
    let attestation: String
    let challenge: String
}

/// The endpoints through `APIClient.shared` (not protected paths, so no recursion).
struct APIAppAttestServer: AppAttestServer {
    func config() async throws -> AppAttestConfig {
        try await APIClient.shared.get("/api/app/attest/config", as: AppAttestConfig.self)
    }

    func challenge(purpose: String) async throws -> String? {
        try await APIClient.shared.post("/api/app/attest/challenge", body: AppAttestChallengeBody(purpose: purpose), as: AppAttestChallengeResponse.self).challenge
    }

    func register(keyId: String, attestation: Data, challenge: String) async throws -> Bool {
        let body = AppAttestRegisterBody(keyId: keyId, attestation: attestation.base64EncodedString(), challenge: challenge)
        return try await APIClient.shared.post("/api/app/attest/register", body: body, as: AppAttestRegisterResponse.self).registered == true
    }
}
