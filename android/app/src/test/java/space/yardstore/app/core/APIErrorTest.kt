package space.yardstore.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import space.yardstore.app.core.networking.APIError
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

class APIErrorTest {
    @Test fun serverEnvelope() {
        val e = APIError.fromResponse(409, """{"error":{"code":"conflict","message":"Only 1 left.","fields":{"qty":"Too many"}}}""")
        assertEquals(409, e.status)
        assertEquals("conflict", e.code)
        assertEquals("Only 1 left.", e.message)
        assertEquals(mapOf("qty" to "Too many"), e.fields)
        assertTrue(e.isConflict)
    }

    @Test fun partialEnvelopeFallsBack() {
        val e = APIError.fromResponse(401, """{"error":{"message":"Sign in first."}}""")
        assertEquals("http_401", e.code)
        assertEquals("Sign in first.", e.message)
        assertTrue(e.isUnauthorized)
    }

    @Test fun nonJsonBodies() {
        assertEquals("Yard is having trouble right now. Try again in a moment.", APIError.fromResponse(502, "<html>Bad gateway</html>").message)
        assertEquals("We couldn't find that.", APIError.fromResponse(404, "").message)
        assertTrue(APIError.fromResponse(404, null).isNotFound)
        assertTrue(APIError.fromResponse(429, "{}").isRateLimited)
    }

    @Test fun network() {
        assertEquals("You're offline. Check your connection and try again.", APIError.network(UnknownHostException()).message)
        assertEquals("Yard took too long to answer. Try again.", APIError.network(SocketTimeoutException()).message)
        assertEquals("network", APIError.network(IOException("boom")).code)
        assertTrue(APIError.network(IOException("Canceled")).isCancelled)
        assertEquals("Something went wrong. Try again.", APIError.messageFor(IllegalStateException()))
        assertEquals("Only 1 left.", APIError.messageFor(APIError(409, "conflict", "Only 1 left.")))
    }
}
