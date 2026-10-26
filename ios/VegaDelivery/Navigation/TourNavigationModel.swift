import AudioToolbox
import Combine
import CoreLocation
@preconcurrency import FerrostarCore
@preconcurrency import FerrostarCoreFFI
import FerrostarMapLibreUI
import Foundation
import MapLibreSwiftUI
import Observation
import UIKit

/// Drives the navigation through a delivery tour by car: always to the next open stop, arrival by
/// geofence, "later" (move a stop to the end), re-optimize from here. Feeds the live position for
/// the customers' tracking links.
@MainActor
@Observable
final class TourNavigationModel: Identifiable {
    nonisolated let id = UUID()
    enum Phase: Equatable {
        case idle            // not started / between two stops
        case loadingRoute
        case navigating
        case arrived(String) // stop id
        case finished        // all stops done
    }

    /// Car tuning: GPS in streets with parked cars and courtyards is less precise than on foot
    static let arrivalRadius: CLLocationDistance = 50
    static let approachDistance: CLLocationDistance = 200

    let package: TourPackage
    let scanAccept: String
    let styleURL: URL
    private(set) var phase: Phase = .idle
    private(set) var order: [String]           // stop ids in current order
    private(set) var handled: Set<String>      // stops with a completing outcome
    var errorMessage: String?
    var camera: MapViewCamera
    private(set) var navState: NavigationState?
    let isSimulated: Bool

    @ObservationIgnored let core: FerrostarCore
    @ObservationIgnored private let baseURL: URL
    @ObservationIgnored private let location: LocationProviding
    @ObservationIgnored private let simulated: SimulatedLocationProvider?
    @ObservationIgnored private let speech: NavigationSpeechSynthesizer
    @ObservationIgnored private var cancellables = Set<AnyCancellable>()
    @ObservationIgnored private let rerouteDelegate = RerouteDelegate()
    @ObservationIgnored private var wrongWay = WrongWayDetector()
    @ObservationIgnored private var approachAnnouncedFor: String?
    @ObservationIgnored private var arrivedReportedFor: Set<String> = []
    /// Stop whose arrival was just dismissed: only trigger again after moving away a bit
    @ObservationIgnored private var suppressedArrivalID: String?

    /// Driving the wrong way: remaining distance, otherwise nil
    private(set) var wrongWayRemaining: Double?

    var stopsByID: [String: TourStop] { Dictionary(uniqueKeysWithValues: package.stops.map { ($0.id, $0) }) }

    var nextStop: TourStop? {
        order.lazy.filter { !self.handled.contains($0) }.compactMap { self.stopsByID[$0] }.first
    }

    var remainingCount: Int { order.filter { !handled.contains($0) }.count }
    var isMuted: Bool { core.spokenInstructionObserver.isMuted }
    var lastCoordinate: CLLocationCoordinate2D? { location.lastLocation?.clLocation.coordinate }

    /// Stops without coordinates cannot be navigated to – they are listed but skipped by the geofence
    var stopsWithoutCoordinate: [TourStop] { package.stops.filter { !$0.hasCoordinate && !handled.contains($0.id) } }

    init(package: TourPackage, baseURL: URL, token: String?, completed: Set<String>, scanAccept: String,
         styleURL: URL?, simulate: Bool = false, resumeOrder: [String]? = nil,
         apiProvider: @escaping () -> APIClient?) throws {
        self.package = package
        self.scanAccept = scanAccept
        self.styleURL = styleURL ?? URL(string: "https://tiles.openfreemap.org/styles/liberty")!
        let planned = package.stops.filter(\.hasCoordinate).map(\.id)
        if let resumeOrder {
            let known = resumeOrder.filter(Set(planned).contains)
            order = known + planned.filter { !known.contains($0) }
        } else {
            order = planned
        }
        handled = completed
        #if targetEnvironment(simulator)
        isSimulated = simulate || ProcessInfo.processInfo.environment["VD_SIMULATE_DRIVE"] == "1"
        #else
        isSimulated = simulate
        #endif

        let startPlace = package.startPlace ?? Place(lat: 0, lon: 0, label: nil)
        let start = CLLocation(latitude: startPlace.lat, longitude: startPlace.lon)
        if isSimulated {
            let sim = SimulatedLocationProvider(location: start)
            sim.warpFactor = 4
            simulated = sim
            location = sim
        } else {
            simulated = nil
            location = CoreLocationProvider(activityType: package.tour.mode == .auto ? .automotiveNavigation : .otherNavigation,
                                            allowBackgroundLocationUpdates: true)
        }
        camera = .center(start.coordinate, zoom: 14)

        let speech = NavigationSpeechSynthesizer()
        self.speech = speech
        let config = SwiftNavigationControllerConfig(
            waypointAdvance: .waypointWithinRange(Self.arrivalRadius),
            stepAdvanceCondition: stepAdvanceDistanceEntryAndExit(
                distanceToEndOfStep: 40,
                distanceAfterEndOfStep: 10,
                minimumHorizontalAccuracy: 40
            ),
            arrivalStepAdvanceCondition: stepAdvanceDistanceToEndOfStep(distance: 25, minimumHorizontalAccuracy: 40),
            routeDeviationTracking: .staticThreshold(minimumHorizontalAccuracy: 30, maxAcceptableDeviation: 50),
            snappedLocationCourseFiltering: .snapToRoute
        )
        self.baseURL = baseURL
        core = try FerrostarCore(
            wellKnownRouteProvider: OfflineRoutes.provider(for: package, baseURL: baseURL),
            locationProvider: location,
            navigationControllerConfig: config,
            networkSession: AuthorizedSession(token: token),
            spokenInstructionObserver: SpokenInstructionObserver(synthesizer: speech, isMuted: false)
        )

        rerouteDelegate.model = self
        core.delegate = rerouteDelegate

        if package.tour.status == "in_progress" && !isSimulated {
            PositionReporter.shared.start(tourID: package.tour.id, api: apiProvider)
        }

        core.$state.receive(on: DispatchQueue.main).sink { [weak self] state in
            self?.navState = state
            self?.reportPosition()
            self?.checkWrongWay(state)
            self?.announceApproach(state)
            self?.checkArrival()
        }.store(in: &cancellables)
        location.startUpdating()
    }

    // MARK: - Flow

    /// Fetches the route to the next open stop and starts navigating.
    /// `rerouted`: the route changes on the way → first instruction starts with "New route calculated: …"
    func navigateToNext(rerouted: Bool = false) async {
        let prepare: (Route) -> Route = { RouteSpeech.prepared($0, rerouted: rerouted) }
        guard let stop = nextStop, let lat = stop.lat, let lon = stop.lon else {
            phase = .finished
            TourSessionStore.clear(tourID: package.tour.id)
            announce(String(localized: "All stops of this tour are done."))
            return
        }
        guard let here = location.lastLocation else {
            errorMessage = String(localized: "No location yet")
            return
        }
        phase = .loadingRoute
        errorMessage = nil
        do {
            let routes = try await core.getRoutes(
                initialLocation: here,
                waypoints: [Waypoint(coordinate: GeographicCoordinate(lat: lat, lng: lon), kind: .break)]
            )
            guard let route = routes.first.map(prepare) else {
                throw APIError.server(String(localized: "No route found"), status: 404, code: nil)
            }
            try start(route)
        } catch {
            // Offline: use the stored leg (from the previous stop or the depot)
            let previous = order.prefix { $0 != stop.id }.last { handled.contains($0) } ?? OfflineRoutes.startKey
            if let cached = OfflineRoutes.route(package, to: stop.id, from: previous, baseURL: baseURL).map(prepare) {
                try? start(cached)
                errorMessage = String(localized: "Offline · stored route")
            } else {
                errorMessage = String(localized: "Offline · arrival by GPS")
            }
            phase = .navigating
        }
    }

    private func start(_ route: Route) throws {
        resetLegAssist()
        if let simulated { try simulated.setSimulatedRoute(route, resampleDistance: 10) }
        try core.startNavigation(route: route)
        camera = package.tour.mode == .auto ? .automotiveNavigation(zoom: 16, pitch: 45) : .bicycleNavigation(zoom: 16.5, pitch: 30)
        phase = .navigating
    }

    // MARK: - Live position

    private func reportPosition() {
        guard !isSimulated, let raw = location.lastLocation else { return }
        PositionReporter.shared.record(raw.clLocation)
    }

    // MARK: - Assistance

    private func resetLegAssist() {
        wrongWay.reset()
        wrongWayRemaining = nil
    }

    /// On the route, but driving against it: "Please turn around", recalculate after 60 s / 800 m.
    private func checkWrongWay(_ state: NavigationState?) {
        guard phase == .navigating, state?.isCalculatingNewRoute != true,
              case let .navigating(index, raw, snapped, steps, _, progress, _, _, _, _, _)? = state?.tripState,
              let step = steps.first else {
            wrongWayRemaining = nil
            return
        }
        let routeBearing = RouteMath.bearing(of: step.geometry, at: Int(index ?? 0))
        let course = (raw.speed?.value ?? 1) > 1.5 ? raw.courseOverGround.map { Double($0.degrees) } : nil
        let event = wrongWay.update(at: raw.coordinates, course: course, routeBearing: routeBearing, time: raw.timestamp)
        wrongWayRemaining = wrongWay.isWrongWay
            ? progress.distanceRemaining + RouteMath.distance(raw.coordinates, snapped.coordinates) : nil
        switch event {
        case .none:
            break
        case .turnAround:
            announce(String(localized: "Please turn around when possible."))
        case .recalculate:
            wrongWayRemaining = nil
            Task { await navigateToNext(rerouted: true) }
        }
    }

    /// Shortly before the stop: which side of the road it is on, plus the delivery notes
    private func announceApproach(_ state: NavigationState?) {
        guard phase == .navigating, let stop = nextStop, approachAnnouncedFor != stop.id,
              let progress = state?.currentProgress, progress.distanceRemaining <= Self.approachDistance,
              let geometry = state?.routeGeometry, let lat = stop.lat, let lon = stop.lon else { return }
        approachAnnouncedFor = stop.id
        announce(Self.approachText(stop, side: RouteMath.side(of: GeographicCoordinate(lat: lat, lng: lon), routeEnd: geometry)))
    }

    nonisolated static func approachText(_ stop: TourStop, side: RouteMath.Side?) -> String {
        var text: String
        switch side {
        case .left: text = String(localized: "\(stop.name) is on the left.")
        case .right: text = String(localized: "\(stop.name) is on the right.")
        case nil: text = String(localized: "\(stop.name) is nearby.")
        }
        if let note = stop.deliveryNotes?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty {
            text += " " + (note.hasSuffix(".") ? note : note + ".")
        }
        return text
    }

    /// Ferrostar recalculated because of a deviation
    fileprivate func acceptReroute(_ route: Route) {
        guard phase == .navigating else { return }
        let route = RouteSpeech.prepared(route, rerouted: true)
        resetLegAssist()
        if let simulated { try? simulated.setSimulatedRoute(route, resampleDistance: 10) }
        try? core.startNavigation(route: route)
    }

    private func announce(_ text: String) {
        guard !isMuted else { return }
        speech.say(text)
    }

    // MARK: - Arrival

    private func checkArrival() {
        guard phase == .navigating, let stop = nextStop, let lat = stop.lat, let lon = stop.lon, let here = lastCoordinate else { return }
        let d = CLLocation(latitude: here.latitude, longitude: here.longitude).distance(from: CLLocation(latitude: lat, longitude: lon))
        if suppressedArrivalID == stop.id {
            if d > Self.arrivalRadius * 2 { suppressedArrivalID = nil }
            return
        }
        if d <= Self.arrivalRadius { arrive(at: stop) }
    }

    /// Dismiss the arrival (triggered too early): the stop stays open.
    @discardableResult
    func dismissArrival() -> Bool {
        guard case let .arrived(id) = phase else { return false }
        suppressedArrivalID = id
        phase = .idle
        return true
    }

    /// "I'm here" (poor GPS in a courtyard, underground car park …)
    func arriveManually() {
        guard let stop = nextStop else { return }
        arrive(at: stop)
    }

    private func arrive(at stop: TourStop) {
        core.stopNavigation()
        phase = .arrived(stop.id)
        Haptics.arrived()
        announce(String(localized: "Destination reached: \(stop.name)."))
        approachAnnouncedFor = stop.id
        resetLegAssist()
        reportArrival(stop)
    }

    /// Logs "arrived" once per stop (tracking page shows "the driver has arrived")
    private func reportArrival(_ stop: TourStop) {
        guard !isSimulated, package.tour.status == "in_progress", !arrivedReportedFor.contains(stop.id) else { return }
        arrivedReportedFor.insert(stop.id)
        let clientID = UUID().uuidString
        var meta: [String: Any] = ["client_id": clientID, "stop_id": stop.id, "type": "arrived",
                                   "occurred_at": Format.isoParser.string(from: .now)]
        if let c = lastCoordinate {
            meta["lat"] = c.latitude
            meta["lon"] = c.longitude
        }
        guard let data = try? JSONSerialization.data(withJSONObject: meta) else { return }
        Outbox.shared.enqueue(PendingEvent(clientID: clientID, tourID: package.tour.id, stopID: stop.id, type: "arrived",
                                           outcomeCode: nil, completesStop: false, isSuccess: false, meta: data,
                                           photoPath: nil, signaturePath: nil))
    }

    /// Outcome recorded → continue with the next stop
    func markHandled(_ stopID: String) {
        handled.insert(stopID)
        phase = .idle
        autosave()
    }

    /// Moves the next stop to the end of the tour ("deliver later").
    func postponeNext() {
        guard let stop = nextStop else { return }
        core.stopNavigation()
        order.removeAll { $0 == stop.id }
        order.append(stop.id)
        phase = .idle
        autosave()
    }

    /// New order of the open stops from the current position, then route to the new next stop.
    func reoptimizeAndContinue() async {
        let before = nextStop?.id
        reoptimizeFromHere()
        guard let next = nextStop else { return }
        if next.id != before { announce(String(localized: "New order. Next stop: \(next.name).")) }
        await navigateToNext(rerouted: true)
    }

    func reoptimizeFromHere() {
        guard let here = lastCoordinate else {
            errorMessage = String(localized: "No location yet")
            return
        }
        let open = order.filter { !handled.contains($0) }.compactMap { stopsByID[$0] }.filter(\.hasCoordinate)
        let endPlace = package.endPlace ?? Place(lat: here.latitude, lon: here.longitude, label: nil)
        let idx = LocalReorder.order(
            from: here,
            points: open.map { CLLocationCoordinate2D(latitude: $0.lat!, longitude: $0.lon!) },
            end: CLLocationCoordinate2D(latitude: endPlace.lat, longitude: endPlace.lon)
        )
        order = order.filter { handled.contains($0) } + idx.map { open[$0].id }
        core.stopNavigation()
        phase = .idle
        autosave()
    }

    func autosave() {
        if let next = nextStop {
            TourSessionStore.save(TourSession(order: order, nextStopID: next.id, updatedAt: .now), tourID: package.tour.id)
        } else {
            TourSessionStore.clear(tourID: package.tour.id)
        }
    }

    func stop() {
        core.stopNavigation()
        location.stopUpdating()
        phase = .idle
    }

    func toggleMute() { core.spokenInstructionObserver.toggleMute() }
}

/// Takes over Ferrostar's recalculation (deviation) so the instruction tweaks apply to the new route
private final class RerouteDelegate: FerrostarCoreDelegate {
    weak var model: TourNavigationModel?

    func core(_ core: FerrostarCore, didStartWith route: Route) {}

    func core(_ core: FerrostarCore, correctiveActionForDeviation deviation: DeviationKind,
              remainingWaypoints waypoints: [Waypoint]) -> CorrectiveAction {
        .getNewRoutes(waypoints: waypoints)
    }

    func core(_ core: FerrostarCore, loadedAlternateRoutes routes: [Route]) {
        guard let route = routes.first else { return }
        Task { @MainActor [weak model] in model?.acceptReroute(route) }
    }
}

/// Short vibration on arrival – also with locked screen / in background
enum Haptics {
    @MainActor
    static func arrived() {
        if UIApplication.shared.applicationState == .active {
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } else {
            AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
        }
    }
}
