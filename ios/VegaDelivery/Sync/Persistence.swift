import Foundation
import SwiftData

/// Delivery event waiting for (or already sent to) the server. The app's outbox: events are
/// stored first and sent when the network allows; `clientID` makes resending idempotent.
@Model
final class PendingEvent {
    @Attribute(.unique) var clientID: String
    var tourID: String
    var stopID: String
    /// outcome | arrived | note
    var type: String
    var outcomeCode: String?
    /// completes the stop locally (final outcome of kind success/failure)
    var completesStop: Bool
    var isSuccess: Bool
    /// JSON body sent as `meta`
    var meta: Data
    var photoPath: String?
    var signaturePath: String?
    var createdAt: Date
    var attempts: Int
    var lastError: String?
    var sentAt: Date?
    /// rejected by the server (validation) – shown to the driver, not retried
    var rejected: Bool

    init(clientID: String, tourID: String, stopID: String, type: String, outcomeCode: String?, completesStop: Bool,
         isSuccess: Bool, meta: Data, photoPath: String?, signaturePath: String?) {
        self.clientID = clientID
        self.tourID = tourID
        self.stopID = stopID
        self.type = type
        self.outcomeCode = outcomeCode
        self.completesStop = completesStop
        self.isSuccess = isSuccess
        self.meta = meta
        self.photoPath = photoPath
        self.signaturePath = signaturePath
        self.createdAt = .now
        self.attempts = 0
        self.rejected = false
    }
}

enum Persistence {
    static let schema = Schema([PendingEvent.self])

    static let container: ModelContainer = {
        do {
            let config = ModelConfiguration("VegaDelivery", schema: schema, isStoredInMemoryOnly: false)
            return try ModelContainer(for: schema, configurations: [config])
        } catch {
            fatalError("SwiftData container could not be created: \(error)")
        }
    }()

    static func inMemoryContainer() throws -> ModelContainer {
        try ModelContainer(for: schema, configurations: [ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)])
    }
}

/// Files for proofs of delivery (photos, signatures) until they were sent.
enum ProofFiles {
    static var directory: URL {
        let dir = URL.applicationSupportDirectory.appending(path: "Proofs", directoryHint: .isDirectory)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    static func save(_ data: Data, ext: String) -> String? {
        let name = "\(UUID().uuidString).\(ext)"
        do {
            try data.write(to: directory.appending(path: name), options: .atomic)
            return name
        } catch {
            return nil
        }
    }

    static func url(_ name: String?) -> URL? { name.map { directory.appending(path: $0) } }

    static func remove(_ name: String?) {
        if let url = url(name) { try? FileManager.default.removeItem(at: url) }
    }
}
