package space.yardstore.app.features.around

/** Realistic API bodies shaped like src/server/around/dto.ts (PlaceSummaryDto / PlaceDetailDto). */
object AroundJson {
    val storeSummary = """
        {
          "id": "loc_lagos_thread_ikoyi",
          "brand": { "id": "brd_lagos_thread", "handle": "lagos-thread", "name": "Lagos Thread", "verified": true, "mark": { "text": "LT", "style": "grotesk" } },
          "brandCategory": "Streetwear",
          "brandCategories": ["streetwear"],
          "kind": "store",
          "name": "Lagos Thread Ikoyi",
          "neighbourhood": "Ikoyi",
          "city": "Lagos",
          "citySlug": "lagos",
          "country": "NG",
          "inGazetteer": true,
          "lat": 6.4541,
          "lng": 3.4339,
          "pinPrecision": "street",
          "timeZone": "Africa/Lagos",
          "hours": { "mon": [["10:00", "19:00"]], "tue": [["10:00", "19:00"]], "wed": [["10:00", "19:00"]], "thu": [["10:00", "19:00"]], "fri": [["10:00", "21:00"]], "sat": [["11:00", "21:00"]], "sun": null },
          "byAppointment": false,
          "startsAt": null,
          "endsAt": null,
          "image": { "mediaId": "med_1", "src": "/api/media/med_1", "alt": "The shop front", "width": 1600, "height": 1200 },
          "nextEvent": { "id": "evt_drop07", "title": "Drop 07: Third Mainland", "startsAt": "2026-11-21T11:00:00.000Z", "endsAt": "2026-11-21T18:00:00.000Z", "kind": "drop_launch", "hasDrop": true, "hasPromo": true },
          "offer": true,
          "sample": false
        }
    """.trimIndent()

    val popupSummary = """
        {
          "id": "loc_acme_shoreditch",
          "brand": { "id": "brd_acme", "handle": "acme", "name": "Acme Studio", "verified": false },
          "brandCategory": "Accessories",
          "brandCategories": ["accessories"],
          "kind": "popup",
          "name": "Acme pop-up",
          "neighbourhood": null,
          "city": "London",
          "citySlug": "london",
          "country": "GB",
          "inGazetteer": true,
          "lat": 51.5246,
          "lng": -0.0786,
          "pinPrecision": "area",
          "timeZone": "Europe/London",
          "hours": null,
          "byAppointment": false,
          "startsAt": "2026-11-01T10:00:00.000Z",
          "endsAt": "2026-11-20T18:00:00.000Z",
          "image": null,
          "offer": false,
          "sample": false
        }
    """.trimIndent()

    val places = """
        { "places": [ $storeSummary, $popupSummary, { "id": "loc_broken", "brand": { "id": "brd_x" }, "lat": "not a number" }, 42 ], "scope": "world" }
    """.trimIndent()

    val detail = """
        {
          "place": ${storeSummary.dropLast(1).trimEnd()},
          "addressLine": "12 Bourdillon Road",
          "hoursNote": "Late opening on Fridays.",
          "description": "Our flagship: the full collection, alterations on site and a coffee bar.",
          "images": [ { "src": "/api/media/med_1", "alt": "Front", "width": 1600, "height": 1200 }, { "src": "", "alt": "Broken" } ],
          "events": [
            {
              "id": "evt_drop07", "kind": "drop_launch", "title": "Drop 07: Third Mainland", "description": "Launch day in store.",
              "startsAt": "2026-11-21T11:00:00.000Z", "endsAt": "2026-11-21T18:00:00.000Z",
              "drop": { "id": "drp_07", "slug": "drop-07", "name": "Drop 07" },
              "promoText": "10% off in store on launch day", "image": null, "productIds": [], "sample": false
            },
            { "id": "evt_talk", "kind": "fireside", "title": "Studio talk", "description": null, "startsAt": "2026-11-28T17:00:00.000Z", "endsAt": "2026-11-28T19:00:00.000Z", "drop": null, "promoText": null, "image": null, "productIds": [], "sample": false }
          ],
          "featured": [
            { "id": "prd_1", "slug": "third-mainland-tee", "name": "Third Mainland Tee", "price": { "amount": 4500, "currency": "USD" }, "image": "/api/media/med_9" }
          ]
        }
        }
    """.trimIndent()

    val brandsPage = """
        { "brands": [
            { "id": "brd_lagos_thread", "handle": "lagos-thread", "name": "Lagos Thread", "logoSrc": "/api/media/logo_lt", "verified": true },
            { "id": "brd_other", "handle": "other", "name": "Other", "logoSrc": "/api/media/logo_o" },
            { "id": "brd_acme", "handle": "acme", "name": "Acme Studio", "logoSrc": null }
          ], "total": 3, "nextOffset": null }
    """.trimIndent()
}
