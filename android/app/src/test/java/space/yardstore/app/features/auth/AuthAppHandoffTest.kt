package space.yardstore.app.features.auth

import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.PersistentCookieJar

class AuthAppHandoffTest {
    private lateinit var server: MockWebServer
    private val store = AuthHandoffStore(null)
    private var now = 1_000_000L

    @Before fun setUp() {
        server = MockWebServer()
        server.start()
        AuthAPI.clientOverride = APIClient(APIClient.buildHttpClient(PersistentCookieJar(null)))
        AuthAPI.baseOverride = server.url("/").toString()
        AuthAppHandoff.storeOverride = store
        AuthAppHandoff.clock = { now }
        AuthAppHandoff.resetForTests()
    }

    @After fun tearDown() {
        AuthAppHandoff.resetForTests()
        AuthAppHandoff.storeOverride = null
        AuthAppHandoff.clock = { System.currentTimeMillis() }
        AuthAPI.clientOverride = null
        AuthAPI.baseOverride = null
        server.shutdown()
    }

    private fun json(body: String, code: Int = 200) =
        MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    private val google = AuthSocialButton("google", "google", null, "Google", AuthSocialButton.Mark.Google)

    // PKCE

    @Test fun challengeMatchesRfc7636Vector() {
        assertEquals("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", AuthPkce.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
    }

    @Test fun verifierAndChallengeAreBase64UrlWithoutPadding() {
        val shape = Regex("^[A-Za-z0-9_-]{43}$")
        val a = AuthPkce.newVerifier()
        val b = AuthPkce.newVerifier()
        assertTrue(a, shape.matches(a))
        assertNotEquals(a, b)
        assertTrue(shape.matches(AuthPkce.challenge(a)))
    }

    // App-start URL

    @Test fun appStartUrlCarriesTheContractParameters() {
        val base = "https://yardstore.space/".toHttpUrl()
        assertEquals(
            "https://yardstore.space/api/auth/oauth/google/app-start?client=android&challenge=abc_-1&mode=signin&actor=shopper",
            AuthAppHandoff.appStartUrl(google, "abc_-1", base),
        )
        assertEquals(
            "https://yardstore.space/api/auth/oauth/auth0/app-start?client=android&challenge=c&mode=signin&actor=shopper&connection=google-oauth2",
            AuthAppHandoff.appStartUrl(AuthSocialButton.auth0Google, "c", base),
        )
    }

    @Test fun beginKeepsTheVerifierWhoseChallengeIsInTheUrl() {
        val url = AuthAppHandoff.begin(google, "https://yardstore.space".toHttpUrl()).toHttpUrl()
        val pending = store.peek()!!
        assertEquals(AuthPkce.challenge(pending.verifier), url.queryParameter("challenge"))
        assertEquals("google", pending.buttonKey)
        assertEquals("Google", pending.label)
        assertTrue(AuthAppHandoff.hasPending())
        now += AuthAppHandoff.PENDING_LIFETIME_MS + 1
        assertFalse(AuthAppHandoff.hasPending())
    }

    // yard://auth/complete

    @Test fun parsesSuccessLink() {
        val cb = AuthHandoffCallback.parse("yard://auth/complete?code=Zx_9-a&result=signed_in&provider=auth0&mode=signin&actor=shopper")!!
        assertEquals(AuthHandoffCallback("Zx_9-a", "signed_in", "auth0", "signin", "shopper"), cb)
    }

    @Test fun parsesErrorLinkWithoutCode() {
        val cb = AuthHandoffCallback.parse("yard://auth/complete?result=cancelled&provider=google")!!
        assertNull(cb.code)
        assertEquals("cancelled", cb.result)
        assertEquals("google", cb.provider)
        assertNull(cb.mode)
        assertEquals("error", AuthHandoffCallback.parse("yard://auth/complete")!!.result)
        assertEquals("not_configured", AuthHandoffCallback.parse("yard://auth/complete/?result=not_configured&code=")!!.result)
        assertNull(AuthHandoffCallback.parse("yard://auth/complete/?result=x&code=")!!.code)
        assertEquals("a b", AuthHandoffCallback.parse("yard://auth/complete?result=a%20b")!!.result)
    }

    @Test fun onlyTheHandoffLinkMatches() {
        assertTrue(AuthHandoffCallback.matches("yard://auth/complete?code=a"))
        assertFalse(AuthHandoffCallback.matches("yard://auth/magic?token=a"))
        assertFalse(AuthHandoffCallback.matches("https://yardstore.space/auth/complete?result=signed_in"))
        assertFalse(AuthHandoffCallback.matches("yard://drops/complete"))
        assertNull(AuthHandoffCallback.parse("yard://brands/acme"))
    }

    // Exchange

    @Test fun exchangeSuccessSendsCodeAndVerifier() = runBlocking {
        AuthAppHandoff.begin(google, server.url("/"))
        val verifier = store.peek()!!.verifier
        server.enqueue(json("""{"result":"signed_in","isNew":true}"""))
        val outcome = AuthAppHandoff.complete("yard://auth/complete?code=CODE123&result=signed_in&provider=google&mode=signin&actor=shopper", session = null)
        assertEquals(AuthAppHandoff.Outcome.SignedIn(isNew = true, provider = "google"), outcome)
        assertEquals(outcome, AuthAppHandoff.outcome)
        val req = server.takeRequest()
        assertEquals("POST", req.method)
        assertEquals("/api/auth/oauth/app-exchange", req.path)
        assertEquals("""{"code":"CODE123","verifier":"$verifier"}""", req.body.readUtf8())
        assertEquals("1", req.getHeader("X-Yard-Client"))
        assertEquals("https://yardstore.space", req.getHeader("Origin"))
        assertTrue(req.getHeader("Content-Type")!!.startsWith("application/json"))
        assertNull(store.peek()) // a verifier is used once
        assertNull(AuthAppHandoff.exchangingKey)
        assertEquals(outcome, AuthAppHandoff.consumeOutcome())
        assertNull(AuthAppHandoff.outcome)
    }

    @Test fun closingTheLastSignInScreenDropsAnUnreadOutcome() = runBlocking {
        AuthAppHandoff.screenAppeared()
        AuthAppHandoff.complete("yard://auth/complete?result=identity_in_use&provider=google", session = null)
        assertTrue(AuthAppHandoff.outcome != null)
        AuthAppHandoff.screenDisappeared()
        assertNull(AuthAppHandoff.outcome)
    }

    @Test fun exchangeFinishingAfterTheScreenClosedIsNotPublished() = runBlocking {
        AuthAppHandoff.screenAppeared()
        AuthAppHandoff.begin(google, server.url("/"))
        server.enqueue(json("""{"result":"signed_in","isNew":false}""").setHeadersDelay(300, java.util.concurrent.TimeUnit.MILLISECONDS))
        val closer = launch { kotlinx.coroutines.delay(100); AuthAppHandoff.screenDisappeared() }
        val outcome = AuthAppHandoff.complete("yard://auth/complete?code=c&result=signed_in&provider=google", session = null)
        closer.join()
        assertEquals(AuthAppHandoff.Outcome.SignedIn(isNew = false, provider = "google"), outcome)
        assertNull(AuthAppHandoff.outcome) // a later sign-in screen sees nothing stale
    }

    @Test fun exchange400ShowsExpiredWording() = runBlocking {
        AuthAppHandoff.begin(google, server.url("/"))
        server.enqueue(json("""{"error":{"code":"invalid_code","message":"That sign-in code is invalid."}}""", 400))
        val outcome = AuthAppHandoff.complete("yard://auth/complete?code=used&result=signed_in&provider=google", session = null)
        assertEquals(AuthAppHandoff.Outcome.Failed("This sign-in link expired or could not be verified. Start again."), outcome)
    }

    @Test fun exchangeMfaRequiredIsReported() = runBlocking {
        AuthAppHandoff.begin(google, server.url("/"))
        server.enqueue(json("""{"status":"mfa_required","challenge":"ch_1","expiresAt":"2026-11-14T10:00:00Z"}"""))
        val outcome = AuthAppHandoff.complete("yard://auth/complete?code=c&result=signed_in&provider=google", session = null)
        assertEquals(AuthAppHandoff.Outcome.Failed(AuthAppHandoff.MFA_MESSAGE), outcome)
    }

    @Test fun errorResultUsesWebsiteWordingWithoutCallingServer() = runBlocking {
        AuthAppHandoff.begin(google, server.url("/"))
        val outcome = AuthAppHandoff.complete("yard://auth/complete?result=identity_in_use&provider=google", session = null)
        assertEquals(AuthAppHandoff.Outcome.Failed("That provider account is connected to another Yard account."), outcome)
        assertEquals(0, server.requestCount)
        assertNull(store.peek())
    }

    @Test fun codeWithoutPendingOrExpiredIsInvalidState() = runBlocking {
        val expired = "This sign-in link expired or could not be verified. Start again."
        assertEquals(AuthAppHandoff.Outcome.Failed(expired), AuthAppHandoff.complete("yard://auth/complete?code=c&result=signed_in", session = null))
        AuthAppHandoff.begin(google, server.url("/"))
        now += AuthAppHandoff.PENDING_LIFETIME_MS + 1
        assertEquals(AuthAppHandoff.Outcome.Failed(expired), AuthAppHandoff.complete("yard://auth/complete?code=c&result=signed_in", session = null))
        assertEquals(0, server.requestCount)
    }

    @Test fun restoredActivityIgnoresAnAlreadyHandledLink() = runBlocking {
        assertNull(AuthAppHandoff.complete("yard://auth/complete?code=c&result=signed_in", session = null, onlyIfPending = true))
        assertNull(AuthAppHandoff.outcome)
    }
}
