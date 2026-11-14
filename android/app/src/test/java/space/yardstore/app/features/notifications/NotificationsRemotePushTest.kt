package space.yardstore.app.features.notifications

import kotlinx.coroutines.runBlocking
import okhttp3.CookieJar
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import space.yardstore.app.BuildConfig
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.stores.SessionStore

class NotificationsRemotePushTest {
    private lateinit var server: MockWebServer
    private lateinit var api: APIClient

    @Before fun setUp() {
        server = MockWebServer()
        server.start()
        val base = server.url("/")
        // Relative paths (SessionStore) resolve against the production host: send them here instead.
        val http = APIClient.buildHttpClient(CookieJar.NO_COOKIES).newBuilder()
            .addInterceptor { chain ->
                val original = chain.request()
                val rewritten = original.url.newBuilder().scheme(base.scheme).host(base.host).port(base.port).build()
                chain.proceed(original.newBuilder().url(rewritten).build())
            }
            .build()
        api = APIClient(http)
        PushDevicesAPI.clientOverride = api
    }

    @After fun tearDown() {
        PushDevicesAPI.clientOverride = null
        YardPushCenter.deviceToken = null
        server.shutdown()
    }

    private fun noContent() = MockResponse().setResponseCode(204)
    private fun json(body: String, code: Int = 200) =
        MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    // Message → notification

    @Test fun mapsServerPayload() {
        val m = YardPushMessage.from(
            title = "Your order shipped",
            body = "Acme sent part of your order.",
            data = mapOf("url" to "/you/orders/ord_1", "kind" to "order_update", "id" to "ntf_9"),
        )!!
        assertEquals(YardPushMessage(id = "ntf_9", title = "Your order shipped", body = "Acme sent part of your order.", href = "/you/orders/ord_1", kind = "order_update"), m)
        assertEquals("yard_updates", m.channelId)
        assertEquals("ntf_9", m.tag)
    }

    @Test fun fallsBackToDataTitleAndNotificationsList() {
        val m = YardPushMessage.from(null, null, mapOf("title" to "New reply", "body" to "Hi!", "url" to "https://evil.example/x"))!!
        assertEquals("New reply", m.title)
        assertEquals("Hi!", m.body)
        assertEquals("/notifications", m.href)
        assertNull(m.id)
        assertNull(m.tag)
        assertNull(YardPushMessage.from(" ", null, emptyMap()))
        assertEquals("Yard", YardPushMessage.from(null, "Body only", emptyMap())!!.title)
    }

    @Test fun onlySameOriginPathsAreOpened() {
        assertEquals("/inbox?thread=cv_1", YardPushMessage.safeHref("/inbox?thread=cv_1"))
        assertNull(YardPushMessage.safeHref("//evil.example/x"))
        assertNull(YardPushMessage.safeHref("https://yardstore.space/x"))
        assertNull(YardPushMessage.safeHref("/\\evil"))
        assertNull(YardPushMessage.safeHref("/a b"))
        assertNull(YardPushMessage.safeHref(null))
    }

    @Test fun backgroundTapExtras() {
        val push = mapOf("google.message_id" to "0:1", "url" to "/drops/night-shift", "id" to "ntf_1")
        assertEquals("/drops/night-shift", YardPushMessage.hrefFromTapExtras { push[it] })
        val noUrl = mapOf("google.message_id" to "0:1")
        assertEquals("", YardPushMessage.hrefFromTapExtras { noUrl[it] })
        val notPush = mapOf("url" to "/drops/x")
        assertNull(YardPushMessage.hrefFromTapExtras { notPush[it] })
    }

    // Device registration

    @Test fun registerSendsExactBodyAndHeaders() = runBlocking {
        server.enqueue(noContent())
        PushDevicesAPI.register("fcm-token-1")
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/devices", req.path)
        assertEquals("""{"platform":"android","token":"fcm-token-1","appVersion":"${BuildConfig.VERSION_NAME}"}""", req.body.readUtf8())
        assertEquals("1", req.getHeader("X-Yard-Client"))
        assertEquals("https://yardstore.space", req.getHeader("Origin"))
        assertTrue(req.getHeader("Content-Type")!!.startsWith("application/json"))
    }

    @Test fun unregisterSendsExactBodyAndHeaders() = runBlocking {
        server.enqueue(json("""{"ok":true}"""))
        PushDevicesAPI.unregister("fcm-token-1")
        val req = server.takeRequest()
        assertEquals("DELETE", req.method)
        assertEquals("/api/devices", req.path)
        assertEquals("""{"token":"fcm-token-1"}""", req.body.readUtf8())
        assertEquals("1", req.getHeader("X-Yard-Client"))
        assertEquals("https://yardstore.space", req.getHeader("Origin"))
        assertTrue(req.getHeader("Content-Type")!!.startsWith("application/json"))
    }

    @Test fun uploadIgnoresFailures() = runBlocking {
        server.enqueue(json("""{"error":{"code":"unauthorized","message":"Sign in first."}}""", 401))
        YardPushCenter.upload("t") // must not throw
        assertEquals("/api/devices", server.takeRequest().path)
    }

    // Sign-out

    @Test fun signOutDeletesTheDeviceFirst() = runBlocking {
        val session = SessionStore(api)
        YardPushCenter.hookSignOut(session)
        YardPushCenter.deviceToken = "fcm-token-2"
        server.enqueue(noContent()) // DELETE /api/devices
        server.enqueue(json("""{"ok":true}""")) // POST /api/auth/sign-out
        server.enqueue(json("""{"shopper":null}""")) // GET /api/session
        session.signOut()
        val first = server.takeRequest()
        assertEquals("DELETE /api/devices", "${first.method} ${first.path}")
        assertEquals("""{"token":"fcm-token-2"}""", first.body.readUtf8())
        val second = server.takeRequest()
        assertEquals("POST /api/auth/sign-out?actor=shopper", "${second.method} ${second.path}")
    }

    @Test fun signOutStillHappensWhenDeleteFails() = runBlocking {
        val session = SessionStore(api)
        YardPushCenter.hookSignOut(session)
        YardPushCenter.deviceToken = "fcm-token-3"
        server.enqueue(json("""{"error":{"code":"server_error","message":"Down"}}""", 500))
        server.enqueue(json("""{"ok":true}"""))
        server.enqueue(json("""{"shopper":null}"""))
        session.signOut()
        assertEquals("/api/devices", server.takeRequest().path)
        assertEquals("/api/auth/sign-out?actor=shopper", server.takeRequest().path)
        assertNull(session.shopper)
    }
}
