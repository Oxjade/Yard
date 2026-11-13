package space.yardstore.app.core.models

import kotlinx.serialization.json.Json
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneOffset

/**
 * The one JSON configuration for the Yard API (mirrors the lenient decoding in `Decoding.swift`):
 *
 * - `ignoreUnknownKeys`: new server fields never break decoding.
 * - `explicitNulls = false` + `coerceInputValues`: a `null` (or unknown enum value) for a property
 *   with a default falls back to that default, like `c.lenient(.key, fallback)`.
 * - `isLenient`: quoted numbers/booleans are accepted.
 *
 * Give every model property a default unless the server always sends it (ids). Nullable where
 * Swift is optional. The API is camelCase: Kotlin names match the wire names, no naming strategy.
 */
val YardJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    isLenient = true
    encodeDefaults = true
}

/**
 * ISO-8601 timestamps from the API ("2026-11-13T19:32:00.000Z"). Models keep the raw string and
 * expose an [Instant] via [YardDate.parse].
 */
object YardDate {
    /** Parses an API timestamp (with or without fractional seconds or an offset, or a bare yyyy-MM-dd). */
    fun parse(string: String?): Instant? {
        if (string.isNullOrEmpty()) return null
        runCatching { return Instant.parse(string) }
        runCatching { return OffsetDateTime.parse(string).toInstant() }
        runCatching { return LocalDate.parse(string).atStartOfDay(ZoneOffset.UTC).toInstant() }
        return null
    }
}
