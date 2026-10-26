import Foundation

/// Local view of a stop: server state from the tour package, overlaid with the driver's own
/// events from the outbox (which may not have reached the server yet).
enum StopProgress {
    enum State: Equatable {
        case open
        case arrived
        case delivered(outcome: String?)
        case failed(outcome: String?)
        /// last outcome was rejected by the server – needs attention
        case rejected(String)

        var isCompleted: Bool {
            switch self {
            case .delivered, .failed: true
            default: false
            }
        }
    }

    static func states(_ package: TourPackage, events: [PendingEvent]) -> [String: State] {
        var out: [String: State] = [:]
        for stop in package.stops {
            switch stop.status {
            case "delivered": out[stop.id] = .delivered(outcome: stop.outcomeCode)
            case "failed", "skipped": out[stop.id] = .failed(outcome: stop.outcomeCode)
            case "arrived": out[stop.id] = .arrived
            default: out[stop.id] = .open
            }
        }
        for e in events where e.tourID == package.tour.id {
            if e.rejected {
                out[e.stopID] = .rejected(e.lastError ?? "")
            } else if e.completesStop {
                out[e.stopID] = e.isSuccess ? .delivered(outcome: e.outcomeCode) : .failed(outcome: e.outcomeCode)
            } else if e.type == "arrived", out[e.stopID] == .open {
                out[e.stopID] = .arrived
            }
        }
        return out
    }

    static func completedIDs(_ package: TourPackage, events: [PendingEvent]) -> Set<String> {
        Set(states(package, events: events).filter { $0.value.isCompleted }.map(\.key))
    }
}
