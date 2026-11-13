package space.yardstore.app.features.orders

import space.yardstore.app.core.models.YardJson

/** Realistic API bodies shaped like src/server/orders/contracts.ts and the checkout route. */
object OrderFixtures {
    fun summaryJson(
        id: String = "ord_1",
        reference: String = "YRD-48213-1",
        groupReference: String = "YRD-48213",
        checkoutId: String? = "chk_1",
        brandName: String = "Acme Studio",
        handle: String = "acme",
        merchant: String = "shipped",
        payment: String = "paid",
        fulfilment: String = "shipped",
        placedAt: String = "2026-11-13T09:12:00.000Z",
        totalMinor: Int = 13500,
    ): String = """
        {
          "id": "$id",
          "reference": "$reference",
          "groupReference": "$groupReference",
          "checkoutId": ${checkoutId?.let { "\"$it\"" } ?: "null"},
          "brand": { "id": "brd_$handle", "name": "$brandName", "handle": "$handle" },
          "shipToPreview": { "city": "London", "country": "GB" },
          "placedAt": "$placedAt",
          "currency": "USD",
          "subtotalMinor": 12000,
          "shippingMinor": 1500,
          "totalMinor": $totalMinor,
          "refundedMinor": 0,
          "itemCount": 3,
          "previewItems": [
            { "productId": "prd_1", "variantId": "var_1", "name": "Boxy tee", "qty": 1, "unitMinor": 4500 }
          ],
          "states": { "merchant": "$merchant", "payment": "$payment", "fulfilment": "$fulfilment", "return": "none", "dispute": "none" },
          "service": "standard"
        }
    """.trimIndent()

    fun pageJson(vararg items: String, nextCursor: String? = null): String =
        """{ "items": [${items.joinToString(",")}], "nextCursor": ${nextCursor?.let { "\"$it\"" } ?: "null"} }"""

    val detailJson: String = """
        {
          "order": {
            "id": "ord_1",
            "reference": "YRD-48213-1",
            "groupReference": "YRD-48213",
            "checkoutId": "chk_1",
            "brand": { "id": "brd_acme", "name": "Acme Studio", "handle": "acme" },
            "shipToPreview": { "city": "London", "country": "GB" },
            "placedAt": "2026-11-11T09:12:00.000Z",
            "currency": "USD",
            "subtotalMinor": 12000,
            "shippingMinor": 1500,
            "totalMinor": 13500,
            "refundedMinor": 0,
            "itemCount": 2,
            "previewItems": [],
            "states": { "merchant": "shipped", "payment": "paid", "fulfilment": "shipped", "return": "none", "dispute": "none" },
            "service": "standard",
            "lines": [
              { "id": "ln_1", "variantId": "var_1", "productId": "prd_1", "title": "Boxy tee", "qty": 1, "unitMinor": 4500, "returnedQty": 0, "variantLabel": "Size M", "image": { "src": "/api/media/abc", "alt": "Boxy tee in black" } },
              { "id": "ln_2", "variantId": "var_2", "productId": "prd_2", "title": "Cargo pant", "qty": 2, "unitMinor": 3750, "returnedQty": 1, "variantLabel": "Size 32", "image": null },
              "not-a-line"
            ],
            "shipTo": { "name": "Ada Obi", "line1": "12 Example Road", "city": "London", "postalCode": "E1 6AN", "country": "GB", "phone": "+44 20 0000 0000" },
            "paidAt": "2026-11-11T09:13:00.000Z",
            "cancelledAt": null,
            "cancelReason": null,
            "deliveredAt": null,
            "returns": [],
            "refunds": [],
            "timeline": [
              { "id": "ev_1", "kind": "order.placed", "at": "2026-11-11T09:12:00.000Z", "data": {} },
              { "id": "ev_2", "kind": "payment.captured", "at": "2026-11-11T09:13:00.000Z", "data": {} },
              { "id": "ev_3", "kind": "fulfilment.processing", "at": "2026-11-12T10:00:00.000Z", "data": {} },
              { "id": "ev_4", "kind": "fulfilment.shipped", "at": "2026-11-13T08:30:00.000Z", "data": {} },
              { "id": "ev_5", "kind": "ledger.posted", "at": "2026-11-13T08:31:00.000Z", "data": {} }
            ],
            "actions": { "canCancel": false, "canRequestReturn": false, "returnWindowEndsAt": null },
            "delivery": {
              "service": "standard",
              "shipTo": { "country": "GB", "city": "London" },
              "estimate": { "arrivalFrom": "2026-11-16", "arrivalTo": "2026-11-19", "deliveredOn": null, "shipBy": "2026-11-13", "late": false },
              "shippedOn": "2026-11-13",
              "events": [
                { "id": "se_1", "status": "shipped", "occurredAt": "2026-11-13T08:30:00.000Z", "carrier": "DHL", "trackingNumber": "JD0146", "locationText": "Lagos", "note": null },
                { "id": "se_2", "status": "in_transit", "occurredAt": "2026-11-14T08:30:00.000Z", "carrier": "DHL", "trackingNumber": "JD0147", "locationText": "Heathrow", "note": null }
              ]
            }
          }
        }
    """.trimIndent()

    fun checkoutJson(status: String = "paid", providerStatus: String? = null, channel: String = "card", authorizationUrl: String? = null): String = """
        {
          "id": "chk_1",
          "status": "$status",
          "reference": "YRD-48213",
          "currency": "USD",
          "subtotalMinor": 15000,
          "shippingMinor": 1500,
          "totalMinor": 16500,
          "orderIds": ["ord_1", "ord_2"],
          "createdAt": "2026-11-13T09:12:00.000Z",
          "paidAt": ${if (status == "paid") "\"2026-11-13T09:13:00.000Z\"" else "null"},
          "failureReason": null,
          "payment": {
            "provider": "paystack",
            "status": "${if (status == "paid") "succeeded" else "pending"}",
            "authorizationUrl": ${authorizationUrl?.let { "\"$it\"" } ?: "null"},
            "message": null,
            "channel": "$channel",
            "providerStatus": ${providerStatus?.let { "\"$it\"" } ?: "null"}
          }
        }
    """.trimIndent()

    fun detail(json: String = detailJson): OrderDetail = YardJson.decodeFromString(OrderDetailResponse.serializer(), json).order

    fun summary(json: String): OrderSummary = YardJson.decodeFromString(OrderSummary.serializer(), json)
}
