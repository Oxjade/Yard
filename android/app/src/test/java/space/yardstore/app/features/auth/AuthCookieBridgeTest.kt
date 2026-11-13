package space.yardstore.app.features.auth

import okhttp3.Cookie
import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.PersistentCookieJar

class AuthCookieBridgeTest {
    private lateinit var previous: APIClient
    private lateinit var jar: PersistentCookieJar
    private val base = "https://yardstore.space/".toHttpUrl()

    @Before fun setUp() {
        previous = APIClient.shared
        jar = PersistentCookieJar(null)
        APIClient.install(APIClient(APIClient.buildHttpClient(jar)))
    }

    @After fun tearDown() {
        APIClient.install(previous)
    }

    @Test fun belongsToAPI() {
        assertTrue(AuthCookieBridge.belongsToAPI("yardstore.space"))
        assertTrue(AuthCookieBridge.belongsToAPI(".yardstore.space"))
        assertFalse(AuthCookieBridge.belongsToAPI("google.com"))
        assertFalse(AuthCookieBridge.belongsToAPI("evilyardstore.space"))
    }

    @Test fun importsSessionAndDropsBindingCookie() {
        // The app jar before the flow: the OAuth binding cookie from /start and a guest cart.
        jar.saveFromResponse(base, listOf(
            Cookie.parse(base, "__Host-yard_oauth=bind123; Path=/; Secure; HttpOnly; Max-Age=600")!!,
            Cookie.parse(base, "yard_cart=c_1; Path=/; Secure; HttpOnly; Max-Age=2592000")!!,
        ))
        val gotSession = AuthCookieBridge.importCookies(listOf(
            "__Host-yard_s" to "sess.sig",
            "yard_cart" to "c_2",
            "__Host-yard_oauth" to "bind123",
        ))
        assertTrue(gotSession)
        val byName = jar.all().associateBy { it.name }
        assertNull(byName["__Host-yard_oauth"])
        assertEquals("sess.sig", byName["__Host-yard_s"]!!.value)
        assertTrue(byName["__Host-yard_s"]!!.secure)
        assertTrue(byName["__Host-yard_s"]!!.hostOnly)
        assertEquals("c_2", byName["yard_cart"]!!.value)
        assertEquals(1, jar.all().count { it.name == "yard_cart" })
        // The imported session is sent on the next API request.
        assertTrue(jar.loadForRequest("https://yardstore.space/api/session".toHttpUrl()).any { it.name == "__Host-yard_s" })
    }

    @Test fun noSessionWhenFlowEndedWithoutOne() {
        assertFalse(AuthCookieBridge.importCookies(listOf("yard_cart" to "c_1")))
        assertFalse(AuthCookieBridge.importCookies(emptyList()))
    }
}
