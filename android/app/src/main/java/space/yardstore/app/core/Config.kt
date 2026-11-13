package space.yardstore.app.core

import android.content.Context
import android.content.SharedPreferences
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * App-wide configuration: the API base URL and media URL resolution. Mirrors `Core/Config.swift`.
 *
 * URLs are plain `String`s (absolute, ready for Coil, OkHttp or `Uri.parse`).
 */
object Config {
    /** The production site. Every API path and relative media path resolves against [baseUrl]. */
    const val PRODUCTION_BASE_URL: String = "https://yardstore.space"

    /** SharedPreferences key for a development override, e.g. `http://192.168.1.20:3000`. */
    const val BASE_URL_OVERRIDE_KEY: String = "yard.baseURLOverride"

    /** The app's SharedPreferences file (small synchronous settings: base URL override, currency). */
    const val PREFS_NAME: String = "yard"

    private var prefs: SharedPreferences? = null

    /** Called once by `YardApp.onCreate`. Unit tests never call it (production URL). */
    fun init(context: Context) {
        prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    }

    /** The app's SharedPreferences, or null before [init] (unit tests). */
    val preferences: SharedPreferences? get() = prefs

    /** The base URL in use (the override when one is set and valid, else production). No trailing slash. */
    val baseUrl: String
        get() {
            val raw = prefs?.getString(BASE_URL_OVERRIDE_KEY, null)
            val parsed = raw?.toHttpUrlOrNull()
            return if (parsed != null) raw.trimEnd('/') else PRODUCTION_BASE_URL
        }

    /** [baseUrl] as an OkHttp [HttpUrl]. */
    val baseHttpUrl: HttpUrl get() = baseUrl.toHttpUrlOrNull() ?: PRODUCTION_BASE_URL.toHttpUrlOrNull()!!

    /** The `Origin` header value non-GET requests must carry (scheme + host + port of [baseUrl]). */
    val origin: String
        get() {
            val url = baseHttpUrl
            val defaultPort = HttpUrl.defaultPort(url.scheme)
            return if (url.port != defaultPort) "${url.scheme}://${url.host}:${url.port}" else "${url.scheme}://${url.host}"
        }

    /**
     * Resolves a media or page path from the API to an absolute URL.
     *
     * - `null` / blank → `null`
     * - `https://…` / `http://…` → unchanged
     * - `//cdn…` → `https:` prefixed
     * - `/api/media/…`, `/site/…`, `/media/…` → [baseUrl] + path (query kept)
     * - anything else (a bare relative path) → [baseUrl] + "/" + path
     */
    fun url(path: String?): String? {
        val raw = path?.trim().orEmpty()
        if (raw.isEmpty()) return null
        val lower = raw.lowercase()
        if (lower.startsWith("http://") || lower.startsWith("https://")) return raw
        if (raw.startsWith("//")) return "https:$raw"
        val rooted = if (raw.startsWith("/")) raw else "/$raw"
        return baseHttpUrl.resolve(rooted)?.toString()
    }

    /** The web URL for a site path, e.g. `Config.webUrl("/brands/acme")` for share sheets. */
    fun webUrl(path: String): String = url(path) ?: baseUrl

    /** `/api/media/{id}`: the public URL path of a media id (same as the server's `mediaSrc`). */
    fun mediaPath(id: String): String = "/api/media/${encodePath(id)}"

    /** Percent-encodes a value for use inside a URL path (keeps `/` and the RFC 3986 path characters). */
    fun encodePath(value: String): String {
        val allowed = "-._~!$&'()*+,;=:@/"
        val sb = StringBuilder()
        for (byte in value.toByteArray(Charsets.UTF_8)) {
            val c = byte.toInt() and 0xFF
            val ch = c.toChar()
            if (c < 0x80 && (ch.isLetterOrDigit() || allowed.indexOf(ch) >= 0)) {
                sb.append(ch)
            } else {
                sb.append('%').append("0123456789ABCDEF"[c shr 4]).append("0123456789ABCDEF"[c and 0xF])
            }
        }
        return sb.toString()
    }
}
