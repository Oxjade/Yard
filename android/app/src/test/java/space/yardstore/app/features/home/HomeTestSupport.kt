package space.yardstore.app.features.home

import okhttp3.CookieJar
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import space.yardstore.app.core.networking.APIClient
import java.util.concurrent.CopyOnWriteArrayList

/** A MockWebServer that answers Yard routes by path, with an APIClient pointed at it. */
internal class HomeFakeServer(private val route: (path: String, query: (String) -> String?) -> MockResponse) {
    val server = MockWebServer()
    val requests = CopyOnWriteArrayList<RecordedRequest>()
    val api: APIClient

    init {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requests += request
                val url = request.requestUrl!!
                return route(url.encodedPath) { url.queryParameter(it) }
            }
        }
        server.start()
        val base = server.url("/")
        val http = APIClient.buildHttpClient(CookieJar.NO_COOKIES).newBuilder()
            .addInterceptor { chain ->
                val original = chain.request()
                val rewritten = original.url.newBuilder().scheme(base.scheme).host(base.host).port(base.port).build()
                chain.proceed(original.newBuilder().url(rewritten).build())
            }
            .build()
        api = APIClient(http)
    }

    fun requestsTo(path: String) = requests.filter { it.requestUrl!!.encodedPath == path }

    fun shutdown() = server.shutdown()
}

internal fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

internal fun errorJson(code: Int, message: String) = json("""{"error":{"code":"server_error","message":"$message"}}""", code)

/** A product shaped like src/lib/api/catalog-products.ts (public product + brand summary). */
internal fun productJson(id: String, brandId: String = "brd_a", publishedAt: String = "2026-11-01T10:00:00.000Z", sized: Boolean = true): String {
    val size = if (sized) """, "width": 800, "height": 1000""" else ""
    return """
    {
      "id": "$id", "slug": "$id-slug", "brandId": "$brandId", "title": "Piece $id",
      "description": "Heavyweight cotton.", "details": ["100% cotton"], "category": "tops", "subcategory": null,
      "tags": [], "badges": ["new"], "priceMinor": 4500, "compareAtMinor": null, "currency": "USD",
      "images": [{"id": "img_$id", "src": "/api/media/med_$id", "alt": "", "mediaId": "med_$id"$size}],
      "options": [{"name": "Size", "values": [{"value": "M"}]}],
      "variants": [{"id": "var_$id", "sku": "SKU", "options": {"Size": "M"}, "label": "Size M", "priceMinor": 4500, "available": 3, "inStock": true}],
      "available": 3, "processingDays": [2, 4], "dropId": null, "collectionIds": [],
      "publishedAt": "$publishedAt", "createdAt": "2026-10-01T10:00:00.000Z",
      "brand": {"id": "$brandId", "handle": "$brandId-h", "name": "Brand $brandId", "verified": true, "city": "Lagos", "country": "NG", "foundingBadge": false, "forSale": true, "hasStorefront": true}
    }
    """.trimIndent()
}

internal fun productsPage(products: List<String>, nextOffset: Int?, total: Int = products.size) =
    """{"products": [${products.joinToString(",")}], "total": $total, "nextOffset": ${nextOffset ?: "null"}}"""

internal fun brandJson(id: String, cover: Boolean = true, founding: Boolean = false) = """
    {"id": "$id", "handle": "$id-h", "name": "Studio $id", "city": "Accra", "country": "GH", "categories": ["tops"],
     "story": "Cut and sewn in Accra.", "logoSrc": "/api/media/logo_$id", "coverSrc": ${if (cover) "\"/api/media/cover_$id\"" else "null"},
     "verified": false, "founding": $founding, "foundingBadge": $founding, "forSale": true, "listedAt": "2026-09-01T00:00:00.000Z"}
""".trimIndent()

internal fun brandsPage(brands: List<String>) = """{"brands": [${brands.joinToString(",")}], "total": ${brands.size}, "nextOffset": null}"""

internal fun dropJson(id: String, phase: String) = """
    {"id": "$id", "slug": "$id-slug", "brand": {"id": "brd_a", "handle": "acme", "name": "Acme"}, "name": "Drop $id",
     "description": "", "image": "med_$id", "access": "first_come", "status": "scheduled", "phase": "$phase",
     "startsAt": "2026-11-20T18:00:00.000Z", "endsAt": "2026-11-21T18:00:00.000Z", "limitPerCustomer": 1,
     "totalUnits": 50, "productIds": ["prd_1"], "sponsored": false}
""".trimIndent()

internal fun dropsPage(drops: List<String>) = """{"items": [${drops.joinToString(",")}], "nextCursor": null}"""
