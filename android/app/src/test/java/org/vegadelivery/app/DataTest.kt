package org.vegadelivery.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.vegadelivery.app.data.ApiJson
import org.vegadelivery.app.data.LoginCode
import org.vegadelivery.app.data.ScanCode
import org.vegadelivery.app.data.ServerUrl
import org.vegadelivery.app.data.TourPackage
import org.vegadelivery.app.sync.PendingEvent
import org.vegadelivery.app.sync.StopState

class DataTest {
    @Test fun qrV3WithServer() {
        val qr = LoginCode.fromQR("vegadelivery://login?v=3&s=https%3A%2F%2Fdelivery.example.com&c=ABCDEFGHJKMNPQRSTVWX")
        assertEquals("ABCDEFGHJKMNPQRSTVWX", qr?.code)
        assertEquals("https://delivery.example.com", qr?.server)
        assertNull(LoginCode.fromQR("https://example.com"))
    }

    @Test fun typedCodeIsTolerant() {
        assertEquals("ABCDEFGHJKMNPQRSTVWX", LoginCode.normalize("abcd-efgh-jkmn-pqrs-tvwx"))
        assertEquals("0110EFGHJKMNPQRSTVWX", LoginCode.normalize("OILO EFGH JKMN PQRS TVWX"))
        assertNull(LoginCode.normalize("ABCD"))
    }

    @Test fun serverUrl() {
        assertEquals("https://delivery.example.com", ServerUrl.normalize("delivery.example.com/"))
        assertEquals("http://10.0.2.2:3100", ServerUrl.normalize("http://10.0.2.2:3100"))
    }

    @Test fun compositeScan() {
        assertEquals("52451652", ScanCode.gtin("52451652|(91)Herbert_M%C3%BCller"))
        assertEquals("Herbert Müller - Strandleben GmbH", ScanCode.compositeName("52451652|(91)Herbert_M%C3%BCller_-_Strandleben_GmbH"))
        assertEquals("Groß & Söhne", ScanCode.compositeName("]L291Gro%C3%9F_%26_S%C3%B6hne"))
        assertNull(ScanCode.compositeName("4006381333931"))
    }

    private val json = """
        {"tour":{"id":"t1","date":"2026-10-27","title":"Tour","mode":"auto","status":"in_progress",
          "route":{"order":["s1"],"geometry":[[9.99,53.55]],"distance_km":12.3,"duration_s":1800,"legs":[],"computed_at":"x"}},
         "stops":[{"id":"s1","position":1,"status":"pending","customer_id":"c1","customer_no":"52451652","name":"Herbert Müller",
          "street":"Großer Burstah","house_no":"1","zip":"20457","city":"Hamburg","lat":53.5,"lon":9.9,"tracking_url":"u",
          "orders":[{"id":"o1","order_no":"100001","delivery_ean13":"2190524516520","status":"out_for_delivery",
            "items":[{"id":"i1","name_snapshot":"Apfelsaft","qty":"2.00","unit":"pcs","unit_price_cents":249}]}]},
          {"id":"s2","status":"delivered","outcome_code":"delivered","customer_id":"c2","customer_no":"10000021","name":"B",
           "street":"X","zip":"1","city":"Y"}]}
    """.trimIndent()

    @Test fun decodesPackageAndOverlaysEvents() {
        val pkg = ApiJson.decodeFromString<TourPackage>(json)
        assertEquals("2", pkg.stops[0].orders[0].items[0].quantityText)
        assertEquals(setOf("52451652"), pkg.stops[0].acceptedCodes("customer"))
        assertEquals(12.3, pkg.tour.route!!.distanceKm, 0.001)
        val event = PendingEvent("x", "t1", "s1", "outcome", "refused", completesStop = true, isSuccess = false, meta = "{}", photoPath = null, signaturePath = null)
        val states = StopState.compute(pkg, listOf(event))
        assertEquals(StopState.Failed("refused"), states["s1"])
        assertTrue(states["s2"] is StopState.Delivered)
        assertTrue(StopState.compute(pkg, listOf(event.copy(rejected = true, lastError = "A reason is required")))["s1"] is StopState.Rejected)
    }
}
