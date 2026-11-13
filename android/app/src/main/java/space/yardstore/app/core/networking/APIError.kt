package space.yardstore.app.core.networking

import kotlinx.serialization.Serializable
import space.yardstore.app.core.models.YardJson
import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import kotlin.coroutines.cancellation.CancellationException

/**
 * An error from the Yard API or the network. [message] is written for people: show it.
 * Mirrors `Core/Networking/APIError.swift`.
 *
 * Server errors arrive as `{ "error": { "code": "...", "message": "...", "fields": { ... } } }`.
 */
data class APIError(
    /** HTTP status (0 for network/transport failures, -1 for decoding failures). */
    val status: Int,
    /**
     * The server's machine code, e.g. "validation", "unauthorized", "not_found", "conflict",
     * "rate_limited"; or "network", "decoding", "cancelled" for client-side failures.
     */
    val code: String,
    /** A sentence to show the user. */
    override val message: String,
    /** Per-field validation messages (form field name → message), empty when none. */
    val fields: Map<String, String> = emptyMap(),
) : Exception(message) {

    /** 401: the request needs a signed-in shopper. */
    val isUnauthorized: Boolean get() = status == 401
    /** 404. */
    val isNotFound: Boolean get() = status == 404
    /** 409: conflict (e.g. "Only 2 left."). */
    val isConflict: Boolean get() = status == 409
    /** 429. */
    val isRateLimited: Boolean get() = status == 429
    /** The request was cancelled (screen went away). Usually ignore it silently. */
    val isCancelled: Boolean get() = code == "cancelled"

    companion object {
        fun network(underlying: Throwable): APIError = when (underlying) {
            is APIError -> underlying
            is CancellationException -> APIError(0, "cancelled", "Cancelled.")
            is SocketTimeoutException -> APIError(0, "network", "Yard took too long to answer. Try again.")
            is UnknownHostException, is ConnectException ->
                APIError(0, "network", "You're offline. Check your connection and try again.")
            is InterruptedIOException -> APIError(0, "cancelled", "Cancelled.")
            is IOException -> if (underlying.message?.contains("Canceled", ignoreCase = true) == true) {
                APIError(0, "cancelled", "Cancelled.")
            } else {
                APIError(0, "network", "We couldn't reach Yard. Try again.")
            }
            else -> APIError(0, "network", "We couldn't reach Yard. Try again.")
        }

        fun decoding(underlying: Throwable): APIError {
            android.util.Log.w("APIError", "decoding failed: $underlying")
            return APIError(-1, "decoding", "Something went wrong reading Yard's answer. Try again.")
        }

        fun http(status: Int): APIError {
            val message = when (status) {
                401 -> "Sign in to continue."
                403 -> "You can't do that."
                404 -> "We couldn't find that."
                429 -> "Too many tries. Wait a moment and try again."
                in 500..599 -> "Yard is having trouble right now. Try again in a moment."
                else -> "Something went wrong. Try again."
            }
            return APIError(status, "http_$status", message)
        }

        /** Turns a non-2xx response body into an [APIError], using the server's message when present. */
        fun fromResponse(status: Int, body: String?): APIError {
            val fallback = http(status)
            val envelope = body?.takeIf { it.isNotBlank() }?.let {
                runCatching { YardJson.decodeFromString(APIErrorEnvelope.serializer(), it) }.getOrNull()
            } ?: return fallback
            return APIError(
                status = status,
                code = envelope.error.code ?: fallback.code,
                message = envelope.error.message ?: fallback.message,
                fields = envelope.error.fields ?: emptyMap(),
            )
        }

        /** A user-facing message for any error (an [APIError]'s own message, else a generic one). */
        fun messageFor(error: Throwable): String =
            (error as? APIError)?.message ?: "Something went wrong. Try again."
    }
}

/** The wire envelope `{ error: { code, message, fields? } }`. */
@Serializable
data class APIErrorEnvelope(val error: Body) {
    @Serializable
    data class Body(
        val code: String? = null,
        val message: String? = null,
        val fields: Map<String, String>? = null,
    )
}
