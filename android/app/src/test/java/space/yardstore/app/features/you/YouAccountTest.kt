package space.yardstore.app.features.you

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import okhttp3.CookieJar
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import space.yardstore.app.core.models.YardJson
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.features.auth.AuthAPI
import space.yardstore.app.features.auth.AuthEmailChangeResponse
import space.yardstore.app.features.auth.AuthEmailLinks
import java.util.Collections

/** Settings › Your details: name and email change against a mock server with the contract's JSON (docs/APP.md › Account). */
@OptIn(ExperimentalCoroutinesApi::class)
class YouAccountTest {
    private val server = MockWebServer()
    private val requests: MutableList<RecordedRequest> = Collections.synchronizedList(mutableListOf())
    private val routes = Collections.synchronizedMap(LinkedHashMap<String, ArrayDeque<MockResponse>>())
    private lateinit var api: APIClient
    private lateinit var root: String

    private fun on(method: String, path: String, status: Int = 200, body: String = "") {
        val r = MockResponse().setResponseCode(status).setHeader("Content-Type", "application/json").setBody(body)
        routes.getOrPut("$method $path") { ArrayDeque() }.addLast(r)
    }

    private fun sent(method: String, path: String): List<RecordedRequest> =
        synchronized(requests) { requests.filter { it.method == method && it.requestUrl!!.encodedPath == path } }

    @Before fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requests += request
                val queue = routes["${request.method} ${request.requestUrl!!.encodedPath}"]
                    ?: return MockResponse().setResponseCode(404).setBody("""{"error":{"code":"not_found","message":"Not found."}}""")
                return synchronized(queue) { if (queue.size > 1) queue.removeFirst() else queue.first() }
            }
        }
        server.start()
        api = APIClient(APIClient.buildHttpClient(CookieJar.NO_COOKIES))
        root = server.url("").toString().trimEnd('/')
    }

    @After fun tearDown() {
        AuthAPI.clientOverride = null
        AuthAPI.baseOverride = null
        server.shutdown()
        Dispatchers.resetMain()
    }

    /** `AccountDto` exactly as docs/APP.md. */
    private fun account(
        name: String = "Ada Nwosu",
        email: String = "ada@example.com",
        hasPassword: Boolean = true,
        providers: String = """["apple", "auth0", "google"]""",
        pending: String = "null",
        demo: Boolean = false,
    ) = """{ "account": { "name": "$name", "email": "$email", "emailVerified": true, "hasPassword": $hasPassword,
        "signInProviders": $providers, "pendingEmail": $pending, "demo": $demo } }"""

    private val pendingJson = """{ "email": "new@example.com", "expiresAt": "2026-11-15T10:00:00.000Z" }"""

    private fun error(code: String, message: String, fields: String? = null) =
        """{ "error": { "code": "$code", "message": "$message"${fields?.let { """, "fields": $it""" } ?: ""} } }"""

    private suspend fun loaded(json: String = account()): YouAccountModel {
        on("GET", "/api/account", body = json)
        return YouAccountModel(api, root).also { it.fetch() }
    }

    // region Rules

    @Test fun nameRulesMatchSignUp() {
        assertEquals("Enter your name.", youNameError("   "))
        assertEquals("Keep it to 80 characters.", youNameError("a".repeat(81)))
        assertNull(youNameError("a".repeat(80)))
        assertEquals("Use letters, numbers and simple punctuation.", youNameError("Ada <b>"))
        assertEquals("Use letters, numbers and simple punctuation.", youNameError("Ada\u0007"))
        assertNull(youNameError("  Ada O'Neil-Nwosu, Jr.  "))
    }

    @Test fun emailFormRules() {
        val withPassword = YouAccount(email = "ada@example.com", hasPassword = true)
        assertEquals(
            mapOf("email" to "Enter an email address like name@example.com.", "currentPassword" to "Enter your current password."),
            youEmailChangeErrors(withPassword, "ada", ""),
        )
        assertEquals(mapOf("email" to "That's already your email."), youEmailChangeErrors(withPassword, " ADA@example.com ", "pw"))
        assertTrue(youEmailChangeErrors(withPassword, "new@example.com", "pw").isEmpty())
        // No password (Google / Apple / magic link): only the address is checked.
        assertTrue(youEmailChangeErrors(YouAccount(email = "ada@example.com", hasPassword = false), "new@example.com", "").isEmpty())
    }

    @Test fun decodesTheAccountDto() {
        val a = YardJson.decodeFromString<YouAccountResponse>(account(pending = pendingJson)).account
        assertEquals("Ada Nwosu", a.name)
        assertTrue(a.emailVerified)
        assertTrue(a.hasPassword)
        assertEquals(listOf("apple", "auth0", "google"), a.signInProviders)
        assertEquals(listOf("Apple", "social sign-in", "Google"), a.providerWords)
        assertEquals(YouPendingEmail("new@example.com", "2026-11-15T10:00:00.000Z"), a.pendingEmail)
        assertFalse(a.demo)
        assertNull(YardJson.decodeFromString<YouAccountResponse>(account(providers = "[]")).account.pendingEmail)
    }

    // endregion

    // region Requests

    @Test fun loadsTheAccountAsShopper() = runBlocking {
        val m = loaded()
        assertEquals(YouAccountModel.Phase.Loaded, m.phase)
        assertEquals("ada@example.com", m.account!!.email)
        assertEquals("shopper", sent("GET", "/api/account").single().requestUrl!!.queryParameter("as"))
    }

    @Test fun loadFailureShowsTheMessageAndRefreshKeepsData() = runBlocking {
        on("GET", "/api/account", status = 500, body = error("internal", "Something went wrong. Try again."))
        val m = YouAccountModel(api, root)
        m.fetch()
        assertEquals(YouAccountModel.Phase.Failed("Something went wrong. Try again."), m.phase)
    }

    @Test fun savesTheTrimmedName() = runBlocking {
        val m = loaded()
        on("PATCH", "/api/account", body = account(name = "Ada N."))
        assertTrue(m.saveName("  Ada N.  "))
        val req = sent("PATCH", "/api/account").single()
        assertEquals("""{"name":"Ada N."}""", req.body.readUtf8())
        assertEquals("shopper", req.requestUrl!!.queryParameter("as"))
        assertEquals("application/json", req.getHeader("Content-Type")?.substringBefore(';'))
        assertEquals("1", req.getHeader("X-Yard-Client"))
        assertEquals("Ada N.", m.account!!.name)
        assertNull(m.nameError)
    }

    @Test fun nameIsCheckedBeforeSendingAndServerErrorsShow() = runBlocking {
        val m = loaded()
        assertFalse(m.saveName(""))
        assertEquals("Enter your name.", m.nameError)
        assertTrue(sent("PATCH", "/api/account").isEmpty())
        on("PATCH", "/api/account", status = 400, body = error("validation", "Check the highlighted fields.", """{ "name": "Keep it to 80 characters." }"""))
        assertFalse(m.saveName("Ada"))
        assertEquals("Keep it to 80 characters.", m.nameError)
        assertEquals("Ada Nwosu", m.account!!.name)
    }

    @Test fun emailChangeWithPasswordGoesPending() = runBlocking {
        val m = loaded()
        on("POST", "/api/account/email", body = account(pending = pendingJson))
        assertTrue(m.requestEmailChange(" new@example.com ", "hunter22-long"))
        val req = sent("POST", "/api/account/email").single()
        assertEquals("""{"email":"new@example.com","currentPassword":"hunter22-long"}""", req.body.readUtf8())
        assertEquals("shopper", req.requestUrl!!.queryParameter("as"))
        assertEquals("new@example.com", m.account!!.pendingEmail!!.email)
        assertEquals("ada@example.com", m.account!!.email) // unchanged until the link is opened
        assertTrue(m.emailErrors.isEmpty())
        assertNull(m.emailFormError)
    }

    @Test fun emailChangeWithoutPasswordSendsOnlyTheAddress() = runBlocking {
        val m = loaded(account(hasPassword = false, providers = """["google"]"""))
        on("POST", "/api/account/email", body = account(hasPassword = false, providers = """["google"]""", pending = pendingJson))
        assertTrue(m.requestEmailChange("new@example.com", ""))
        assertEquals("""{"email":"new@example.com"}""", sent("POST", "/api/account/email").single().body.readUtf8())
    }

    @Test fun reauthRequiredTurnsOnTheStepUp() = runBlocking {
        val m = loaded(account(hasPassword = false, providers = """["google"]"""))
        on("POST", "/api/account/email", status = 403, body = error("forbidden", "Confirm it's you to continue.", """{ "reauth": "required" }"""))
        assertFalse(m.requestEmailChange("new@example.com", ""))
        assertTrue(m.needsReauth)
        assertNull(m.emailFormError)
        assertTrue(m.emailErrors.isEmpty())
        m.clearEmailErrors()
        assertFalse(m.needsReauth)
    }

    @Test fun fieldErrorsMapToTheirFields() = runBlocking {
        val m = loaded()
        on("POST", "/api/account/email", status = 400, body = error("validation", "Check the highlighted fields.", """{ "currentPassword": "That isn't your current password." }"""))
        assertFalse(m.requestEmailChange("new@example.com", "wrong"))
        assertEquals(mapOf("currentPassword" to "That isn't your current password."), m.emailErrors)

        on("POST", "/api/account/email", status = 400, body = error("validation", "Check the highlighted fields.", """{ "email": "That email can't be used for your account. Try a different address." }"""))
        routes["POST /api/account/email"]!!.removeFirst()
        assertFalse(m.requestEmailChange("taken@example.com", "pw"))
        assertEquals(mapOf("email" to "That email can't be used for your account. Try a different address."), m.emailErrors)
        m.clearEmailErrors("email")
        assertTrue(m.emailErrors.isEmpty())
    }

    @Test fun ruleAndRateLimitShowAsFormErrors() = runBlocking {
        val m = loaded(account(demo = true))
        on("POST", "/api/account/email", status = 422, body = error("rule", "Demo accounts can't change their email."))
        assertFalse(m.requestEmailChange("new@example.com", "pw"))
        assertEquals("Demo accounts can't change their email.", m.emailFormError)

        routes.remove("POST /api/account/email")
        on("POST", "/api/account/email", status = 429, body = error("rate_limited", "Too many requests. Try again in a few minutes."))
        assertFalse(m.requestEmailChange("new@example.com", "pw"))
        assertEquals("Too many requests. Try again in a few minutes.", m.emailFormError)
    }

    @Test fun localErrorsSendNothing() = runBlocking {
        val m = loaded()
        assertFalse(m.requestEmailChange("ada@example.com", ""))
        assertEquals("That's already your email.", m.emailErrors["email"])
        assertEquals("Enter your current password.", m.emailErrors["currentPassword"])
        assertTrue(sent("POST", "/api/account/email").isEmpty())
    }

    @Test fun cancelClearsThePendingChange() = runBlocking {
        val m = loaded(account(pending = pendingJson))
        assertEquals("new@example.com", m.account!!.pendingEmail!!.email)
        on("DELETE", "/api/account/email", body = account())
        assertTrue(m.cancelEmailChange())
        val req = sent("DELETE", "/api/account/email").single()
        assertEquals("shopper", req.requestUrl!!.queryParameter("as"))
        assertEquals(0L, req.bodySize)
        assertNull(m.account!!.pendingEmail)
    }

    @Test fun refreshPicksUpTheConfirmedChange() = runBlocking {
        val m = loaded(account(pending = pendingJson))
        routes.remove("GET /api/account")
        on("GET", "/api/account", body = account(email = "new@example.com"))
        m.fetch()
        assertEquals("new@example.com", m.account!!.email)
        assertNull(m.account!!.pendingEmail)
    }

    @Test fun confirmLinkPostsTheToken() = runBlocking {
        AuthAPI.clientOverride = api
        AuthAPI.baseOverride = root
        on("POST", "/api/auth/change-email/confirm", body = """{ "status": "changed", "email": "new@example.com" }""")
        val r = AuthAPI.confirmEmailChange("tok_0123456789012345678901234567890123456789abc")
        assertEquals(AuthEmailChangeResponse("changed", "new@example.com"), r)
        assertEquals("""{"token":"tok_0123456789012345678901234567890123456789abc"}""", sent("POST", "/api/auth/change-email/confirm").single().body.readUtf8())
        assertEquals("Your Yard email is now new@example.com.", AuthEmailLinks.changeEmailMessage(r))
        assertEquals("Your Yard email was changed.", AuthEmailLinks.changeEmailMessage(AuthEmailChangeResponse()))
    }

    // endregion
}
