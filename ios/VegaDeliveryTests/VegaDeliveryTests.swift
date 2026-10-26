@preconcurrency import FerrostarCoreFFI
import XCTest
@testable import VegaDelivery

final class LoginCodeParserTests: XCTestCase {
    func testQRv3WithServer() {
        let qr = LoginCodeParser.login(fromQR: "vegadelivery://login?v=3&s=https%3A%2F%2Fdelivery.example.com&c=ABCDEFGHJKMNPQRSTVWX")
        XCTAssertEqual(qr?.code, "ABCDEFGHJKMNPQRSTVWX")
        XCTAssertEqual(qr?.server?.absoluteString, "https://delivery.example.com")
    }

    func testForeignQRIsIgnored() {
        XCTAssertNil(LoginCodeParser.login(fromQR: "https://example.com"))
        XCTAssertNil(LoginCodeParser.login(fromQR: "vegadelivery://login?c=TOOSHORT"))
    }

    func testTypedCodeIsTolerant() {
        XCTAssertEqual(LoginCodeParser.normalize("abcd-efgh-jkmn-pqrs-tvwx"), "ABCDEFGHJKMNPQRSTVWX")
        XCTAssertEqual(LoginCodeParser.normalize("OILO EFGH JKMN PQRS TVWX"), "0110EFGHJKMNPQRSTVWX")
        XCTAssertNil(LoginCodeParser.normalize("ABCD"))
    }

    func testPublicServerUsesHttps() {
        XCTAssertEqual(ServerURL.normalized("delivery.example.com")?.scheme, "https")
        XCTAssertEqual(ServerURL.normalized("http://mac.local:3100")?.scheme, "http")
    }
}

final class ScanCodeTests: XCTestCase {
    func testGtinFromCompositeAndAIM() {
        XCTAssertEqual(ScanCode.gtin("52451652|(91)Herbert_M%C3%BCller"), "52451652")
        XCTAssertEqual(ScanCode.gtin("]E04006381333931"), "4006381333931")
    }

    func testCompositeNameWithUmlauts() {
        XCTAssertEqual(ScanCode.compositeName("52451652|(91)Herbert_M%C3%BCller_-_Strandleben_GmbH"), "Herbert Müller - Strandleben GmbH")
        XCTAssertEqual(ScanCode.compositeName("]L291Gro%C3%9F_%26_S%C3%B6hne"), "Groß & Söhne")
        XCTAssertNil(ScanCode.compositeName("4006381333931"))
    }
}

final class PackageTests: XCTestCase {
    static let json = """
    {"tour":{"id":"t1","date":"2026-10-27","title":"Tour Nord","vehicle":null,"mode":"auto","status":"in_progress",
      "planned_start":"08:00","start":{"lat":53.55,"lon":9.99,"label":"Depot"},"end":{"lat":53.55,"lon":9.99,"label":"Depot"},
      "route":{"order":["s1","s2"],"geometry":[[9.99,53.55],[10.0,53.56]],"distance_km":12.3,"duration_s":1800,
        "legs":[{"distance_km":2,"duration_s":300}],"computed_at":"2026-10-26T18:00:00.000Z","mode":"auto","order_mode":"optimized"}},
     "stops":[
      {"id":"s1","position":1,"status":"pending","outcome_code":null,"eta":"2026-10-27T07:05:00.000Z","customer_id":"c1",
       "customer_no":"52451652","name":"Herbert Müller - Strandleben GmbH","company":"Strandleben GmbH","first_name":"Herbert",
       "last_name":"Müller","street":"Großer Burstah","house_no":"1","address_extra":null,"zip":"20457","city":"Hamburg",
       "country":"DE","lat":53.548,"lon":9.99,"phone":null,"whatsapp":"+491715550001","delivery_notes":"Hinten klingeln",
       "time_window_from":null,"time_window_to":null,"tracking_url":"https://x/t/abc",
       "orders":[{"id":"o1","order_no":"100001","delivery_ean13":"2190524516520","status":"out_for_delivery","notes":null,
         "items":[{"id":"i1","product_id":null,"name_snapshot":"Apfelsaft 1 l","qty":"2.00","unit":"pcs","unit_price_cents":249}]}]},
      {"id":"s2","position":2,"status":"delivered","outcome_code":"delivered","eta":null,"customer_id":"c2","customer_no":"10000021",
       "name":"B","company":null,"first_name":null,"last_name":"B","street":"X","house_no":null,"address_extra":null,"zip":"1",
       "city":"Y","country":"DE","lat":53.56,"lon":10.0,"phone":null,"whatsapp":null,"delivery_notes":null,
       "time_window_from":"09:00","time_window_to":"10:00","tracking_url":"https://x/t/def","orders":[]}
     ]}
    """

    func testDecodesPackage() throws {
        let pkg = try APIClient.decoder.decode(TourPackage.self, from: Data(Self.json.utf8))
        XCTAssertEqual(pkg.stops.count, 2)
        XCTAssertEqual(pkg.stops[0].orders[0].items[0].quantityText, "2")
        XCTAssertEqual(pkg.stops[1].timeWindow, "09:00–10:00")
        XCTAssertEqual(pkg.tour.route?.order, ["s1", "s2"])
        XCTAssertEqual(pkg.stops[0].acceptedCodes(scanAccept: "customer"), ["52451652"])
        XCTAssertEqual(pkg.stops[0].acceptedCodes(scanAccept: "any"), ["52451652", "2190524516520"])
    }

    func testOutboxEventsOverlayServerState() throws {
        let pkg = try APIClient.decoder.decode(TourPackage.self, from: Data(Self.json.utf8))
        let e = PendingEvent(clientID: "x", tourID: "t1", stopID: "s1", type: "outcome", outcomeCode: "refused",
                             completesStop: true, isSuccess: false, meta: Data(), photoPath: nil, signaturePath: nil)
        let states = StopProgress.states(pkg, events: [e])
        XCTAssertEqual(states["s1"], .failed(outcome: "refused"))
        XCTAssertEqual(states["s2"], .delivered(outcome: "delivered"))
        XCTAssertEqual(StopProgress.completedIDs(pkg, events: []), ["s2"])
        e.rejected = true
        e.lastError = "A reason is required"
        XCTAssertEqual(StopProgress.states(pkg, events: [e])["s1"], .rejected("A reason is required"))
    }
}

final class NavigationAssistTests: XCTestCase {
    private func north(_ base: GeographicCoordinate, _ meters: Double) -> GeographicCoordinate {
        GeographicCoordinate(lat: base.lat + meters / 111_195, lng: base.lng)
    }

    private let origin = GeographicCoordinate(lat: 53.55, lng: 10.0)

    func testWrongWayByCarTurnAroundThenRecalculate() {
        var d = WrongWayDetector()
        let t0 = Date()
        var events: [WrongWayDetector.Event] = []
        // Route goes north (0°), the car drives south at ~10 m/s
        for i in 0...90 {
            events.append(d.update(at: north(origin, -10.2 * Double(i)), course: 180, routeBearing: 0, time: t0 + Double(i)))
        }
        XCTAssertEqual(events.firstIndex(of: .turnAround), 5) // after 50 m
        // 800 m are reached after ~79 s, but 60 s come first
        XCTAssertEqual(events.firstIndex(of: .recalculate), 65)
    }

    func testRightDirectionResets() {
        var d = WrongWayDetector()
        let t0 = Date()
        for i in 0...6 { _ = d.update(at: north(origin, -10.0 * Double(i)), course: 180, routeBearing: 0, time: t0 + Double(i)) }
        XCTAssertTrue(d.isWrongWay)
        let back = north(origin, -60)
        for i in 1...4 { _ = d.update(at: north(back, 10.0 * Double(i)), course: 0, routeBearing: 0, time: t0 + 10 + Double(i)) }
        XCTAssertFalse(d.isWrongWay)
    }

    func testFollowUpIsDropped() {
        XCTAssertEqual(NavigationSpeechSynthesizer.withoutFollowUp("Turn right. Then turn left."), "Turn right.")
        XCTAssertEqual(NavigationSpeechSynthesizer.withoutFollowUp("Rechts abbiegen. Dann links abbiegen."), "Rechts abbiegen.")
    }
}
