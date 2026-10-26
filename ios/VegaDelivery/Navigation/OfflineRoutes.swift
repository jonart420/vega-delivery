import CoreLocation
@preconcurrency import FerrostarCore
@preconcurrency import FerrostarCoreFFI
import Foundation

/// Makes the routes of a tour available offline: all legs depot → stop 1 → … → last stop are
/// fetched in advance through the routing proxy (same format as Ferrostar uses) and stored.
/// Without network the navigation builds the route from them. Refetched when the server
/// recalculated the route.
enum OfflineRoutes {
    static let startKey = "start"

    /// Same routing provider as the navigation
    static func provider(for package: TourPackage, baseURL: URL) throws -> WellKnownRouteProvider {
        let options: [String: Any] = ["directions_options": ["language": NavigationLanguage.valhalla, "units": "kilometers"]]
        return try WellKnownRouteProvider.valhalla(
            endpointUrl: baseURL.appending(path: "api/app/valhalla/route").absoluteString,
            profile: package.tour.mode.costing
        ).withJsonOptions(options: options)
    }

    private static func directory(_ tourID: String) -> URL {
        URL.applicationSupportDirectory.appending(path: "Routes/\(tourID)", directoryHint: .isDirectory)
    }

    private static func file(_ tourID: String, from: String, to: String) -> URL {
        directory(tourID).appending(path: "\(from)__\(to).json")
    }

    private static func versionFile(_ tourID: String) -> URL { directory(tourID).appending(path: "version.txt") }

    /// Legs in route order: (from key, target stop, origin coordinate)
    private static func legs(_ package: TourPackage) -> [(from: String, spot: TourStop, origin: (lat: Double, lon: Double))] {
        guard let start = package.startPlace else { return [] }
        var out: [(String, TourStop, (lat: Double, lon: Double))] = []
        var fromKey = startKey
        var origin = (lat: start.lat, lon: start.lon)
        for stop in package.stops {
            guard let lat = stop.lat, let lon = stop.lon else { continue }
            out.append((fromKey, stop, origin))
            fromKey = stop.id
            origin = (lat, lon)
        }
        return out
    }

    /// How many legs are stored for the current route version?
    static func status(_ package: TourPackage) -> (cached: Int, total: Int) {
        let all = legs(package)
        guard (try? String(contentsOf: versionFile(package.tour.id), encoding: .utf8)) == package.routeVersion else {
            return (0, all.count)
        }
        let n = all.filter { FileManager.default.fileExists(atPath: file(package.tour.id, from: $0.from, to: $0.spot.id).path) }.count
        return (n, all.count)
    }

    /// Fetches missing legs (everything for a new route version). Returns the status afterwards.
    @discardableResult
    static func prefetch(_ package: TourPackage, baseURL: URL, token: String?) async -> (cached: Int, total: Int) {
        let tid = package.tour.id
        let fm = FileManager.default
        if (try? String(contentsOf: versionFile(tid), encoding: .utf8)) != package.routeVersion {
            try? fm.removeItem(at: directory(tid))
        }
        try? fm.createDirectory(at: directory(tid), withIntermediateDirectories: true)
        try? package.routeVersion.write(to: versionFile(tid), atomically: true, encoding: .utf8)

        guard let adapter = try? RouteAdapter.fromWellKnownRouteProvider(wellKnownRouteProvider: provider(for: package, baseURL: baseURL)) else {
            return status(package)
        }
        let session = AuthorizedSession(token: token)
        for leg in legs(package) {
            let target = file(tid, from: leg.from, to: leg.spot.id)
            if fm.fileExists(atPath: target.path) { continue }
            let here = UserLocation(coordinates: GeographicCoordinate(lat: leg.origin.lat, lng: leg.origin.lon),
                                    horizontalAccuracy: 5, courseOverGround: nil, timestamp: .now, speed: nil)
            let waypoint = Waypoint(coordinate: GeographicCoordinate(lat: leg.spot.lat!, lng: leg.spot.lon!), kind: .break)
            guard case let .httpPost(url, headers, body)? = try? adapter.generateRequest(userLocation: here, waypoints: [waypoint]),
                  let requestURL = URL(string: url) else { continue }
            var request = URLRequest(url: requestURL)
            request.httpMethod = "POST"
            request.httpBody = body
            headers.forEach { request.setValue($1, forHTTPHeaderField: $0) }
            guard let (data, response) = try? await session.loadData(with: request),
                  (response as? HTTPURLResponse)?.statusCode == 200,
                  (try? adapter.parseResponse(response: data))?.isEmpty == false else { continue }
            try? data.write(to: target, options: .atomic)
        }
        return status(package)
    }

    /// Stored route to a stop: preferably from `fromKey` (previous stop or depot),
    /// otherwise any stored leg ending at this stop.
    static func route(_ package: TourPackage, to spotID: String, from fromKey: String?, baseURL: URL) -> Route? {
        let tid = package.tour.id
        var candidates: [URL] = []
        if let fromKey { candidates.append(file(tid, from: fromKey, to: spotID)) }
        if let all = try? FileManager.default.contentsOfDirectory(at: directory(tid), includingPropertiesForKeys: nil) {
            candidates += all.filter { $0.lastPathComponent.hasSuffix("__\(spotID).json") }
        }
        guard let adapter = try? RouteAdapter.fromWellKnownRouteProvider(wellKnownRouteProvider: provider(for: package, baseURL: baseURL)) else {
            return nil
        }
        for url in candidates {
            if let data = try? Data(contentsOf: url), let route = (try? adapter.parseResponse(response: data))?.first {
                return route
            }
        }
        return nil
    }
}
