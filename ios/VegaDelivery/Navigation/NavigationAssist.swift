import CoreLocation
@preconcurrency import FerrostarCoreFFI
import Foundation

/// Geometry helpers for announcements and wrong-way detection
enum RouteMath {
    static func distance(_ a: GeographicCoordinate, _ b: GeographicCoordinate) -> Double {
        CLLocation(latitude: a.lat, longitude: a.lng).distance(from: CLLocation(latitude: b.lat, longitude: b.lng))
    }

    static func bearing(_ a: GeographicCoordinate, _ b: GeographicCoordinate) -> Double {
        let la1 = a.lat * .pi / 180, la2 = b.lat * .pi / 180, dl = (b.lng - a.lng) * .pi / 180
        let y = sin(dl) * cos(la2)
        let x = cos(la1) * sin(la2) - sin(la1) * cos(la2) * cos(dl)
        return (atan2(y, x) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
    }

    /// Smallest angle between two directions (0…180°)
    static func angle(_ a: Double, _ b: Double) -> Double {
        abs((a - b + 540).truncatingRemainder(dividingBy: 360) - 180)
    }

    /// Direction `b` relative to `a` (−180…180°, positive = right)
    static func relative(_ b: Double, to a: Double) -> Double {
        (b - a + 540).truncatingRemainder(dividingBy: 360) - 180
    }

    /// Direction of the route from point `index` (over the next ~8 m, ignoring short kinks)
    static func bearing(of g: [GeographicCoordinate], at index: Int) -> Double? {
        guard g.count > 1 else { return nil }
        let i = min(max(index, 0), g.count - 1)
        if let p = g[(i + 1)...].first(where: { distance(g[i], $0) > 8 }) ?? (i + 1 < g.count ? g.last : nil),
           distance(g[i], p) > 2 {
            return bearing(g[i], p)
        }
        // at the end: direction of the last piece
        guard let p = g[..<i].last(where: { distance($0, g[i]) > 8 }) ?? g.first, distance(p, g[i]) > 2 else { return nil }
        return bearing(p, g[i])
    }

    enum Side { case left, right }

    /// Is the target left or right of the end of the route? nil: ahead/behind or on the line
    static func side(of target: GeographicCoordinate, routeEnd g: [GeographicCoordinate]) -> Side? {
        guard let end = g.last, let heading = bearing(of: g, at: g.count - 1), distance(end, target) > 3 else { return nil }
        let rel = relative(bearing(end, target), to: heading)
        if rel > 20 && rel < 160 { return .right }
        if rel < -20 && rel > -160 { return .left }
        return nil
    }
}

/// Detects driving the wrong way along the route (Ferrostar only notices when the vehicle is
/// beyond the deviation threshold – along the same road never).
/// 50 m against the route → "Please turn around" (repeated every 45 s);
/// after 60 s or 800 m in the wrong direction → recalculate.
struct WrongWayDetector {
    enum Event: Equatable { case none, turnAround, recalculate }

    static let wrongAngle = 120.0
    static let rightAngle = 60.0
    static let confirmMeters = 50.0
    static let recalcSeconds: TimeInterval = 60
    static let recalcMeters = 800.0
    static let repeatSeconds: TimeInterval = 45

    private(set) var wrongSince: Date?
    private(set) var wrongMeters = 0.0
    private var rightMeters = 0.0
    private var lastPoint: GeographicCoordinate?
    private var lastWarned: Date?

    var isWrongWay: Bool { wrongSince != nil }

    mutating func reset() {
        wrongSince = nil
        wrongMeters = 0
        rightMeters = 0
        lastWarned = nil
    }

    /// `course`: direction from GPS (if available), `routeBearing`: direction of the route at this point
    mutating func update(at point: GeographicCoordinate, course: Double?, routeBearing: Double?, time: Date) -> Event {
        guard let last = lastPoint else {
            lastPoint = point
            return .none
        }
        let step = RouteMath.distance(last, point)
        // standing/jitter: keep the old point so small steps add up
        guard step >= 3 else { return .none }
        lastPoint = point
        guard step < 500, let routeBearing else { return .none } // GPS jump (cars cover ~400 m between fixes at most)
        let heading = course ?? RouteMath.bearing(last, point)
        let diff = RouteMath.angle(heading, routeBearing)

        if diff < Self.rightAngle {
            rightMeters += step
            if rightMeters >= 30 { reset() }
            return .none
        }
        guard diff > Self.wrongAngle else { return .none }
        rightMeters = 0
        wrongMeters += step

        guard let since = wrongSince else {
            guard wrongMeters >= Self.confirmMeters else { return .none }
            wrongSince = time
            lastWarned = time
            return .turnAround
        }
        if time.timeIntervalSince(since) >= Self.recalcSeconds || wrongMeters >= Self.recalcMeters {
            reset()
            return .recalculate
        }
        if let warned = lastWarned, time.timeIntervalSince(warned) >= Self.repeatSeconds {
            lastWarned = time
            return .turnAround
        }
        return .none
    }
}

/// Completes the route's voice instructions
enum RouteSpeech {
    /// "250 metres", "1.2 kilometres" (rounded like spoken language)
    static func spoken(_ meters: Double) -> String {
        if meters < 1000 {
            let step = meters < 100 ? 10.0 : 50.0
            let m = max(Int((meters / step).rounded() * step), 10)
            return NavigationLanguage.current == "de" ? "\(m) Meter" : "\(m) metres"
        }
        let km = (meters / 100).rounded() / 10
        let text = km == km.rounded() ? "\(Int(km))" : String(format: "%.1f", km)
        return NavigationLanguage.current == "de" ? "\(text.replacingOccurrences(of: ".", with: ",")) Kilometer" : "\(text) kilometres"
    }

    private static let cardinal = #"Richtung (Norden|Nordosten|Osten|Südosten|Süden|Südwesten|Westen|Nordwesten)"#
    private static let hasDistance = #"\d+(,\d+)? ?(Meter|Metern|Kilometer|Kilometern|km|m)\b"#

    /// Valhalla's first instruction is only "Fahren Sie Richtung Süden auf der X-Straße." – without a
    /// length. Append "Weiter für 2 Kilometer." (German instructions only).
    static func withDistance(_ text: String, meters: Double) -> String {
        let base = NavigationSpeechSynthesizer.withoutFollowUp(text)
        guard NavigationLanguage.current == "de",
              base.range(of: cardinal, options: .regularExpression) != nil,
              base.range(of: hasDistance, options: .regularExpression) == nil,
              meters >= 100 else { return text }
        let trimmed = base.trimmingCharacters(in: .whitespaces)
        let sentence = trimmed.hasSuffix(".") ? trimmed : trimmed + "."
        return "\(sentence) Weiter für \(spoken(meters))."
    }

    /// Completes instructions; for a changed route the first one starts with "New route calculated:"
    static func prepared(_ route: Route, rerouted: Bool) -> Route {
        let route = enrich(route)
        return rerouted ? announcingNewRoute(route) : route
    }

    static var newRoutePrefix: String { String(localized: "New route calculated: ") }

    /// Prefix the route's first instruction, so Ferrostar says both in one sentence
    static func announcingNewRoute(_ route: Route) -> Route {
        var route = route
        guard var first = route.steps.first else { return route }
        if var instruction = first.spokenInstructions.first {
            instruction.text = newRoutePrefix + NavigationSpeechSynthesizer.withoutFollowUp(instruction.text)
            instruction.ssml = nil
            first.spokenInstructions[0] = instruction
        } else {
            first.spokenInstructions = [SpokenInstruction(
                text: newRoutePrefix + first.instruction, ssml: nil,
                triggerDistanceBeforeManeuver: first.distance, utteranceId: UUID()
            )]
        }
        route.steps[0] = first
        return route
    }

    static func enrich(_ route: Route) -> Route {
        var route = route
        route.steps = route.steps.map { step in
            var step = step
            step.spokenInstructions = step.spokenInstructions.map { instruction in
                var instruction = instruction
                let text = withDistance(instruction.text, meters: min(instruction.triggerDistanceBeforeManeuver, step.distance))
                if text != instruction.text {
                    instruction.text = text
                    instruction.ssml = nil
                }
                return instruction
            }
            return step
        }
        return route
    }
}
