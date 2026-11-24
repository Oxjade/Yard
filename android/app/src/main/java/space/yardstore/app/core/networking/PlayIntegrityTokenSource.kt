package space.yardstore.app.core.networking

import android.content.Context
import com.google.android.gms.tasks.Task
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.StandardIntegrityManager
import com.google.android.play.core.integrity.StandardIntegrityManager.PrepareIntegrityTokenRequest
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenProvider
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenRequest
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.coroutines.cancellation.CancellationException
import kotlin.coroutines.resume

/**
 * Google Play Integrity, standard requests: the token provider is prepared once (warm-up at app
 * start) and asked for a token per protected request. Every failure is null: a phone without Play
 * services, an emulator, an app not installed from Play, a network error.
 */
class PlayIntegrityTokenSource(context: Context) : IntegrityTokenSource {
    private val manager: StandardIntegrityManager = IntegrityManagerFactory.createStandard(context.applicationContext)
    private val lock = Mutex()
    @Volatile private var provider: StandardIntegrityTokenProvider? = null
    @Volatile private var preparedFor: Long = 0

    override suspend fun warmUp(cloudProjectNumber: Long): Boolean = lock.withLock {
        if (provider != null && preparedFor == cloudProjectNumber) return@withLock true
        val request = PrepareIntegrityTokenRequest.builder().setCloudProjectNumber(cloudProjectNumber).build()
        val prepared = manager.prepareIntegrityToken(request).awaitOrNull()
        provider = prepared
        preparedFor = if (prepared != null) cloudProjectNumber else 0
        prepared != null
    }

    override suspend fun token(requestHash: String): String? {
        val first = request(requestHash)
        if (first != null) return first
        // A provider can expire: prepare again once, then retry.
        val number = preparedFor
        if (number == 0L) return null
        provider = null
        return if (warmUp(number)) request(requestHash) else null
    }

    private suspend fun request(requestHash: String): String? {
        val p = provider ?: return null
        val req = StandardIntegrityTokenRequest.builder().setRequestHash(requestHash).build()
        return p.request(req).awaitOrNull()?.token()
    }
}

/** Waits for a Play Task; null when it fails (never throws, except cancellation). */
private suspend fun <T> Task<T>.awaitOrNull(): T? = try {
    suspendCancellableCoroutine { cont ->
        addOnSuccessListener { value -> if (cont.isActive) cont.resume(value) }
        addOnFailureListener { if (cont.isActive) cont.resume(null) }
        addOnCanceledListener { if (cont.isActive) cont.resume(null) }
    }
} catch (e: CancellationException) {
    throw e
} catch (_: Exception) {
    null
}
