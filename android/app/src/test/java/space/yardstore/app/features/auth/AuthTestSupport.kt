package space.yardstore.app.features.auth

import org.junit.Assert.assertTrue

/** Waits (real time) for work launched on viewModelScope with an Unconfined main dispatcher. */
internal fun waitUntil(timeoutMs: Long = 5000, condition: () -> Boolean) {
    val end = System.currentTimeMillis() + timeoutMs
    while (!condition() && System.currentTimeMillis() < end) Thread.sleep(10)
    assertTrue("condition not met within ${timeoutMs}ms", condition())
}
