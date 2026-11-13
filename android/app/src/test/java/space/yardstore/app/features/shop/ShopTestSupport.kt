package space.yardstore.app.features.shop

import okhttp3.mockwebserver.MockResponse

/** Realistic JSON, shaped like the website's route responses (src/server/catalog/public.ts, dto.ts). */
internal object ShopJson {
    fun product(id: String, priceMinor: Int = 4500, publishedAt: String = "2026-10-01T10:00:00.000Z", available: Int = 5) = """
        {
          "id": "$id", "slug": "piece-$id", "brandId": "brd_acme", "title": "Boxy tee $id",
          "description": "Heavyweight cotton.", "details": ["100% cotton"], "category": "streetwear",
          "subcategory": "T-shirts", "tags": [], "badges": ["new"], "priceMinor": $priceMinor,
          "compareAtMinor": null, "currency": "USD",
          "images": [{"id": "img_$id", "src": "/api/media/med_$id", "alt": "", "width": 800, "height": 1000, "mediaId": "med_$id"}],
          "options": [{"name": "Size", "values": [{"value": "M"}]}],
          "variants": [{"id": "var_$id", "sku": "TEE-M", "options": {"Size": "M"}, "label": "Size M", "priceMinor": $priceMinor, "available": $available, "inStock": ${available > 0}}],
          "available": $available, "processingDays": [2, 4], "dropId": null, "collectionIds": ["col_winter"],
          "publishedAt": "$publishedAt", "createdAt": "2026-09-01T10:00:00.000Z",
          "brand": {"id": "brd_acme", "handle": "acme", "name": "Acme Studio", "verified": true, "city": "Lagos", "country": "NG", "currency": "USD", "foundingBadge": false, "forSale": true, "hasStorefront": true}
        }
    """.trimIndent()

    fun page(ids: List<String>, total: Int, nextOffset: Int?) =
        """{"products": [${ids.joinToString(",") { product(it) }}], "total": $total, "nextOffset": ${nextOffset ?: "null"}}"""

    val categories = """
        {"categories": [
          {"slug": "fashion", "name": "Fashion", "description": "Tailoring and knitwear.", "imagePath": "/media/categories/fashion.jpg", "subcategories": ["Outerwear", "Shirts"], "productCount": 42, "brandCount": 9},
          {"slug": "streetwear", "name": "Streetwear", "description": null, "imagePath": null, "subcategories": [], "productCount": 1, "brandCount": 1},
          {"slug": "sneakers", "name": "Sneakers", "description": "", "imagePath": null, "subcategories": [], "productCount": 0, "brandCount": 0}
        ]}
    """.trimIndent()

    fun collection(productIds: List<String>) = """
        {"collection": {"id": "col_winter", "handle": "winter-uniform", "name": "Winter uniform",
          "description": "Heavyweight fleece and wool.", "imageSrc": null, "imageMediaId": "med_cover",
          "productIds": [${productIds.joinToString(",") { "\"$it\"" }}]},
         "brand": {"id": "brd_acme", "handle": "acme", "name": "Acme Studio"}}
    """.trimIndent()

    val storefront = """
        {"brand": {"id": "brd_acme", "handle": "acme", "name": "Acme Studio", "city": "Lagos", "country": "NG",
          "currency": "USD", "verified": true, "logoSrc": "/api/media/med_logo"},
         "storefront": null,
         "collections": [
           {"id": "col_winter", "handle": "winter-uniform", "name": "Winter uniform", "description": "", "productIds": ["p1"]},
           {"id": "col_basics", "handle": "basics", "name": "Basics", "description": "Everyday pieces.", "imageSrc": "/api/media/med_b", "productIds": ["p4", "p5"]}
         ]}
    """.trimIndent()

    fun ok(body: String) = MockResponse().setHeader("Content-Type", "application/json").setBody(body)
    fun error(status: Int, code: String, message: String) =
        MockResponse().setResponseCode(status).setHeader("Content-Type", "application/json")
            .setBody("""{"error": {"code": "$code", "message": "$message"}}""")
}

/** Polls (real time) until [condition] holds; the models run real OkHttp calls. */
internal fun awaitUntil(timeoutMs: Long = 5_000, condition: () -> Boolean) {
    val end = System.currentTimeMillis() + timeoutMs
    while (!condition()) {
        if (System.currentTimeMillis() > end) throw AssertionError("Timed out waiting for condition")
        Thread.sleep(10)
    }
}
