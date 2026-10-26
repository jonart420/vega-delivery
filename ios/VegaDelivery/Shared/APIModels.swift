import Foundation

struct AppUser: Codable, Equatable {
    let id: String
    let username: String
    let displayName: String?
    var role: String? = nil
    var locale: String? = nil

    var name: String { displayName ?? username }
}

enum TourMode: String, Codable {
    case auto, bicycle, pedestrian

    var label: String {
        switch self {
        case .auto: String(localized: "Car / van")
        case .bicycle: String(localized: "Cargo bike")
        case .pedestrian: String(localized: "On foot")
        }
    }

    var symbol: String {
        switch self {
        case .auto: "car.fill"
        case .bicycle: "bicycle"
        case .pedestrian: "figure.walk"
        }
    }

    /// Valhalla costing for the routing proxy
    var costing: String { rawValue }
}

/// Entry of the tour list (GET /api/app/tours)
struct TourSummary: Codable, Identifiable, Equatable {
    let id: String
    let date: String
    let title: String
    let vehicle: String?
    let mode: TourMode
    /// released | in_progress | done
    let status: String
    let plannedStart: String?
    let startedAt: String?
    let finishedAt: String?
    let distanceKm: Double?
    let durationS: Double?
    let routeComputedAt: String?
    let stopCount: Int
    let completedCount: Int

    var isDone: Bool { status == "done" }
    var isRunning: Bool { status == "in_progress" }
}

struct Place: Codable, Equatable {
    let lat: Double
    let lon: Double
    let label: String?
}

struct RouteLeg: Codable, Equatable {
    let distanceKm: Double
    let durationS: Double
}

struct TourRoute: Codable, Equatable {
    let order: [String]
    /// [lon, lat] pairs
    let geometry: [[Double]]
    let distanceKm: Double
    let durationS: Double
    let legs: [RouteLeg]
    let computedAt: String
}

struct OrderItem: Codable, Equatable, Identifiable {
    let id: String
    let productId: String?
    let nameSnapshot: String
    /// numeric as string from Postgres, e.g. "2.00"
    let qty: String
    let unit: String
    let unitPriceCents: Int

    var quantityText: String {
        let n = Double(qty) ?? 0
        return n == n.rounded() ? String(Int(n)) : String(format: "%.2f", n)
    }
}

struct StopOrder: Codable, Equatable, Identifiable {
    let id: String
    let orderNo: String
    let deliveryEan13: String
    let status: String
    let notes: String?
    let items: [OrderItem]
}

struct TourStop: Codable, Equatable, Identifiable, Hashable {
    let id: String
    let position: Int?
    /// pending | arrived | delivered | failed | skipped (server state when the package was loaded)
    let status: String
    let outcomeCode: String?
    let eta: String?
    let customerId: String
    let customerNo: String
    let name: String
    let company: String?
    let firstName: String?
    let lastName: String?
    let street: String
    let houseNo: String?
    let addressExtra: String?
    let zip: String
    let city: String
    let country: String
    let lat: Double?
    let lon: Double?
    let phone: String?
    let whatsapp: String?
    let deliveryNotes: String?
    let timeWindowFrom: String?
    let timeWindowTo: String?
    let trackingUrl: String
    let orders: [StopOrder]

    var streetLine: String { [street, houseNo].compactMap { $0 }.joined(separator: " ") }
    var addressLine: String { "\(streetLine), \(zip) \(city)" }
    var hasCoordinate: Bool { lat != nil && lon != nil }
    var isOpenOnServer: Bool { status == "pending" || status == "arrived" }
    var timeWindow: String? {
        guard timeWindowFrom != nil || timeWindowTo != nil else { return nil }
        return "\(timeWindowFrom ?? "…")–\(timeWindowTo ?? "…")"
    }

    /// Codes that prove presence at this stop (order EAN-13s and the customer EAN-8)
    func acceptedCodes(scanAccept: String) -> Set<String> {
        var out = Set<String>()
        if scanAccept != "customer" { out.formUnion(orders.map(\.deliveryEan13)) }
        if scanAccept != "delivery" { out.insert(customerNo) }
        return out
    }

    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct TourInfo: Codable, Equatable {
    let id: String
    let date: String
    let title: String
    let vehicle: String?
    let mode: TourMode
    let status: String
    let plannedStart: String?
    let start: Place?
    let end: Place?
    let route: TourRoute?
}

/// Complete tour package (GET /api/app/tours/:id) – cached for offline use.
struct TourPackage: Codable, Equatable {
    let tour: TourInfo
    let stops: [TourStop]

    var routeVersion: String { tour.route?.computedAt ?? "none" }
    var startPlace: Place? { tour.start ?? stops.first.flatMap { s in s.lat.map { Place(lat: $0, lon: s.lon ?? 0, label: nil) } } }
    var endPlace: Place? { tour.end ?? tour.start }
}

// MARK: - App configuration (GET /api/app/config)

struct DeliveryReason: Codable, Equatable, Identifiable, Hashable {
    let id: String
    let outcomeCode: String
    let labelEn: String
    let labelDe: String

    var label: String { Locale.current.language.languageCode?.identifier == "de" ? labelDe : labelEn }
}

struct DeliveryOutcome: Codable, Equatable, Identifiable, Hashable {
    let code: String
    let labelEn: String
    let labelDe: String
    /// success | failure | neutral
    let kind: String
    let icon: String?
    let color: String?
    let requiresReason: Bool
    let requiresPhoto: Bool
    let requiresSignature: Bool
    let requiresRecipient: Bool
    let requiresScan: Bool
    let final: Bool
    let sort: Int
    let reasons: [DeliveryReason]

    var id: String { code }
    var label: String { Locale.current.language.languageCode?.identifier == "de" ? labelDe : labelEn }
    var isSuccess: Bool { kind == "success" }
    var completesStop: Bool { final && kind != "neutral" }

    /// SF Symbol for the icon names used by the backend seed (free names fall back to a dot)
    var symbol: String {
        switch icon {
        case "check": "checkmark.circle.fill"
        case "users": "person.2.fill"
        case "box": "shippingbox.fill"
        case "half": "circle.lefthalf.filled"
        case "door": "door.left.hand.closed"
        case "hand": "hand.raised.fill"
        case "x": "xmark.octagon.fill"
        default: isSuccess ? "checkmark.circle" : kind == "failure" ? "exclamationmark.circle" : "info.circle"
        }
    }
}

struct AppConfig: Codable, Equatable {
    struct Brand: Codable, Equatable {
        let name: String
        let color: String
        let logoUrl: String?
    }
    struct Company: Codable, Equatable {
        let name: String
        let phone: String
    }
    struct MapInfo: Codable, Equatable {
        let provider: String
        let styleUrl: String
        let attribution: String
    }

    let brand: Brand
    let company: Company
    let map: MapInfo
    let notifyLeadStops: Int
    let scanAccept: String?
    let outcomes: [DeliveryOutcome]
}

enum Format {
    static func distance(_ km: Double) -> String {
        km < 1
            ? Measurement(value: (km * 1000).rounded(), unit: UnitLength.meters).formatted(.measurement(width: .abbreviated, usage: .asProvided))
            : Measurement(value: km, unit: UnitLength.kilometers).formatted(.measurement(width: .abbreviated, usage: .asProvided, numberFormatStyle: .number.precision(.fractionLength(1))))
    }

    static func duration(_ seconds: Double) -> String {
        Duration.seconds(seconds).formatted(.units(allowed: [.hours, .minutes], width: .abbreviated))
    }

    /// "2026-10-24" → localized medium date
    static func date(_ iso: String?) -> String? {
        guard let iso, iso.count >= 10 else { return nil }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = .current
        let p = iso.prefix(10).split(separator: "-").compactMap { Int($0) }
        guard p.count == 3, let d = cal.date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: 12)) else { return nil }
        return d.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).year())
    }

    static let isoParser: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    static func parse(_ iso: String?) -> Date? {
        guard let iso else { return nil }
        return isoParser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
    }

    static func time(_ iso: String?) -> String? {
        parse(iso)?.formatted(date: .omitted, time: .shortened)
    }
}

extension String {
    /// "#2563eb" → (r, g, b) 0…1
    var hexRGB: (Double, Double, Double)? {
        let s = trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "")
        guard s.count == 6, let v = UInt32(s, radix: 16) else { return nil }
        return (Double((v >> 16) & 0xff) / 255, Double((v >> 8) & 0xff) / 255, Double(v & 0xff) / 255)
    }
}
