package space.yardstore.app.features.you

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import okhttp3.CookieJar
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.ToastCenter

/** YouNotificationsModel and YouSecurityModel against a mock server with the website's JSON. */
@OptIn(ExperimentalCoroutinesApi::class)
class YouViewModelsTest {
    private lateinit var server: MockWebServer
    private lateinit var api: APIClient
    private lateinit var root: String
    private lateinit var toast: ToastCenter
    private lateinit var mainExecutor: ExecutorService

    @Before fun setUp() {
        // A real (non-test) main dispatcher: the toast's auto-dismiss delay must not be skipped by
        // runTest's virtual time while a request waits on the mock server.
        mainExecutor = Executors.newSingleThreadExecutor()
        Dispatchers.setMain(mainExecutor.asCoroutineDispatcher())
        server = MockWebServer()
        server.start()
        api = APIClient(APIClient.buildHttpClient(CookieJar.NO_COOKIES))
        root = server.url("").toString().trimEnd('/')
        toast = ToastCenter()
    }

    @After fun tearDown() {
        server.shutdown()
        Dispatchers.resetMain()
        mainExecutor.shutdownNow()
    }

    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    private val prefsAllOn = """{"preferences":{"email":{"drops":true,"price_drops":true,"back_in_stock":true,"brand_news":true},
        "inApp":{"drops":true,"price_drops":true,"back_in_stock":true,"brand_news":true}}}"""
    private val prefsEmailOff = """{"preferences":{"email":{"drops":false,"price_drops":false,"back_in_stock":false,"brand_news":false},
        "inApp":{"drops":true,"price_drops":false,"back_in_stock":true,"brand_news":false}}}"""
    private val serverError = """{"error":{"code":"internal","message":"Something went wrong on our side."}}"""

    // MARK: Notifications

    @Test fun notificationsLoad() = runTest {
        server.enqueue(json(prefsAllOn))
        server.enqueue(json("""{"readReceipts":false}"""))
        val m = YouNotificationsModel(api, root)
        m.fetch()
        assertEquals(YouNotificationsModel.Phase.Loaded, m.phase)
        assertTrue(m.emailOn)
        assertEquals(false, m.readReceipts)
        assertEquals("/api/notifications/preferences?as=shopper", server.takeRequest().path)
        assertEquals("/api/inbox/settings", server.takeRequest().path)
    }

    @Test fun notificationsLoadFailureShowsMessage() = runTest {
        server.enqueue(json(serverError, 500))
        val m = YouNotificationsModel(api, root)
        m.fetch()
        assertEquals(YouNotificationsModel.Phase.Failed("Something went wrong on our side."), m.phase)
    }

    @Test fun readReceiptsFailureOnlyHidesThatRow() = runTest {
        server.enqueue(json(prefsAllOn))
        server.enqueue(json("""{"error":{"code":"unauthorized","message":"Sign in."}}""", 401))
        val m = YouNotificationsModel(api, root)
        m.fetch()
        assertEquals(YouNotificationsModel.Phase.Loaded, m.phase)
        assertNull(m.readReceipts)
    }

    @Test fun topicWritesEmailFlagOnlyWhileEmailIsOn() = runTest {
        server.enqueue(json(prefsAllOn)); server.enqueue(json("""{"readReceipts":true}"""))
        val m = YouNotificationsModel(api, root)
        m.fetch(); server.takeRequest(); server.takeRequest()

        server.enqueue(json(prefsAllOn.replace("\"price_drops\":true", "\"price_drops\":false")))
        m.setTopicNow(YouNotifyTopic.PriceDrops, false, toast)
        val req = server.takeRequest()
        assertEquals("PATCH", req.method)
        assertEquals("/api/notifications/preferences?as=shopper", req.path)
        assertEquals("""{"email":{"price_drops":false},"inApp":{"price_drops":false}}""", req.body.readUtf8())
        assertEquals("Promotions off. Saved.", m.lastChange)
        assertEquals(false, m.prefs.inApp.priceDrops)

        // Email off: a topic switch never restarts email.
        val off = YouNotificationsModel(api, root)
        server.enqueue(json(prefsEmailOff)); server.enqueue(json("""{"readReceipts":true}"""))
        off.fetch(); server.takeRequest(); server.takeRequest()
        server.enqueue(json(prefsEmailOff))
        off.setTopicNow(YouNotifyTopic.BrandNews, true, toast)
        assertEquals("""{"inApp":{"brand_news":true}}""", server.takeRequest().body.readUtf8())
    }

    @Test fun failedSaveRollsBackAndToasts() = runTest {
        server.enqueue(json(prefsAllOn)); server.enqueue(json("""{"readReceipts":true}"""))
        val m = YouNotificationsModel(api, root)
        m.fetch()
        server.enqueue(json(serverError, 500))
        m.setTopicNow(YouNotifyTopic.Drops, false, toast)
        assertEquals(true, m.prefs.inApp.drops)
        assertEquals(true, m.prefs.email.drops)
        assertEquals(Toast.Style.Error, toast.current?.style)
        assertEquals("Notification settings weren't saved. Try again.", toast.current?.message)
        assertNull(m.lastChange)
    }

    @Test fun emailSwitchFollowsInAppTopics() = runTest {
        server.enqueue(json(prefsEmailOff)); server.enqueue(json("""{"readReceipts":true}"""))
        val m = YouNotificationsModel(api, root)
        m.fetch(); server.takeRequest(); server.takeRequest()
        assertTrue(!m.emailOn)

        server.enqueue(json(prefsAllOn))
        m.setEmailNow(true, toast)
        assertEquals(
            """{"email":{"drops":true,"price_drops":false,"back_in_stock":true,"brand_news":false}}""",
            server.takeRequest().body.readUtf8(),
        )
        assertEquals("Email notifications on. Saved.", m.lastChange)

        server.enqueue(json(prefsEmailOff))
        m.setEmailNow(false, toast)
        assertEquals(
            """{"email":{"drops":false,"price_drops":false,"back_in_stock":false,"brand_news":false}}""",
            server.takeRequest().body.readUtf8(),
        )
        assertTrue(!m.emailOn)
    }

    @Test fun readReceiptsToggle() = runTest {
        server.enqueue(json(prefsAllOn)); server.enqueue(json("""{"readReceipts":true}"""))
        val m = YouNotificationsModel(api, root)
        m.fetch(); server.takeRequest(); server.takeRequest()

        server.enqueue(json("""{"readReceipts":false}"""))
        m.setReadReceiptsNow(false, toast)
        val req = server.takeRequest()
        assertEquals("PATCH", req.method)
        assertEquals("""{"readReceipts":false}""", req.body.readUtf8())
        assertEquals(false, m.readReceipts)
        assertEquals("Read receipts off. Saved.", m.lastChange)

        server.enqueue(json(serverError, 500))
        m.setReadReceiptsNow(true, toast)
        assertEquals(false, m.readReceipts)
        assertEquals(Toast.Style.Error, toast.current?.style)
    }

    // MARK: Security

    private val securityJson = """{"method":"password","demo":false,"emailVerified":true,"hasPassword":true,
        "identities":[{"id":"idn_1","provider":"google","email":"ada@example.com"}],
        "providers":{"google":true,"apple":false},"mfa":null,"reauthAgeSec":null,"deletion":null}"""

    @Test fun securityLoadAndFailure() = runTest {
        val m = YouSecurityModel(api, root)
        assertEquals(YouSecurityModel.Phase.Idle, m.phase)
        server.enqueue(json(securityJson))
        m.fetch()
        assertEquals(YouSecurityModel.Phase.Loaded, m.phase)
        assertEquals("/api/auth/security?as=shopper", server.takeRequest().path)
        assertEquals(1, m.security?.identities?.size)

        // A failed refresh keeps what was loaded.
        server.enqueue(json(serverError, 500))
        m.fetch()
        assertEquals(YouSecurityModel.Phase.Loaded, m.phase)

        m.reset()
        assertNull(m.security)
        server.enqueue(json(serverError, 500))
        m.fetch()
        assertEquals(YouSecurityModel.Phase.Failed("Something went wrong on our side."), m.phase)
    }

    @Test fun unlinkIdentity() = runTest {
        val m = YouSecurityModel(api, root)
        server.enqueue(json(securityJson)); m.fetch(); server.takeRequest()

        server.enqueue(json("""{"ok":true}"""))
        server.enqueue(json(securityJson.replace("""{"id":"idn_1","provider":"google","email":"ada@example.com"}""", "")))
        m.unlinkNow(YouIdentity("idn_1", "google", "ada@example.com"), toast)
        val req = server.takeRequest()
        assertEquals("DELETE", req.method)
        assertEquals("/api/auth/identities/idn_1?as=shopper", req.path)
        assertEquals("Google disconnected.", toast.current?.message)
        assertEquals(0, m.security?.identities?.size)
        assertNull(m.unlinkingId)

        // 422: the only way left to sign in.
        server.enqueue(json("""{"error":{"code":"validation","message":"Set a password before you disconnect your last sign-in method."}}""", 422))
        m.unlinkNow(YouIdentity("idn_2", "apple", null), toast)
        assertEquals("Set a password before you disconnect your last sign-in method.", toast.current?.message)
        assertEquals(Toast.Style.Error, toast.current?.style)
    }
}
