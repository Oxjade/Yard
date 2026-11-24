import Foundation

/// HTTP methods the API uses.
enum HTTPMethod: String, Sendable {
    case get = "GET"
    case post = "POST"
    case put = "PUT"
    case patch = "PATCH"
    case delete = "DELETE"
}

/// Decode target for endpoints whose body you don't need (`{ ok: true }`, 204 No Content).
struct EmptyResponse: Decodable, Sendable {
    init() {}
    init(from decoder: Decoder) throws {}
}

/// The one HTTP client for the Yard API.
///
/// - Base URL: `Config.baseURL`; pass paths like `"/api/catalog/products"`.
/// - Headers: `X-Yard-Client: 1` on every request; `Origin` + `Content-Type: application/json`
///   on every non-GET (the server's CSRF rule).
/// - Cookies: `HTTPCookieStorage.shared`, so the session cookie (`yard_s`) persists after sign-in.
/// - Errors: throws `APIError` (server `{error:{code,message,fields}}` decoded; show `.message`).
/// - Timeout: 30 s.
///
/// Usage:
/// ```swift
/// let page = try await APIClient.shared.get("/api/catalog/products",
///                                           query: [URLQueryItem(name: "limit", value: "24")],
///                                           as: ProductsPage.self)
/// let result: FollowResult = try await APIClient.shared.post("/api/follows", body: FollowBody(brandId: id))
/// try await APIClient.shared.send(.delete, "/api/cart/lines/\(variantId)")   // ignore the body
/// ```
final class APIClient: @unchecked Sendable {
    static let shared = APIClient(attestor: AppAttestor.live)

    let session: URLSession
    let decoder: JSONDecoder
    let encoder: JSONEncoder
    /// App attestation for the protected calls (sign-up, reset, magic link, apply): they carry
    /// `X-Yard-Attest` when the attestor can make one (`AppAttest.swift`). Nil: never attested.
    let attestor: AppAttestor?

    init(session: URLSession? = nil, attestor: AppAttestor? = nil) {
        self.attestor = attestor
        if let session {
            self.session = session
        } else {
            let config = URLSessionConfiguration.default
            config.httpCookieStorage = HTTPCookieStorage.shared
            config.httpCookieAcceptPolicy = .always
            config.httpShouldSetCookies = true
            config.timeoutIntervalForRequest = 30
            config.timeoutIntervalForResource = 60
            config.waitsForConnectivity = false
            config.requestCachePolicy = .useProtocolCachePolicy
            self.session = URLSession(configuration: config)
        }
        self.decoder = JSONDecoder() // camelCase API: no key strategy; dates stay ISO strings.
        self.encoder = JSONEncoder()
    }

    // MARK: Typed convenience

    /// GET and decode.
    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = [], as type: T.Type = T.self) async throws -> T {
        try await request(.get, path, query: query, body: nil, as: type)
    }

    /// POST a JSON body (any `Encodable`, e.g. a struct or `["brandId": id]`) and decode.
    func post<T: Decodable>(_ path: String, body: (any Encodable)? = nil, query: [URLQueryItem] = [], as type: T.Type = T.self) async throws -> T {
        try await request(.post, path, query: query, body: body, as: type)
    }

    /// PUT a JSON body and decode.
    func put<T: Decodable>(_ path: String, body: (any Encodable)? = nil, query: [URLQueryItem] = [], as type: T.Type = T.self) async throws -> T {
        try await request(.put, path, query: query, body: body, as: type)
    }

    /// PATCH a JSON body and decode.
    func patch<T: Decodable>(_ path: String, body: (any Encodable)? = nil, query: [URLQueryItem] = [], as type: T.Type = T.self) async throws -> T {
        try await request(.patch, path, query: query, body: body, as: type)
    }

    /// DELETE and decode (use `send(.delete, …)` when the response body doesn't matter).
    func delete<T: Decodable>(_ path: String, query: [URLQueryItem] = [], as type: T.Type = T.self) async throws -> T {
        try await request(.delete, path, query: query, body: nil, as: type)
    }

    /// Any method; the response body is ignored (204s, `{ ok: true }`). Still throws `APIError`.
    func send(_ method: HTTPMethod, _ path: String, body: (any Encodable)? = nil, query: [URLQueryItem] = []) async throws {
        _ = try await data(method, path, query: query, body: body)
    }

    // MARK: Core

    /// Performs the request and decodes `T`. An empty body decodes as `{}` (works for `EmptyResponse`
    /// and for structs whose properties are all optional).
    func request<T: Decodable>(_ method: HTTPMethod, _ path: String, query: [URLQueryItem] = [], body: (any Encodable)? = nil, as type: T.Type = T.self) async throws -> T {
        let raw = try await data(method, path, query: query, body: body)
        let payload = raw.isEmpty ? Data("{}".utf8) : raw
        do {
            return try decoder.decode(T.self, from: payload)
        } catch {
            throw APIError.decoding(error)
        }
    }

    /// Performs the request and returns the raw body of a 2xx response; throws `APIError` otherwise.
    func data(_ method: HTTPMethod, _ path: String, query: [URLQueryItem] = [], body: (any Encodable)? = nil) async throws -> Data {
        var request = try makeRequest(method, path, query: query, body: body)
        let attested = await attest(&request)
        let result: (Data, URLResponse)
        do {
            result = try await session.data(for: request)
        } catch {
            throw APIError.network(error)
        }
        let data = result.0
        let response = result.1
        guard let http = response as? HTTPURLResponse else {
            throw APIError(status: 0, code: "network", message: "We couldn't reach Yard. Try again.")
        }
        guard (200..<300).contains(http.statusCode) else {
            let error = Self.error(status: http.statusCode, data: data)
            // The server refused this install's attestation (enforce mode): register a new key next time.
            if attested, error.fields["attest"] != nil, let attestor { await attestor.forgetKey() }
            throw error
        }
        return data
    }

    /// Adds `X-Yard-Attest` to a protected request when the attestor can make one. True when added.
    func attest(_ request: inout URLRequest) async -> Bool {
        guard let attestor, let method = request.httpMethod, let url = request.url,
              AppAttest.isProtected(method: method, path: url.path) else { return false }
        guard let value = await attestor.headerValue(method: method, path: url.path, body: request.httpBody ?? Data()) else { return false }
        request.setValue(value, forHTTPHeaderField: AppAttest.header)
        return true
    }

    /// Builds a `URLRequest` with Yard's required headers. Exposed for uploads/streams that need
    /// to tweak the request (e.g. multipart) before sending it through `session`.
    func makeRequest(_ method: HTTPMethod, _ path: String, query: [URLQueryItem] = [], body: (any Encodable)? = nil) throws -> URLRequest {
        guard var components = URLComponents(url: Config.url(for: path) ?? Config.baseURL, resolvingAgainstBaseURL: true) else {
            throw APIError(status: 0, code: "bad_url", message: "Something went wrong. Try again.")
        }
        if !query.isEmpty {
            var items = components.queryItems ?? []
            items.append(contentsOf: query)
            components.queryItems = items
            // "+" is a literal plus in our query values; encode it so the server doesn't read a space.
            components.percentEncodedQuery = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        }
        guard let url = components.url else {
            throw APIError(status: 0, code: "bad_url", message: "Something went wrong. Try again.")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method.rawValue
        request.timeoutInterval = 30
        request.setValue("1", forHTTPHeaderField: "X-Yard-Client")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if method != .get {
            request.setValue(Config.origin, forHTTPHeaderField: "Origin")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let body {
            do {
                request.httpBody = try encoder.encode(body)
            } catch {
                throw APIError(status: 0, code: "encoding", message: "Something went wrong. Try again.")
            }
        }
        return request
    }

    /// Turns a non-2xx response into an `APIError`, using the server's message when present.
    static func error(status: Int, data: Data) -> APIError {
        if let envelope = try? JSONDecoder().decode(APIErrorEnvelope.self, from: data) {
            let fallback = APIError.http(status: status)
            return APIError(
                status: status,
                code: envelope.error.code ?? fallback.code,
                message: envelope.error.message ?? fallback.message,
                fields: envelope.error.fields ?? [:]
            )
        }
        return APIError.http(status: status)
    }

    /// Removes every cookie for the API host (used after sign-out as a belt-and-braces clear).
    func clearCookies() {
        let storage = HTTPCookieStorage.shared
        guard let cookies = storage.cookies(for: Config.baseURL) else { return }
        for cookie in cookies { storage.deleteCookie(cookie) }
    }
}
