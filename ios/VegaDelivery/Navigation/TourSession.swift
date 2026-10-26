import Foundation

/// Remembered state of an interrupted navigation (on the device): current stop order and next
/// stop, so the driver continues exactly there. Completed stops come from the outbox.
struct TourSession: Codable, Equatable {
    var order: [String]
    var nextStopID: String?
    var updatedAt: Date
}

enum TourSessionStore {
    private static func key(_ tourID: String) -> String { "tourSession.\(tourID)" }

    static func load(tourID: String) -> TourSession? {
        guard let data = UserDefaults.standard.data(forKey: key(tourID)) else { return nil }
        return try? JSONDecoder().decode(TourSession.self, from: data)
    }

    static func save(_ session: TourSession, tourID: String) {
        if let data = try? JSONEncoder().encode(session) { UserDefaults.standard.set(data, forKey: key(tourID)) }
    }

    static func clear(tourID: String) {
        UserDefaults.standard.removeObject(forKey: key(tourID))
    }
}
