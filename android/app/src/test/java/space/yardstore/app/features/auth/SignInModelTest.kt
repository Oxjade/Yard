package space.yardstore.app.features.auth

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.PersistentCookieJar

@OptIn(ExperimentalCoroutinesApi::class)
class SignInModelTest {
    private lateinit var server: MockWebServer
    private val focused = mutableListOf<SignInModel.Field>()

    @Before fun setUp() {
        Dispatchers.setMain(Dispatchers.Unconfined)
        server = MockWebServer()
        server.start()
        AuthAPI.clientOverride = APIClient(APIClient.buildHttpClient(PersistentCookieJar(null)))
        AuthAPI.baseOverride = server.url("/").toString()
    }

    @After fun tearDown() {
        AuthAPI.clientOverride = null
        AuthAPI.baseOverride = null
        server.shutdown()
        Dispatchers.resetMain()
    }

    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    private fun filled(mode: SignInModel.Mode = SignInModel.Mode.SignIn) = SignInModel(AuthProviders.preview()).apply {
        if (mode == SignInModel.Mode.SignUp) toggleMode()
        name = "Ada Obi"
        email = "  ada@example.com "
        password = "correct horse battery"
    }

    @Test fun validationUsesWebsiteWordingAndSendsNothing() = runBlocking {
        val m = SignInModel(AuthProviders.preview())
        assertFalse(m.submit { focused += it })
        assertEquals("Enter your email address.", m.emailError)
        assertEquals("Enter your password.", m.passwordError)
        assertEquals(listOf(SignInModel.Field.Email), focused)
        m.email = "ada@example"
        m.revalidate(SignInModel.Field.Email)
        assertEquals("Enter your email address.", m.emailError) // still invalid: kept until it is valid
        m.email = "ada@example.com"
        m.revalidate(SignInModel.Field.Email)
        assertNull(m.emailError)
        m.toggleMode()
        m.password = "short"
        assertFalse(m.submit { focused += it })
        assertEquals("Enter your name.", m.nameError)
        assertEquals("Use at least 10 characters for your password.", m.passwordError)
        assertEquals(0, server.requestCount)
    }

    @Test fun badEmailFormat() = runBlocking {
        val m = filled().apply { email = "ada.example.com" }
        assertFalse(m.submit { })
        assertEquals("Enter an email address like name@example.com.", m.emailError)
    }

    @Test fun signInSuccessPostsTrimmedEmailAsShopper() = runBlocking {
        server.enqueue(json("""{"status":"signed_in"}"""))
        val m = filled()
        assertTrue(m.submit { })
        val req = server.takeRequest()
        assertEquals("/api/auth/sign-in", req.path)
        assertEquals("""{"email":"ada@example.com","password":"correct horse battery","actor":"shopper"}""", req.body.readUtf8())
        assertNull(m.busy)
        assertNull(m.failure)
    }

    @Test fun signInVerifyEmail() = runBlocking {
        server.enqueue(json("""{"status":"verify_email"}"""))
        val m = filled()
        assertFalse(m.submit { })
        assertEquals("Check your email for a verification link, then sign in again.", m.failure)
    }

    @Test fun wrongPasswordShowsServerSentence() = runBlocking {
        server.enqueue(json("""{"error":{"code":"unauthorized","message":"Email or password is incorrect."}}""", 401))
        val m = filled()
        assertFalse(m.submit { })
        assertEquals("Email or password is incorrect.", m.failure)
    }

    @Test fun serverFieldErrorsGoUnderFields() = runBlocking {
        server.enqueue(json("""{"error":{"code":"validation","message":"Check the form.","fields":{"password":"Use a longer password."}}}""", 400))
        val m = filled(SignInModel.Mode.SignUp)
        assertFalse(m.submit { focused += it })
        assertEquals("Use a longer password.", m.passwordError)
        assertNull(m.failure)
        assertEquals(listOf(SignInModel.Field.Password), focused)
    }

    @Test fun signUpShowsCheckYourEmail() = runBlocking {
        server.enqueue(json("""{"status":"verify_email"}"""))
        val m = filled(SignInModel.Mode.SignUp)
        assertFalse(m.submit { })
        assertEquals("ada@example.com", m.signUpSentTo)
        assertEquals("", m.password)
        val req = server.takeRequest()
        assertEquals("/api/auth/sign-up", req.path)
        assertEquals("""{"name":"Ada Obi","email":"ada@example.com","password":"correct horse battery"}""", req.body.readUtf8())
        m.backToSignIn()
        assertNull(m.signUpSentTo)
        assertEquals(SignInModel.Mode.SignIn, m.mode)
    }

    @Test fun magicLinkAndResetNotices() {
        server.enqueue(json("""{"ok":true}"""))
        val m = filled()
        m.requestMagicLink { }
        waitUntil { m.notice != null }
        assertEquals("If an account exists for that address, a sign-in link has been sent.", m.notice)
        assertEquals("/api/auth/magic-link", server.takeRequest().path)
        waitUntil { m.busy == null }

        server.enqueue(json("""{"error":{"code":"rate_limited","message":"Too many requests. Try again in a minute."}}""", 429))
        m.requestPasswordReset { }
        waitUntil { m.failure != null }
        assertEquals("Too many requests. Try again in a minute.", m.failure)
        assertEquals("/api/auth/password/forgot", server.takeRequest().path)
    }

    @Test fun magicLinkNeedsValidEmail() {
        val m = SignInModel(AuthProviders.preview())
        m.requestMagicLink { focused += it }
        assertEquals("Enter your email address.", m.emailError)
        assertEquals(listOf(SignInModel.Field.Email), focused)
        assertEquals(0, server.requestCount)
    }

    @Test fun providersLoadAndFallback() {
        server.enqueue(json("""{"password":true,"magicLink":false,"google":false,"apple":false,"auth0":true,"auth0Connections":[{"name":"google-oauth2","label":"Google"}],"demo":{"shopper":true}}"""))
        val m = SignInModel()
        assertFalse(m.providersLoaded)
        m.loadProviders()
        waitUntil { m.providersLoaded }
        assertEquals(listOf("auth0:google-oauth2"), m.socialButtons.map { it.key })
        assertFalse(m.magicLinkEnabled)
        assertTrue(m.demoEnabled)

        server.enqueue(MockResponse().setResponseCode(500))
        val failed = SignInModel()
        failed.loadProviders()
        waitUntil { failed.providersLoaded }
        assertEquals(listOf(AuthSocialButton.auth0Google), failed.socialButtons)
        assertTrue(failed.magicLinkEnabled)
        assertFalse(failed.demoEnabled)
    }

    @Test fun demoSignIn() = runBlocking {
        server.enqueue(json("""{"status":"signed_in"}"""))
        val m = filled()
        assertTrue(m.signInDemo())
        val req = server.takeRequest()
        assertEquals("/api/auth/demo", req.path)
        assertEquals("""{"actor":"shopper","account":"u_ada"}""", req.body.readUtf8())
    }

    @Test fun socialStartOpensWebFlowAndOutcomes() {
        server.enqueue(json("""{"url":"https://yard.eu.auth0.com/authorize?state=abc"}"""))
        val m = filled()
        m.startSocial(AuthSocialButton.auth0Google)
        waitUntil { m.webFlow != null }
        assertEquals("https://yard.eu.auth0.com/authorize?state=abc", m.webFlow!!.url)
        assertEquals("Google", m.webFlow!!.label)
        assertEquals(SignInModel.Busy.Social("auth0:google-oauth2"), m.busy)
        val req = server.takeRequest()
        assertEquals("/api/auth/oauth/auth0/start", req.path)
        assertEquals("""{"mode":"signin","actor":"shopper","connection":"google-oauth2"}""", req.body.readUtf8())

        assertTrue(m.finishSocial(AuthWebOutcome.Completed("signed_in")))
        assertNull(m.webFlow)
        assertNull(m.busy)
        assertFalse(m.finishSocial(AuthWebOutcome.Completed("invalid_state")))
        assertEquals("This sign-in link expired or could not be verified. Start again.", m.failure)
        assertFalse(m.finishSocial(AuthWebOutcome.Failed("You're offline. Check your connection and try again.")))
        assertEquals("Couldn't finish social sign-in. You're offline. Check your connection and try again.", m.failure)
    }

    @Test fun socialStartFailureShowsServerMessage() {
        server.enqueue(json("""{"error":{"code":"not_configured","message":"This sign-in provider isn’t configured on Yard yet."}}""", 503))
        val m = filled()
        m.startSocial(AuthSocialButton.auth0Google)
        waitUntil { m.failure != null }
        assertEquals("This sign-in provider isn’t configured on Yard yet.", m.failure)
        assertNull(m.busy)
        assertNull(m.webFlow)
    }
}
