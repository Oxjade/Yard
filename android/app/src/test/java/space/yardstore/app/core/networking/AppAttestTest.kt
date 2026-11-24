package space.yardstore.app.core.networking

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
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
import java.util.Base64
import java.util.Collections

/** App attestation (docs/APP.md "App attestation"): the request binding, the header and the client plumbing. */
class AppAttestTest {
    private val challenge = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"

    /** A fake Play Integrity: records the requestHash it was asked for. */
    private class FakeSource(var token: String? = "fake.integrity.token", var prepared: Boolean = true) : IntegrityTokenSource {
        val warmedWith = Collections.synchronizedList(mutableListOf<Long>())
        val hashes = Collections.synchronizedList(mutableListOf<String>())
        override suspend fun warmUp(cloudProjectNumber: Long): Boolean {
            warmedWith += cloudProjectNumber
            return prepared
        }
        override suspend fun token(requestHash: String): String? {
            hashes += requestHash
            return token
        }
    }

    // region Binding (the same vectors as the server's src/server/app-attest tests)

    @Test fun requestHashMatchesTheServer() {
        val body = """{"email":"ada@gmail.com"}""".toByteArray()
        assertEquals("a4d4a13430d3032e196cf1a3f5e573f54d13769cb9ea43ebd8b242741422082b", AppAttest.sha256Hex(body))
        assertEquals(
            "yard-attest/v1\nPOST\n/api/auth/magic-link\na4d4a13430d3032e196cf1a3f5e573f54d13769cb9ea43ebd8b242741422082b\n$challenge",
            AppAttest.clientData("post", "/api/auth/magic-link", body, challenge),
        )
        assertEquals("ab584e9ffe9296b16aaf23d060fc3709c180247ae4e83212e1e20c79b6b0bcbc", AppAttest.requestHash("POST", "/api/auth/magic-link", body, challenge))
        assertEquals("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", AppAttest.sha256Hex(ByteArray(0)))
    }

    @Test fun headerIsUnpaddedBase64UrlJson() {
        assertEquals(
            "eyJ2IjoxLCJwIjoiYW5kcm9pZCIsImMiOiJhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODlBQkNERUZHIiwidCI6InRvay5lbiJ9",
            AppAttest.header(challenge, "tok.en"),
        )
    }

    @Test fun onlyTheProtectedPostsAreAttested() {
        assertTrue(AppAttest.isProtected("POST", "/api/auth/sign-up"))
        assertTrue(AppAttest.isProtected("POST", "/api/auth/password/forgot"))
        assertTrue(AppAttest.isProtected("POST", "/api/auth/magic-link"))
        assertTrue(AppAttest.isProtected("POST", "/api/studio/apply"))
        assertFalse(AppAttest.isProtected("GET", "/api/studio/apply"))
        assertFalse(AppAttest.isProtected("POST", "/api/auth/sign-in"))
        assertFalse(AppAttest.isProtected("POST", "/api/app/attest/challenge"))
    }

    // endregion

    // region Client plumbing (MockWebServer)

    private lateinit var server: MockWebServer
    private lateinit var api: APIClient
    private val seen = Collections.synchronizedList(mutableListOf<Pair<RecordedRequest, ByteArray>>())
    @Volatile private var configBody = """{"mode":"monitor","android":{"cloudProjectNumber":"123456789012"},"ios":null}"""
    @Volatile private var challengeResponse = MockResponse().setBody("""{"challenge":"$challenge","expiresAt":"2026-11-24T12:05:00.000Z"}""")

    @Before fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                seen += request to request.body.readByteArray()
                return when (request.path.orEmpty().substringBefore('?')) {
                    "/api/app/attest/config" -> MockResponse().setBody(configBody)
                    "/api/app/attest/challenge" -> challengeResponse
                    else -> MockResponse().setBody("""{"ok":true}""")
                }
            }
        }
        server.start()
        val http = APIClient.buildHttpClient(PersistentCookieJar(null)).newBuilder()
            .addInterceptor { chain ->
                val r = chain.request()
                chain.proceed(r.newBuilder().url(r.url.newBuilder().scheme("http").host(server.hostName).port(server.port).build()).build())
            }
            .build()
        api = APIClient(http)
    }

    @After fun tearDown() {
        server.shutdown()
    }

    private fun install(source: IntegrityTokenSource) {
        api.attestor = AppAttestor(
            source = source,
            fetchConfig = { api.get<AppAttestConfig>("/api/app/attest/config") },
            fetchChallenge = { api.post<AppAttestChallenge>("/api/app/attest/challenge", body = mapOf("purpose" to "request")) },
        )
    }

    private fun sent(path: String) = seen.last { it.first.path.orEmpty().substringBefore('?') == path }

    @Test fun protectedCallCarriesAHeaderBoundToTheBodyActuallySent() = runBlocking {
        val fake = FakeSource()
        install(fake)
        api.send(HTTPMethod.POST, "/api/auth/magic-link", body = mapOf("email" to "ada@gmail.com"))

        val (req, body) = sent("/api/auth/magic-link")
        val header = req.getHeader(AppAttest.HEADER)!!
        val json = Json.parseToJsonElement(String(Base64.getUrlDecoder().decode(header))).jsonObject
        assertEquals(1, json["v"]!!.jsonPrimitive.int)
        assertEquals("android", json["p"]!!.jsonPrimitive.content)
        assertEquals(challenge, json["c"]!!.jsonPrimitive.content)
        assertEquals("fake.integrity.token", json["t"]!!.jsonPrimitive.content)
        assertEquals(listOf(AppAttest.requestHash("POST", "/api/auth/magic-link", body, challenge)), fake.hashes)
        assertEquals(listOf(123456789012L), fake.warmedWith)
        val (challengeReq, challengeBody) = sent("/api/app/attest/challenge")
        assertEquals("POST", challengeReq.method)
        assertEquals("""{"purpose":"request"}""", String(challengeBody))
    }

    @Test fun otherCallsAreUntouched() = runBlocking {
        val fake = FakeSource()
        install(fake)
        api.send(HTTPMethod.POST, "/api/auth/sign-in", body = mapOf("email" to "ada@gmail.com"))
        assertNull(sent("/api/auth/sign-in").first.getHeader(AppAttest.HEADER))
        assertTrue(fake.hashes.isEmpty())
        assertEquals(1, seen.size)
    }

    @Test fun noTokenMeansNoHeaderButTheRequestStillGoes() = runBlocking {
        install(FakeSource(token = null))
        api.send(HTTPMethod.POST, "/api/auth/sign-up", body = mapOf("name" to "Ada", "email" to "ada@gmail.com", "password" to "correct horse"))
        assertNull(sent("/api/auth/sign-up").first.getHeader(AppAttest.HEADER))
    }

    @Test fun noPlayServicesMeansNoChallengeAndNoHeader() = runBlocking {
        val fake = FakeSource(prepared = false)
        install(fake)
        api.send(HTTPMethod.POST, "/api/auth/password/forgot", body = mapOf("email" to "ada@gmail.com"))
        assertNull(sent("/api/auth/password/forgot").first.getHeader(AppAttest.HEADER))
        assertTrue(seen.none { it.first.path == "/api/app/attest/challenge" })
    }

    @Test fun androidOffOnTheServerMeansNothingIsAsked() = runBlocking {
        configBody = """{"mode":"monitor","android":null,"ios":null}"""
        val fake = FakeSource()
        install(fake)
        api.send(HTTPMethod.POST, "/api/auth/magic-link", body = mapOf("email" to "ada@gmail.com"))
        assertNull(sent("/api/auth/magic-link").first.getHeader(AppAttest.HEADER))
        assertTrue(fake.warmedWith.isEmpty())
        assertTrue(seen.none { it.first.path == "/api/app/attest/challenge" })
    }

    @Test fun aServerErrorOnTheChallengeStillSendsTheRequest() = runBlocking {
        challengeResponse = MockResponse().setResponseCode(503).setBody("""{"error":{"code":"busy","message":"Busy"}}""")
        install(FakeSource())
        api.send(HTTPMethod.POST, "/api/studio/apply", body = mapOf("shopName" to "Kachi"))
        assertNull(sent("/api/studio/apply").first.getHeader(AppAttest.HEADER))
    }

    @Test fun offModeOrNoAttestorSendsNoHeader() = runBlocking {
        configBody = """{"mode":"off","android":{"cloudProjectNumber":"123456789012"},"ios":null}"""
        install(FakeSource())
        api.send(HTTPMethod.POST, "/api/auth/magic-link", body = mapOf("email" to "ada@gmail.com"))
        assertNull(sent("/api/auth/magic-link").first.getHeader(AppAttest.HEADER))
        api.attestor = null
        api.send(HTTPMethod.POST, "/api/auth/magic-link", body = mapOf("email" to "ada@gmail.com"))
        assertNull(sent("/api/auth/magic-link").first.getHeader(AppAttest.HEADER))
    }

    @Test fun warmUpPreparesPlayIntegrityOnlyWhenAndroidIsOn() = runBlocking {
        val fake = FakeSource()
        install(fake)
        api.attestor!!.warmUp()
        assertEquals(listOf(123456789012L), fake.warmedWith)
        configBody = """{"mode":"monitor","android":null,"ios":null}"""
        val other = FakeSource()
        install(other)
        api.attestor!!.warmUp()
        assertTrue(other.warmedWith.isEmpty())
    }

    // endregion
}
