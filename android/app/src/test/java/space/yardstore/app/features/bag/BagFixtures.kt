package space.yardstore.app.features.bag

/** Realistic bodies shaped like the website's routes (src/server/cart CartView, src/server/payments/checkout.ts CheckoutView). */
object BagFixtures {
    private fun line(variantId: String, productId: String, brandId: String, brandName: String, title: String, label: String, qty: Int, unit: Int, status: String = "ok") = """
        {"variantId":"$variantId","productId":"$productId","brandId":"$brandId","title":"$title","variantLabel":"$label",
         "imagePath":"/api/media/img_$productId","qty":$qty,"available":5,"unitPrice":{"amountMinor":$unit,"currency":"NGN"},
         "unitMinor":$unit,"lineMinor":${unit * qty},"status":"$status","unavailableReason":null,"brandName":"$brandName"}
    """.trimIndent()

    private const val ACME_QUOTE = """
        {"brandId":"brd_acme","brandName":"Acme Studio","unavailable":false,"reason":null,"options":[
          {"service":"standard","label":"Standard","available":true,"reason":null,"priceMinor":450000,"currency":"NGN","free":false,
           "estimate":{"basis":"quote","arrivalFrom":"2026-11-18","arrivalTo":"2026-11-20"}},
          {"service":"express","label":"Express","available":true,"reason":null,"priceMinor":900000,"currency":"NGN","free":false,
           "estimate":{"basis":"quote","arrivalFrom":"2026-11-16","arrivalTo":"2026-11-17"}},
          {"service":"pickup","label":"Pickup","available":true,"reason":null,"priceMinor":0,"currency":"NGN","free":true,
           "estimate":{"basis":"quote","arrivalFrom":"2026-11-14","arrivalTo":"2026-11-14"}}
        ]}
    """

    /** Two brands; the second doesn't ship to Nigeria. */
    val CART_NG = """
        {"id":"cart_1","currency":"NGN","itemCount":3,"subtotalMinor":4440000,
         "lines":[${line("var_tee_m", "prd_tee", "brd_acme", "Acme Studio", "Boxy heavyweight tee", "Size M", 2, 1140000)},
                  ${line("var_cargo_32", "prd_cargo", "brd_lagos", "Lagos Uniform", "Cargo pant", "Size 32", 1, 2160000)}],
         "groups":[{"brandId":"brd_acme","variantIds":["var_tee_m"],"subtotalMinor":2280000,"shipping":$ACME_QUOTE},
                   {"brandId":"brd_lagos","variantIds":["var_cargo_32"],"subtotalMinor":2160000,
                    "shipping":{"brandId":"brd_lagos","brandName":"Lagos Uniform","unavailable":true,"reason":"Lagos Uniform doesn't ship to Nigeria yet.","options":[]}}],
         "issues":[],"removedSample":0,"destination":{"country":"NG","city":"Lagos"}}
    """.trimIndent()

    /** One brand, shippable. */
    val CART_OK = """
        {"id":"cart_1","currency":"NGN","itemCount":2,"subtotalMinor":2280000,
         "lines":[${line("var_tee_m", "prd_tee", "brd_acme", "Acme Studio", "Boxy heavyweight tee", "Size M", 2, 1140000)}],
         "groups":[{"brandId":"brd_acme","variantIds":["var_tee_m"],"subtotalMinor":2280000,"shipping":$ACME_QUOTE}],
         "issues":[],"removedSample":0,"destination":{"country":"NG","city":"Lagos"}}
    """.trimIndent()

    fun checkout(
        status: String,
        authorizationUrl: String?,
        providerStatus: String? = null,
        stub: Boolean = false,
        message: String? = null,
        failureReason: String? = null,
    ): String {
        fun q(s: String?) = if (s == null) "null" else "\"$s\""
        return """
            {"id":"chk_01","status":"$status","reference":"YRD-8F2K","currency":"NGN","subtotalMinor":2280000,"shippingMinor":150000,
             "totalMinor":2430000,"orderIds":["ord_a","ord_b"],"groups":[],"createdAt":"2026-11-13T10:00:00.000Z",
             "expiresAt":"2026-11-13T10:30:00.000Z","paidAt":null,"failureReason":${q(failureReason)},
             "payment":{"id":"pay_01","provider":"${if (stub) "stub" else "paystack"}","status":"initialized","reference":"YRD-8F2K-1",
               "authorizationUrl":${q(authorizationUrl)},"accessCode":null,"stub":$stub,"message":${q(message)},"providerStatus":${q(providerStatus)}}}
        """.trimIndent()
    }
}
