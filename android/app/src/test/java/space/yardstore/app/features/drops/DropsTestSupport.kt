package space.yardstore.app.features.drops

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.PersistentCookieJar
import java.time.Instant

/** An APIClient whose requests (built against the production base URL) go to [server] instead. */
fun dropsTestClient(server: MockWebServer): APIClient {
    val base = APIClient.buildHttpClient(PersistentCookieJar(null))
    val target = server.url("/")
    val http = base.newBuilder().addInterceptor { chain ->
        val req = chain.request()
        val url = req.url.newBuilder().scheme(target.scheme).host(target.host).port(target.port).build()
        chain.proceed(req.newBuilder().url(url).build())
    }.build()
    return APIClient(http)
}

/** Routes by "METHOD path-without-query" to canned JSON bodies; anything else is a 404 envelope. */
class DropsRoutes(private val routes: Map<String, () -> MockResponse>) : Dispatcher() {
    override fun dispatch(request: RecordedRequest): MockResponse {
        val path = request.requestUrl?.encodedPath ?: ""
        val phase = request.requestUrl?.queryParameter("phase")
        val cursor = request.requestUrl?.queryParameter("cursor")
        val keys = listOfNotNull(
            if (phase != null && cursor != null) "${request.method} $path?phase=$phase&cursor=$cursor" else null,
            if (phase != null) "${request.method} $path?phase=$phase" else null,
            "${request.method} $path",
        )
        for (k in keys) routes[k]?.let { return it() }
        return MockResponse().setResponseCode(404).setBody("""{"error":{"code":"not_found","message":"We couldn't find that drop."}}""")
    }
}

fun json(body: String, code: Int = 200): () -> MockResponse = { MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body) }

fun iso(offsetSeconds: Long, now: Instant = Instant.now()): String = now.plusSeconds(offsetSeconds).toString()

/** A drop exactly as toDropDto (src/server/drops/service.ts) shapes it. */
fun dropJson(
    id: String,
    startsIn: Long,
    endsIn: Long,
    access: String = "first_come",
    status: String = "scheduled",
    phase: String = "scheduled",
    entryOpensIn: Long? = null,
    entryClosesIn: Long? = null,
    productIds: List<String> = emptyList(),
    extra: String = "",
): String {
    val opens = entryOpensIn?.let { "\"${iso(it)}\"" } ?: "null"
    val closes = entryClosesIn?.let { "\"${iso(it)}\"" } ?: "null"
    val ids = productIds.joinToString(",") { "\"$it\"" }
    return """
    {"id":"$id","slug":"$id-slug","brand":{"id":"brd_1","handle":"acme","name":"Acme Studio"},
     "name":"Drop $id","description":"Heavyweight fleece.","image":"med_$id","access":"$access",
     "status":"$status","phase":"$phase","startsAt":"${iso(startsIn)}","endsAt":"${iso(endsIn)}",
     "earlyAccessAt":null,"entryOpensAt":$opens,"entryClosesAt":$closes,"drawnAt":null,
     "purchaseWindowMinutes":${if (access == "draw") 1440 else "null"},"winners":${if (access == "draw") 12 else "null"},
     "limitPerCustomer":1,"totalUnits":40,"productIds":[$ids],"entries":${if (access == "draw") 87 else "null"},
     "sponsored":false$extra}
    """.trimIndent()
}
