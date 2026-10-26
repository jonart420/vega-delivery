import CoreLocation
import Foundation

/// Sends the vehicle position of a running tour to the server for the customers' tracking links
/// and the dispatcher map: a point every 15 s or 100 m, batched (and kept) while offline.
@MainActor
final class PositionReporter {
    static let shared = PositionReporter()

    static let minInterval: TimeInterval = 15
    static let minDistance: CLLocationDistance = 100
    static let maxBuffer = 2000

    private(set) var tourID: String?
    private var buffer: [APIClient.PositionPoint] = []
    private var lastKept: CLLocation?
    private var lastSent = Date.distantPast
    private var sending = false
    var apiProvider: (() -> APIClient?)?

    func start(tourID: String, api: @escaping () -> APIClient?) {
        if self.tourID != tourID {
            buffer = []
            lastKept = nil
        }
        self.tourID = tourID
        apiProvider = api
    }

    func stop() {
        Task { await send(force: true) }
        tourID = nil
    }

    func record(_ location: CLLocation) {
        guard tourID != nil, location.horizontalAccuracy >= 0, location.horizontalAccuracy <= 100 else { return }
        if let last = lastKept,
           location.timestamp.timeIntervalSince(last.timestamp) < Self.minInterval,
           location.distance(from: last) < Self.minDistance { return }
        lastKept = location
        buffer.append(APIClient.PositionPoint(
            t: Format.isoParser.string(from: location.timestamp),
            lat: location.coordinate.latitude,
            lon: location.coordinate.longitude,
            acc: location.horizontalAccuracy,
            speed: location.speed >= 0 ? location.speed : nil,
            heading: location.course >= 0 ? location.course : nil
        ))
        if buffer.count > Self.maxBuffer { buffer.removeFirst(buffer.count - Self.maxBuffer) }
        if Date.now.timeIntervalSince(lastSent) >= Self.minInterval { Task { await send() } }
    }

    private func send(force: Bool = false) async {
        guard !sending, let tourID, !buffer.isEmpty, let api = apiProvider?() else { return }
        sending = true
        defer { sending = false }
        let batch = buffer
        do {
            try await api.postPositions(tourID: tourID, points: batch)
            buffer.removeFirst(min(batch.count, buffer.count))
            lastSent = .now
        } catch {
            // offline: keep the points, the next location triggers another attempt
            lastSent = .now
        }
    }
}
