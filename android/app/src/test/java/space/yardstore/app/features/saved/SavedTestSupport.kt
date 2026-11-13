package space.yardstore.app.features.saved

import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import space.yardstore.app.core.networking.APIClient
import java.util.concurrent.CopyOnWriteArrayList

/**
 * A MockWebServer that answers by method + path (requests run in parallel, so order can't be
 * relied on), plus an [APIClient] whose relative paths ("/api/…") are rewritten to the server.
 */
class SavedFakeBackend {
    val server = MockWebServer()
    val requests = CopyOnWriteArrayList<RecordedRequest>()
    /** (method, path without query) → response. Unmatched → 404 error envelope. */
    private val routes = java.util.concurrent.ConcurrentHashMap<String, (RecordedRequest) -> MockResponse>()

    init {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requests += request
                val path = request.requestUrl?.encodedPath ?: ""
                val handler = routes["${request.method} $path"]
                return handler?.invoke(request) ?: error(404, "not_found", "Not found")
            }
        }
        server.start()
    }

    val api: APIClient by lazy {
        val base = APIClient.buildHttpClient(okhttp3.CookieJar.NO_COOKIES)
        val http = base.newBuilder()
            .addInterceptor { chain ->
                val original = chain.request()
                val url = original.url.newBuilder()
                    .scheme("http")
                    .host(server.hostName)
                    .port(server.port)
                    .build()
                chain.proceed(original.newBuilder().url(url).build())
            }
            .build()
        APIClient(http)
    }

    fun on(method: String, path: String, handler: (RecordedRequest) -> MockResponse) {
        routes["$method $path"] = handler
    }

    fun json(method: String, path: String, body: String, status: Int = 200) =
        on(method, path) { MockResponse().setResponseCode(status).setHeader("Content-Type", "application/json").setBody(body) }

    fun requestsTo(path: String): List<RecordedRequest> = requests.filter { it.requestUrl?.encodedPath == path }

    fun shutdown() = server.shutdown()

    companion object {
        fun error(status: Int, code: String, message: String): MockResponse =
            MockResponse().setResponseCode(status).setHeader("Content-Type", "application/json")
                .setBody("""{"error":{"code":"$code","message":"$message"}}""")

        /** A product shaped like the website's public catalogue product. */
        fun product(
            id: String,
            brandId: String = "brd_1",
            brandName: String = "Acme Studio",
            priceMinor: Int = 4500,
            currency: String = "USD",
            available: Int = 5,
            variants: Int = 1,
            publishedAt: String = "2026-11-01T10:00:00.000Z",
            forSale: Boolean = true,
        ): String {
            val vs = (0 until variants).joinToString(",") { i ->
                """{"id":"var_${id}_$i","sku":"SKU-$i","options":{"Size":"S$i"},"label":"S$i","priceMinor":$priceMinor,"available":$available,"inStock":${available > 0}}"""
            }
            return """
                {"id":"$id","slug":"$id-slug","brandId":"$brandId","title":"Piece $id","description":"","details":[],
                 "category":"tops","subcategory":null,"tags":[],"badges":[],"priceMinor":$priceMinor,"compareAtMinor":null,
                 "currency":"$currency","images":[{"id":"img_$id","src":"/api/media/med_$id","alt":"","width":800,"height":1000}],
                 "options":[],"variants":[$vs],"available":$available,"processingDays":[1,3],"dropId":null,"collectionIds":[],
                 "publishedAt":"$publishedAt","createdAt":"2026-10-01T10:00:00.000Z",
                 "brand":{"id":"$brandId","handle":"${brandId}-h","name":"$brandName","verified":true,"city":"Lagos","country":"NG","currency":"$currency","forSale":$forSale,"hasStorefront":true}}
            """.trimIndent()
        }

        fun productsPage(vararg products: String) = """{"products":[${products.joinToString(",")}],"total":${products.size},"nextOffset":null}"""

        /** A wishlist row exactly as `listWishlist` in src/server/follows/index.ts returns it. */
        fun wishlistItem(productId: String, savedAt: String, listed: Boolean = true, title: String? = "Piece $productId", brandName: String? = "Acme Studio") = """
            {"productId":"$productId","brandId":"brd_1","savedAt":"$savedAt",
             "title":${title?.let { "\"$it\"" } ?: "null"},"slug":"$productId-slug","brandName":${brandName?.let { "\"$it\"" } ?: "null"},
             "available":5,"price":{"amount":4500,"currency":"USD"},"listed":$listed,"backInStockVariantIds":[]}
        """.trimIndent()

        fun followed(brandId: String, name: String, followedAt: String = "2026-11-01T10:00:00.000Z") = """
            {"brandId":"$brandId","followedAt":"$followedAt","handle":"$brandId-h","name":"$name","city":"Lagos","country":"NG","verified":false,"followers":12}
        """.trimIndent()

        fun drop(id: String, brandId: String, phase: String, brandName: String? = null) = """
            {"id":"$id","slug":"$id-slug","brand":{"id":"$brandId","handle":"$brandId-h","name":${brandName?.let { "\"$it\"" } ?: "null"}},
             "name":"Drop $id","description":"","image":null,"access":"draw","status":"scheduled","phase":"$phase",
             "startsAt":"2026-12-01T10:00:00.000Z","endsAt":"2026-12-02T10:00:00.000Z","limitPerCustomer":1,"totalUnits":20,"productIds":[]}
        """.trimIndent()

        fun brandCard(id: String, name: String) = """
            {"id":"$id","handle":"$id-h","name":"$name","city":"Accra","country":"GH","categories":["tops"],"story":null,
             "logoSrc":"/api/media/logo_$id","coverSrc":null,"verified":false,"founding":false,"foundingBadge":false,"forSale":true,"listedAt":"2026-11-01T10:00:00.000Z"}
        """.trimIndent()
    }
}
