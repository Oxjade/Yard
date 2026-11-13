import Foundation

/// An error from the Yard API or the network. `message` is written for people: show it.
///
/// Server errors arrive as `{ "error": { "code": "...", "message": "...", "fields": { ... } } }`.
struct APIError: Error, LocalizedError, Equatable, Sendable {
    /// HTTP status (0 for network/transport failures, -1 for decoding failures).
    let status: Int
    /// The server's machine code, e.g. "validation", "unauthorized", "not_found", "conflict",
    /// "rate_limited"; or "network", "decoding", "cancelled" for client-side failures.
    let code: String
    /// A sentence to show the user.
    let message: String
    /// Per-field validation messages (form field name → message), empty when none.
    let fields: [String: String]

    init(status: Int, code: String, message: String, fields: [String: String] = [:]) {
        self.status = status
        self.code = code
        self.message = message
        self.fields = fields
    }

    var errorDescription: String? { message }

    /// 401: the request needs a signed-in shopper.
    var isUnauthorized: Bool { status == 401 }
    /// 404.
    var isNotFound: Bool { status == 404 }
    /// 409: conflict (e.g. "Only 2 left.").
    var isConflict: Bool { status == 409 }
    /// 429.
    var isRateLimited: Bool { status == 429 }
    /// The request was cancelled (view went away). Usually ignore it silently.
    var isCancelled: Bool { code == "cancelled" }

    static func network(_ underlying: Error) -> APIError {
        if let urlError = underlying as? URLError {
            switch urlError.code {
            case .cancelled:
                return APIError(status: 0, code: "cancelled", message: "Cancelled.")
            case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed:
                return APIError(status: 0, code: "network", message: "You're offline. Check your connection and try again.")
            case .timedOut:
                return APIError(status: 0, code: "network", message: "Yard took too long to answer. Try again.")
            default:
                break
            }
        }
        if underlying is CancellationError {
            return APIError(status: 0, code: "cancelled", message: "Cancelled.")
        }
        return APIError(status: 0, code: "network", message: "We couldn't reach Yard. Try again.")
    }

    static func decoding(_ underlying: Error) -> APIError {
        #if DEBUG
        print("[APIError] decoding failed:", underlying)
        #endif
        return APIError(status: -1, code: "decoding", message: "Something went wrong reading Yard's answer. Try again.")
    }

    static func http(status: Int) -> APIError {
        let message: String
        switch status {
        case 401: message = "Sign in to continue."
        case 403: message = "You can't do that."
        case 404: message = "We couldn't find that."
        case 429: message = "Too many tries. Wait a moment and try again."
        case 500...599: message = "Yard is having trouble right now. Try again in a moment."
        default: message = "Something went wrong. Try again."
        }
        return APIError(status: status, code: "http_\(status)", message: message)
    }

    /// A user-facing message for any error (an `APIError`'s own message, else a generic one).
    static func message(for error: Error) -> String {
        if let api = error as? APIError { return api.message }
        return "Something went wrong. Try again."
    }
}

/// The wire envelope `{ error: { code, message, fields? } }`.
struct APIErrorEnvelope: Decodable {
    struct Body: Decodable {
        let code: String?
        let message: String?
        let fields: [String: String]?
    }
    let error: Body
}
