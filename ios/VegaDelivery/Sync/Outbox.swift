import Foundation
import Observation
import SwiftData

/// Sends stored delivery events to the server, oldest first, with retry when offline.
/// Validation errors (4xx) mark the event as rejected so the driver can see and redo it.
@MainActor
@Observable
final class Outbox {
    static let shared = Outbox()

    private(set) var pendingCount = 0
    private(set) var rejectedCount = 0
    private(set) var lastError: String?
    private var flushing = false
    @ObservationIgnored private var timer: Timer?
    @ObservationIgnored var apiProvider: (() -> APIClient?)?

    private var context: ModelContext { Persistence.container.mainContext }

    func start(api: @escaping () -> APIClient?) {
        apiProvider = api
        refreshCounts()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { _ in
            Task { @MainActor in await Outbox.shared.flush() }
        }
        Task { await flush() }
    }

    /// Stores an event and tries to send it right away.
    func enqueue(_ event: PendingEvent) {
        context.insert(event)
        try? context.save()
        refreshCounts()
        Task { await flush() }
    }

    func events(tourID: String) -> [PendingEvent] {
        let descriptor = FetchDescriptor<PendingEvent>(predicate: #Predicate { $0.tourID == tourID }, sortBy: [SortDescriptor(\.createdAt)])
        return (try? context.fetch(descriptor)) ?? []
    }

    func flush() async {
        guard !flushing, let api = apiProvider?() else { return }
        flushing = true
        defer {
            flushing = false
            refreshCounts()
        }
        let descriptor = FetchDescriptor<PendingEvent>(
            predicate: #Predicate { $0.sentAt == nil && !$0.rejected },
            sortBy: [SortDescriptor(\.createdAt)]
        )
        guard let pending = try? context.fetch(descriptor) else { return }
        for event in pending {
            do {
                try await api.postEvent(tourID: event.tourID, meta: event.meta,
                                        photo: ProofFiles.url(event.photoPath), signature: ProofFiles.url(event.signaturePath))
                event.sentAt = .now
                event.lastError = nil
                ProofFiles.remove(event.photoPath)
                ProofFiles.remove(event.signaturePath)
                lastError = nil
            } catch let error as APIError where error.isRejection {
                event.rejected = true
                event.lastError = error.localizedDescription
                lastError = error.localizedDescription
            } catch {
                event.attempts += 1
                event.lastError = error.localizedDescription
                lastError = error.localizedDescription
                try? context.save()
                return // offline or server down: keep order, retry later
            }
            try? context.save()
        }
    }

    /// Discards a rejected event (the stop becomes open again locally).
    func discard(_ event: PendingEvent) {
        ProofFiles.remove(event.photoPath)
        ProofFiles.remove(event.signaturePath)
        context.delete(event)
        try? context.save()
        refreshCounts()
    }

    func clearAll() {
        try? context.delete(model: PendingEvent.self)
        try? context.save()
        refreshCounts()
    }

    private func refreshCounts() {
        pendingCount = (try? context.fetchCount(FetchDescriptor<PendingEvent>(predicate: #Predicate { $0.sentAt == nil && !$0.rejected }))) ?? 0
        rejectedCount = (try? context.fetchCount(FetchDescriptor<PendingEvent>(predicate: #Predicate { $0.rejected }))) ?? 0
    }
}
