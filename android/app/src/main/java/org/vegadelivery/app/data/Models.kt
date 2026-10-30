package org.vegadelivery.app.data

import kotlinx.serialization.Serializable
import java.util.Locale

/** API models of the driver app (snake_case JSON, see docs/APP-API.md). */

@Serializable
data class AppUser(val id: String, val username: String, val displayName: String? = null, val role: String? = null, val locale: String? = null) {
    val name: String get() = displayName ?: username
}

@Serializable
data class TourSummary(
    val id: String,
    val date: String,
    val title: String,
    val vehicle: String? = null,
    val mode: String = "auto",
    val status: String,
    val plannedStart: String? = null,
    val distanceKm: Double? = null,
    val durationS: Double? = null,
    val routeComputedAt: String? = null,
    val stopCount: Int = 0,
    val completedCount: Int = 0,
) {
    val isRunning get() = status == "in_progress"
    val isDone get() = status == "done"
}

@Serializable
data class Place(val lat: Double, val lon: Double, val label: String? = null)

@Serializable
data class TourRoute(
    val order: List<String> = emptyList(),
    val geometry: List<List<Double>> = emptyList(),
    val distanceKm: Double = 0.0,
    val durationS: Double = 0.0,
    val computedAt: String = "",
)

@Serializable
data class OrderItem(val id: String, val nameSnapshot: String, val qty: String, val unit: String, val unitPriceCents: Int = 0) {
    val quantityText: String
        get() {
            val n = qty.toDoubleOrNull() ?: 0.0
            return if (n == Math.rint(n)) n.toLong().toString() else String.format(Locale.ROOT, "%.2f", n)
        }
}

@Serializable
data class StopOrder(val id: String, val orderNo: String, val deliveryEan13: String, val status: String, val notes: String? = null, val items: List<OrderItem> = emptyList())

@Serializable
data class TourStop(
    val id: String,
    val position: Int? = null,
    val status: String,
    val outcomeCode: String? = null,
    val eta: String? = null,
    val customerId: String,
    val customerNo: String,
    val name: String,
    val street: String,
    val houseNo: String? = null,
    val addressExtra: String? = null,
    val zip: String,
    val city: String,
    val lat: Double? = null,
    val lon: Double? = null,
    val phone: String? = null,
    val whatsapp: String? = null,
    val deliveryNotes: String? = null,
    val timeWindowFrom: String? = null,
    val timeWindowTo: String? = null,
    val trackingUrl: String = "",
    val orders: List<StopOrder> = emptyList(),
) {
    val streetLine get() = listOfNotNull(street, houseNo).joinToString(" ")
    val addressLine get() = "$streetLine, $zip $city"
    val hasCoordinate get() = lat != null && lon != null

    /** Codes proving presence at this stop: order EAN-13s and/or the customer EAN-8 */
    fun acceptedCodes(scanAccept: String): Set<String> = buildSet {
        if (scanAccept != "customer") addAll(orders.map { it.deliveryEan13 })
        if (scanAccept != "delivery") add(customerNo)
    }
}

@Serializable
data class TourInfo(
    val id: String,
    val date: String,
    val title: String,
    val vehicle: String? = null,
    val mode: String = "auto",
    val status: String,
    val plannedStart: String? = null,
    val start: Place? = null,
    val end: Place? = null,
    val route: TourRoute? = null,
)

@Serializable
data class TourPackage(val tour: TourInfo, val stops: List<TourStop>)

@Serializable
data class DeliveryReason(val id: String, val outcomeCode: String, val labelEn: String, val labelDe: String) {
    val label: String get() = if (isGerman()) labelDe else labelEn
}

@Serializable
data class DeliveryOutcome(
    val code: String,
    val labelEn: String,
    val labelDe: String,
    val kind: String,
    val icon: String? = null,
    val color: String? = null,
    val requiresReason: Boolean = false,
    val requiresPhoto: Boolean = false,
    val requiresSignature: Boolean = false,
    val requiresRecipient: Boolean = false,
    val requiresScan: Boolean = false,
    val final: Boolean = true,
    val sort: Int = 0,
    val reasons: List<DeliveryReason> = emptyList(),
) {
    val label: String get() = if (isGerman()) labelDe else labelEn
    val isSuccess get() = kind == "success"
    val completesStop get() = final && kind != "neutral"
}

@Serializable
data class AppConfig(
    val brand: Brand,
    val company: Company,
    val map: MapInfo,
    val notifyLeadStops: Int = 3,
    val scanAccept: String? = null,
    val outcomes: List<DeliveryOutcome> = emptyList(),
) {
    @Serializable data class Brand(val name: String, val color: String, val logoUrl: String? = null)
    @Serializable data class Company(val name: String = "", val phone: String = "")
    @Serializable data class MapInfo(val provider: String, val styleUrl: String, val attribution: String = "")
}

@Serializable
data class PositionPoint(val t: String, val lat: Double, val lon: Double, val acc: Double? = null, val speed: Double? = null, val heading: Double? = null)

fun isGerman(): Boolean = Locale.getDefault().language == "de"

/** "#2563eb" → ARGB int, null if invalid */
fun parseHexColor(hex: String?): Long? {
    val s = hex?.trim()?.removePrefix("#") ?: return null
    if (s.length != 6) return null
    return s.toLongOrNull(16)?.let { 0xFF000000 or it }
}
