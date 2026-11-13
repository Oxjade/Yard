package space.yardstore.app.features.inbox

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.PersistentCookieJar
import java.util.Collections

/**
 * A MockWebServer that answers by "METHOD /path" (query ignored, first match wins, a route can
 * be queued with several answers) and records every request. InboxAPI is pointed at it through
 * its test hook; viewModelScope runs on an unconfined test Main dispatcher.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class InboxTestServer {
    val server = MockWebServer()
    val requests: MutableList<RecordedRequest> = Collections.synchronizedList(mutableListOf())
    private val routes = Collections.synchronizedMap(LinkedHashMap<String, ArrayDeque<MockResponse>>())

    fun on(method: String, path: String, status: Int = 200, body: String = "") {
        val r = MockResponse().setResponseCode(status).setBody(body).setHeader("Content-Type", "application/json")
        routes.getOrPut("$method $path") { ArrayDeque() }.addLast(r)
    }

    fun start() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requests += request
                val key = "${request.method} ${request.requestUrl!!.encodedPath}"
                val queue = routes[key] ?: return MockResponse().setResponseCode(404)
                    .setBody("""{"error":{"code":"not_found","message":"No route $key"}}""")
                return synchronized(queue) { if (queue.size > 1) queue.removeFirst() else queue.first() }
            }
        }
        server.start()
        val base = APIClient.buildHttpClient(PersistentCookieJar(null))
        val http = base.newBuilder().addInterceptor { chain ->
            val url = chain.request().url.newBuilder().scheme("http").host(server.hostName).port(server.port).build()
            chain.proceed(chain.request().newBuilder().url(url).build())
        }.build()
        InboxAPI.client = APIClient(http)
    }

    fun stop() {
        InboxAPI.client = null
        server.shutdown()
        Dispatchers.resetMain()
    }

    fun requests(method: String, path: String): List<RecordedRequest> =
        synchronized(requests) { requests.filter { it.method == method && it.requestUrl!!.encodedPath == path } }
}

/** Realistic JSON shaped like the website's inbox routes (src/lib/api/contracts/inbox.ts). */
object InboxJson {
    fun brand(id: String = "brd_acme", name: String = "Acme Studio") =
        """{"id":"$id","handle":"acme","name":"$name","verified":true,"mark":{"text":"AS","color":"#C6FF3D"}}"""

    fun conversation(
        id: String = "cv_1",
        unread: Int = 0,
        archived: Boolean = false,
        muted: Boolean = false,
        byMe: Boolean = false,
        at: String = "2026-11-13T09:00:00.000Z",
        interaction: String? = null,
        status: String = "open",
    ) = """{"id":"$id","brand":${brand()},"status":"$status","locked":false,
        "lastMessage":{"preview":"Restock lands Friday.","at":"$at","side":"brand","held":false},
        "unread":$unread,"markedUnread":false,"archived":$archived,"muted":$muted,
        "blocked":{"byMe":$byMe,"byThem":false},"sample":false,"createdAt":"2026-11-01T10:00:00.000Z"
        ${if (interaction != null) ""","interaction":$interaction""" else ""}}"""

    fun message(
        id: String, seq: Int, side: String = "brand", body: String? = "Hello",
        createdAt: String = "2026-11-13T09:00:00.000Z", clientId: String = "client-$id",
        attachments: String = "[]", status: String = "sent", extra: String = "",
    ) = """{"id":"$id","seq":$seq,"side":"$side","kind":"text","body":${if (body == null) "null" else "\"$body\""},
        "attachments":$attachments,"status":"$status","safetyNotice":false,"createdAt":"$createdAt","clientId":"$clientId"$extra}"""

    fun thread(conversation: String, messages: List<String>, hasMore: Boolean = false) =
        """{"conversation":$conversation,"messages":[${messages.joinToString(",")}],"hasMore":$hasMore}"""

    const val storefront = """{"brand":{"id":"brd_acme","handle":"acme","name":"Acme Studio","city":"Lagos","country":"NG",
        "currency":"USD","verified":true,"logoSrc":"/api/media/med_logo"},"storefront":null,"collections":[]}"""
}
