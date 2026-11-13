import Foundation

/// Preview-only fixtures for Around. Never shown in the app: the screens only render API data.
enum AroundFixtures {
    static let weekdayHours = AroundHours(days: [
        "mon": [["10:00", "19:00"]],
        "tue": [["10:00", "19:00"]],
        "wed": [["10:00", "19:00"]],
        "thu": [["10:00", "19:00"]],
        "fri": [["10:00", "21:00"]],
        "sat": [["11:00", "21:00"]],
    ])

    static let store = AroundPlace(
        id: "loc_preview_store",
        brand: AroundBrand(id: "brand_preview_1", handle: "lagos-thread", name: "Lagos Thread", verified: true),
        brandCategory: "Streetwear",
        kind: .store,
        name: "Lagos Thread Ikoyi",
        neighbourhood: "Ikoyi",
        city: "Lagos",
        citySlug: "lagos",
        country: "NG",
        lat: 6.4541,
        lng: 3.4339,
        pinPrecision: "street",
        timeZone: "Africa/Lagos",
        hours: weekdayHours,
        nextEvent: AroundNextEvent(id: "evt_preview", title: "Drop 07: Third Mainland", startsAt: "2030-11-07T11:00:00.000Z", endsAt: "2030-11-07T18:00:00.000Z")
    )

    static let popup = AroundPlace(
        id: "loc_preview_popup",
        brand: AroundBrand(id: "brand_preview_2", handle: "acme", name: "Acme Studio"),
        brandCategory: "Accessories",
        kind: .popup,
        name: "Acme pop-up",
        neighbourhood: "Shoreditch",
        city: "London",
        citySlug: "london",
        country: "GB",
        lat: 51.5246,
        lng: -0.0786,
        timeZone: "Europe/London",
        startsAt: "2020-01-01T10:00:00.000Z",
        endsAt: "2030-01-01T18:00:00.000Z"
    )

    static let places: [AroundPlace] = [store, popup]

    static let detail = AroundPlaceDetail(
        summary: store,
        addressLine: "12 Bourdillon Road",
        hoursNote: "Late opening on Fridays.",
        description: "Our flagship: the full collection, alterations on site and a coffee bar.",
        images: [],
        events: [
            AroundEvent(id: "evt_preview", kind: .dropLaunch, title: "Drop 07: Third Mainland", startsAt: "2030-11-07T11:00:00.000Z", endsAt: "2030-11-07T18:00:00.000Z", drop: AroundDropRef(id: "drop_preview", slug: "drop-07", name: "Drop 07"), promoText: "10% off in store on launch day"),
        ],
        featured: []
    )
}
