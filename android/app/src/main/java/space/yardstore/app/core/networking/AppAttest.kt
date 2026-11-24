package space.yardstore.app.core.networking

import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.security.MessageDigest
import java.util.Base64
import kotlin.coroutines.cancellation.CancellationException

/**
 * App attestation (docs/APP.md "App attestation"): the protected calls (sign-up, password reset,
 * magic link, the Sell on Yard application) carry `X-Yard-Attest`, a Play Integrity token bound to
 * exactly that request, so a script can't pretend to be the app.
 *
 *   clientData  = "yard-attest/v1\n" + METHOD + "\n" + path + "\n" + hex(sha256(body)) + "\n" + challenge
 *   requestHash = hex(sha256(clientData))
 *   header      = base64url({"v":1,"p":"android","c":challenge,"t":token}), unpadded
 *
 * Any failure (no Play services, an emulator, offline, Play errors) sends the request without the
 * header: the app never blocks the user; the server's mode decides.
 */
object AppAttest {
    const val HEADER = "X-Yard-Attest"
    private const val VERSION = "yard-attest/v1"

    /** POST paths the server checks (src/server/http/human-check.ts). */
    val PROTECTED_PATHS: Set<String> = setOf(
        "/api/auth/sign-up",
        "/api/auth/password/forgot",
        "/api/auth/magic-link",
        "/api/studio/apply",
        "/api/studio/onboarding/submit",
    )

    fun isProtected(method: String, path: String): Boolean = method.equals("POST", ignoreCase = true) && path in PROTECTED_PATHS

    fun sha256Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    fun clientData(method: String, path: String, body: ByteArray, challenge: String): String =
        listOf(VERSION, method.uppercase(), path, sha256Hex(body), challenge).joinToString("\n")

    /** The Play Integrity requestHash (64 hex characters). */
    fun requestHash(method: String, path: String, body: ByteArray, challenge: String): String =
        sha256Hex(clientData(method, path, body, challenge).toByteArray(Charsets.UTF_8))

    fun header(challenge: String, token: String): String {
        val json = JsonObject(
            mapOf(
                "v" to JsonPrimitive(1),
                "p" to JsonPrimitive("android"),
                "c" to JsonPrimitive(challenge),
                "t" to JsonPrimitive(token),
            ),
        ).toString()
        return Base64.getUrlEncoder().withoutPadding().encodeToString(json.toByteArray(Charsets.UTF_8))
    }
}

/** Play Integrity behind an interface so tests use a fake. Implementations return null on any failure. */
interface IntegrityTokenSource {
    /** Prepares the standard token provider (call early; cheap when already prepared). */
    suspend fun warmUp(cloudProjectNumber: Long): Boolean

    /** A token for [requestHash], or null. */
    suspend fun token(requestHash: String): String?
}

/** GET /api/app/attest/config. */
@Serializable
data class AppAttestConfig(val mode: String = "off", val android: AndroidAttest? = null) {
    @Serializable
    data class AndroidAttest(val cloudProjectNumber: String = "")
}

/** POST /api/app/attest/challenge → `{ challenge, expiresAt }` (both null when off). */
@Serializable
data class AppAttestChallenge(val challenge: String? = null, val expiresAt: String? = null)

/**
 * Makes the header for one protected request. [fetchConfig] and [fetchChallenge] call the server
 * (through the same client, on paths that are not protected); both may throw, which counts as
 * "can't attest".
 */
class AppAttestor(
    private val source: IntegrityTokenSource,
    private val fetchConfig: suspend () -> AppAttestConfig,
    private val fetchChallenge: suspend () -> AppAttestChallenge,
    private val timeoutMs: Long = 15_000,
) {
    @Volatile private var config: AppAttestConfig? = null

    private fun projectNumber(c: AppAttestConfig?): Long? =
        c?.takeIf { it.mode != "off" }?.android?.cloudProjectNumber?.toLongOrNull()?.takeIf { it > 0 }

    private suspend fun loadConfig(): AppAttestConfig = fetchConfig().also { config = it }

    /** At app start: reads the server's config and prepares Play Integrity when Android is on. */
    suspend fun warmUp() {
        try {
            projectNumber(loadConfig())?.let { source.warmUp(it) }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Offline or no Play services: try again before the first protected call.
        }
    }

    /** The `X-Yard-Attest` value for this request, or null (send the request without it). */
    suspend fun headerFor(method: String, path: String, body: ByteArray): String? = try {
        withTimeoutOrNull(timeoutMs) {
            // Re-read the config each time: it is tiny, and the owner may switch attestation on later.
            val number = projectNumber(runCatching { loadConfig() }.getOrElse { config })
                ?: return@withTimeoutOrNull null
            if (!source.warmUp(number)) return@withTimeoutOrNull null
            val challenge = fetchChallenge().challenge?.takeIf { it.isNotEmpty() } ?: return@withTimeoutOrNull null
            val token = source.token(AppAttest.requestHash(method, path, body, challenge)) ?: return@withTimeoutOrNull null
            AppAttest.header(challenge, token)
        }
    } catch (e: CancellationException) {
        // withTimeoutOrNull turns its own timeout into null; anything else here is the caller's cancellation.
        throw e
    } catch (_: Exception) {
        null
    }
}
