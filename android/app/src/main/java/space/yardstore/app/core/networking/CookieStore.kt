package space.yardstore.app.core.networking

import android.content.SharedPreferences
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import space.yardstore.app.core.models.YardJson

/**
 * A cookie jar that persists every cookie (including session cookies such as `yard_s` and the
 * anonymous `yard_cart`) in SharedPreferences, so sign-in and the anonymous bag survive restarts.
 * The iOS app gets this from `HTTPCookieStorage.shared`.
 *
 * Pass `prefs = null` for an in-memory jar (unit tests, previews).
 */
class PersistentCookieJar(private val prefs: SharedPreferences?) : CookieJar {
    private val lock = Any()
    private val cookies: MutableList<Cookie> = load().toMutableList()

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        synchronized(lock) {
            for (cookie in cookies) {
                this.cookies.removeAll { it.name == cookie.name && it.domain == cookie.domain && it.path == cookie.path }
                if (cookie.expiresAt > System.currentTimeMillis()) this.cookies.add(cookie)
            }
            persist()
        }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> = synchronized(lock) {
        val now = System.currentTimeMillis()
        val expired = cookies.removeAll { it.expiresAt <= now }
        if (expired) persist()
        cookies.filter { it.matches(url) }
    }

    /** All cookies currently stored (for debugging and sign-out checks). */
    fun all(): List<Cookie> = synchronized(lock) { cookies.toList() }

    /** Removes every cookie. */
    fun clear() {
        synchronized(lock) {
            cookies.clear()
            persist()
        }
    }

    private fun load(): List<Cookie> {
        val raw = prefs?.getString(KEY, null) ?: return emptyList()
        val stored = runCatching { YardJson.decodeFromString(ListSerializer(StoredCookie.serializer()), raw) }.getOrNull()
            ?: return emptyList()
        val now = System.currentTimeMillis()
        return stored.mapNotNull { it.toCookie() }.filter { it.expiresAt > now }
    }

    private fun persist() {
        val p = prefs ?: return
        val stored = cookies.map { StoredCookie.from(it) }
        p.edit().putString(KEY, YardJson.encodeToString(ListSerializer(StoredCookie.serializer()), stored)).apply()
    }

    @Serializable
    private data class StoredCookie(
        val name: String,
        val value: String,
        val expiresAt: Long,
        val domain: String,
        val path: String,
        val secure: Boolean,
        val httpOnly: Boolean,
        val hostOnly: Boolean,
    ) {
        fun toCookie(): Cookie? = runCatching {
            Cookie.Builder()
                .name(name)
                .value(value)
                .expiresAt(expiresAt)
                .path(path)
                .apply { if (hostOnly) hostOnlyDomain(domain) else domain(domain) }
                .apply { if (secure) secure() }
                .apply { if (httpOnly) httpOnly() }
                .build()
        }.getOrNull()

        companion object {
            fun from(c: Cookie) = StoredCookie(c.name, c.value, c.expiresAt, c.domain, c.path, c.secure, c.httpOnly, c.hostOnly)
        }
    }

    private companion object {
        const val KEY = "yard.cookies"
    }
}
