import XCTest
@testable import Yard

// The Live Activity mapping (`LiveActivityOrder.make`) and the push payload's decoding.
//
// Parity with the server: these are the same cases, by the same names, as the website repo's
// src/server/push/live-activity-state.test.ts, which runs the server's port of `make(...)` on the
// same inputs (there in several time zones; here in the simulator's TimeZone.current).
// The decoding tests read `content-state` exactly as Yard's server writes it (apns-core.ts).

private let shipAt = "2026-11-18T08:00:00.000Z"
private let defaultEstimate: [String: Any] = ["basis": "shipped", "arrivalFrom": "2026-11-21", "arrivalTo": "2026-11-22", "late": false]

private func decode<T: Decodable>(_ object: [String: Any], as type: T.Type) -> T {
    let data = try! JSONSerialization.data(withJSONObject: object)
    return try! JSONDecoder().decode(T.self, from: data)
}

private func order(_ fulfilment: String, brand: String? = "Ojuelegba Supply", city: String? = "London", deliveredAt: String? = nil) -> LiveActivityOrderDTO {
    var o: [String: Any] = ["states": ["fulfilment": fulfilment]]
    if let brand { o["brand"] = ["name": brand] }
    if let city { o["shipToPreview"] = ["city": city] }
    if let deliveredAt { o["deliveredAt"] = deliveredAt }
    return decode(o, as: LiveActivityOrderDTO.self)
}

private func delivery(_ events: [(String, String)], estimate: [String: Any]? = defaultEstimate, shippedOn: String? = "2026-11-18", city: String? = "London") -> LiveActivityDeliveryDTO {
    var d: [String: Any] = ["events": events.map { ["status": $0.0, "occurredAt": $0.1] }]
    if let estimate { d["estimate"] = estimate }
    if let shippedOn { d["shippedOn"] = shippedOn }
    if let city { d["shipTo"] = ["city": city] }
    return decode(d, as: LiveActivityDeliveryDTO.self)
}

private let fixedNow = YardDate.parse("2026-11-19T12:00:00.000Z")!
private typealias State = YardOrderActivityAttributes.ContentState

private func run(_ o: LiveActivityOrderDTO, _ d: LiveActivityDeliveryDTO, now: Date = fixedNow, brandCity: String = "Lagos") -> LiveActivityOrder {
    LiveActivityOrder.make(orderId: "or_test", order: o, delivery: d, brandCity: brandCity, now: now)
}

final class LiveActivityOrderTests: XCTestCase {
    private var eta: Date { LiveActivityDates.endOfArrivalDay("2026-11-22")! }
    private var ship: Date { YardDate.parse(shipAt)! }

    func testCancelledEnds() {
        let r = run(order("cancelled"), delivery([("shipped", shipAt)]))
        XCTAssertTrue(r.isClosed)
        XCTAssertNil(r.state)
    }

    func testReturnedToSenderEnds() {
        XCTAssertTrue(run(order("returned_to_sender"), delivery([])).isClosed)
    }

    func testReturnedEventEnds() {
        let r = run(order("shipped"), delivery([("shipped", shipAt), ("returned", "2026-11-19T09:00:00.000Z")]))
        XCTAssertTrue(r.isClosed)
        XCTAssertNil(r.state)
    }

    func testDeliveredByFulfilment() {
        let s = run(order("delivered"), delivery([("shipped", shipAt)])).state
        XCTAssertEqual(s, State(step: .delivered, etaDate: nil, progress: 1, statusLine: "Delivered"))
    }

    func testDeliveredByEvent() {
        XCTAssertEqual(run(order("shipped"), delivery([("shipped", shipAt), ("delivered", "2026-11-19T10:00:00.000Z")])).state?.step, .delivered)
    }

    func testDeliveredByEstimate() {
        XCTAssertEqual(run(order("shipped"), delivery([("shipped", shipAt)], estimate: ["basis": "delivered", "deliveredOn": "2026-11-19", "late": false])).state?.step, .delivered)
    }

    func testDeliveredByOrderDate() {
        XCTAssertEqual(run(order("shipped", deliveredAt: "2026-11-19T10:00:00.000Z"), delivery([("shipped", shipAt)])).state?.step, .delivered)
    }

    func testOutForDelivery() {
        let r = run(order("shipped"), delivery([("shipped", shipAt), ("out_for_delivery", "2026-11-19T07:00:00.000Z")]))
        XCTAssertFalse(r.isClosed)
        XCTAssertEqual(r.state?.step, .outForDelivery)
        XCTAssertEqual(r.state?.etaDate, eta)
        XCTAssertEqual(r.state?.progress ?? 0, 0.86, accuracy: 1e-12)
        XCTAssertEqual(r.state?.statusLine, "Out for delivery in London")
    }

    func testOutForDeliveryThenExceptionStaysOut() {
        let r = run(order("shipped"), delivery([("shipped", shipAt), ("out_for_delivery", "2026-11-19T07:00:00.000Z"), ("exception", "2026-11-19T09:00:00.000Z")]))
        XCTAssertEqual(r.state?.step, .outForDelivery)
    }

    func testOutForDeliveryNoCity() {
        let r = run(order("shipped", city: nil), delivery([("out_for_delivery", "2026-11-19T07:00:00.000Z")], city: nil))
        XCTAssertEqual(r.state?.statusLine, "Out for delivery")
    }

    func testShippedHalfway() {
        let half = ship.addingTimeInterval(eta.timeIntervalSince(ship) / 2)
        guard half < LiveActivityDates.startOfDay("2026-11-21")! else { return } // inside the window: arrivingSoon covers it
        let s = run(order("shipped"), delivery([("shipped", shipAt)]), now: half).state
        XCTAssertEqual(s?.step, .shipped)
        XCTAssertEqual(s?.etaDate, eta)
        XCTAssertEqual(s?.progress ?? 0, 0.25 + 0.53 * 0.5, accuracy: 1e-9)
        XCTAssertEqual(s?.statusLine, "On its way from Lagos")
    }

    func testShippedBeforeShipEvent() {
        XCTAssertEqual(run(order("shipped"), delivery([("shipped", shipAt)]), now: ship.addingTimeInterval(-3_600)).state?.progress, 0.25)
    }

    func testShippedNoBrandCity() {
        XCTAssertEqual(run(order("shipped"), delivery([("in_transit", shipAt)]), brandCity: "").state?.statusLine, "On its way")
    }

    func testShippedLastException() {
        let s = run(order("shipped"), delivery([("shipped", shipAt), ("exception", "2026-11-19T09:00:00.000Z")])).state
        XCTAssertEqual(s?.step, .shipped)
        XCTAssertEqual(s?.statusLine, "Delayed — Ojuelegba Supply reported a delay")
    }

    func testShippedLate() {
        let s = run(order("shipped"), delivery([("shipped", shipAt)], estimate: ["basis": "late", "arrivalFrom": "2026-11-21", "arrivalTo": "2026-11-22", "late": true])).state
        XCTAssertEqual(s?.statusLine, "Running late — new estimate")
    }

    func testArrivingSoon() {
        let at = LiveActivityDates.startOfDay("2026-11-21")!.addingTimeInterval(3_600)
        let s = run(order("shipped"), delivery([("shipped", shipAt)]), now: at).state
        let fraction = at.timeIntervalSince(ship) / eta.timeIntervalSince(ship)
        XCTAssertEqual(s?.step, .arrivingSoon)
        XCTAssertEqual(s?.etaDate, eta)
        XCTAssertEqual(s?.progress ?? 0, max(0.25 + 0.53 * min(max(fraction, 0), 1), 0.7), accuracy: 1e-9)
        XCTAssertEqual(s?.statusLine, "Arriving soon in London")
    }

    func testArrivingSoonLate() {
        let at = LiveActivityDates.startOfDay("2026-11-21")!.addingTimeInterval(3_600)
        let s = run(order("shipped"), delivery([("shipped", shipAt)], estimate: ["basis": "late", "arrivalFrom": "2026-11-21", "arrivalTo": "2026-11-22", "late": true]), now: at).state
        XCTAssertEqual(s?.statusLine, "Running late — arriving soon in London")
    }

    func testPackedProcessing() {
        let s = run(order("processing"), delivery([])).state
        XCTAssertEqual(s, State(step: .packed, etaDate: eta, progress: 0.08, statusLine: "Packed by Ojuelegba Supply"))
    }

    func testPackedLabelCreated() {
        XCTAssertEqual(run(order("unfulfilled"), delivery([("label_created", shipAt)])).state?.step, .packed)
    }

    func testUnfulfilledNotTracked() {
        let r = run(order("unfulfilled"), delivery([]))
        XCTAssertFalse(r.isClosed)
        XCTAssertNil(r.state)
    }

    func testShippedOnDateWhenNoEvent() {
        let start = LiveActivityDates.startOfDay("2026-11-18")!
        let s = run(order("shipped"), delivery([], shippedOn: "2026-11-18")).state
        let fraction = fixedNow.timeIntervalSince(start) / eta.timeIntervalSince(start)
        XCTAssertEqual(s?.progress ?? 0, 0.25 + 0.53 * min(max(fraction, 0), 1), accuracy: 1e-9)
    }

    func testNoEstimate() {
        let s = run(order("shipped"), delivery([("shipped", shipAt)], estimate: nil)).state
        XCTAssertEqual(s, State(step: .shipped, etaDate: nil, progress: 0.25, statusLine: "On its way from Lagos"))
    }

    func testNoBrandName() {
        XCTAssertEqual(run(order("processing", brand: nil), delivery([])).state?.statusLine, "Packed by The brand")
    }

    func testCityFromOrderWhenDeliveryHasNone() {
        let r = run(order("shipped", city: "Abuja"), delivery([("out_for_delivery", shipAt)], city: nil))
        XCTAssertEqual(r.deliveryCity, "Abuja")
        XCTAssertEqual(r.state?.statusLine, "Out for delivery in Abuja")
    }

    func testEventsOutOfOrderAreSorted() {
        XCTAssertEqual(run(order("shipped"), delivery([("out_for_delivery", "2026-11-19T07:00:00.000Z"), ("shipped", shipAt)])).state?.step, .outForDelivery)
    }

    // MARK: The push payload, as Yard's server writes it

    func testContentStateDecodesTheServerPayload() throws {
        // apns-core.ts: etaDate = Unix seconds − 978307200 (a Date's default Codable encoding).
        let json = #"{"step":"outForDelivery","etaDate":817070400,"progress":0.86,"statusLine":"Out for delivery in London"}"#
        let state = try JSONDecoder().decode(YardOrderActivityAttributes.ContentState.self, from: Data(json.utf8))
        XCTAssertEqual(state.step, .outForDelivery)
        XCTAssertEqual(state.etaDate, Date(timeIntervalSince1970: 1_795_377_600)) // 2026-11-22T20:00:00Z
        XCTAssertEqual(state.progress, 0.86, accuracy: 1e-12)
        XCTAssertEqual(state.statusLine, "Out for delivery in London")
    }

    func testContentStateWithoutETA() throws {
        let json = #"{"step":"delivered","progress":1,"statusLine":"Delivered"}"#
        let state = try JSONDecoder().decode(YardOrderActivityAttributes.ContentState.self, from: Data(json.utf8))
        XCTAssertEqual(state.step, .delivered)
        XCTAssertNil(state.etaDate)
    }

    func testContentStateEncodesLikeTheServer() throws {
        let state = YardOrderActivityAttributes.ContentState(step: .shipped, etaDate: Date(timeIntervalSince1970: 1_795_377_600), progress: 0.5, statusLine: "On its way")
        let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(state)) as? [String: Any]
        XCTAssertEqual(object?["step"] as? String, "shipped")
        XCTAssertEqual((object?["etaDate"] as? NSNumber)?.doubleValue, 817_070_400)
        XCTAssertEqual(Set(object?.keys.map { $0 } ?? []), ["step", "etaDate", "progress", "statusLine"])
    }

    func testStepRawValuesMatchTheServer() {
        XCTAssertEqual(YardOrderActivityAttributes.Step.allCases.map(\.rawValue), ["packed", "shipped", "outForDelivery", "arrivingSoon", "delivered"])
    }

    func testAttributesDecodeThePushToStartPayload() throws {
        let json = #"{"orderId":"or_1","brandName":"Ojuelegba Supply","brandCity":"Lagos","deliveryCity":"London"}"#
        let a = try JSONDecoder().decode(YardOrderActivityAttributes.self, from: Data(json.utf8))
        XCTAssertEqual(a.orderId, "or_1")
        XCTAssertEqual(a.brandName, "Ojuelegba Supply")
        XCTAssertEqual(a.brandCity, "Lagos")
        XCTAssertEqual(a.deliveryCity, "London")
    }
}
