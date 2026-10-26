import SwiftUI

struct TourListView: View {
    @Environment(AppState.self) private var state
    @State private var showSettings = false
    private let outbox = Outbox.shared

    private var today: String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: .now)
    }

    private var running: [TourSummary] { state.tours.filter(\.isRunning) }
    private var todays: [TourSummary] { state.tours.filter { !$0.isRunning && !$0.isDone && $0.date <= today } }
    private var upcoming: [TourSummary] { state.tours.filter { !$0.isRunning && !$0.isDone && $0.date > today } }
    private var done: [TourSummary] { state.tours.filter(\.isDone).reversed() }

    var body: some View {
        NavigationStack {
            List {
                if state.isOffline {
                    Label("Offline – showing saved tours", systemImage: "wifi.slash").font(.footnote).foregroundStyle(.secondary)
                }
                if outbox.pendingCount > 0 || outbox.rejectedCount > 0 {
                    OutboxStatusRow()
                }
                if let error = state.errorMessage {
                    Label(error, systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(.orange)
                }
                section("On the road", running)
                section("Today", todays)
                section("Upcoming", upcoming)
                section("Finished", done)
                if state.tours.isEmpty && !state.isLoading {
                    ContentUnavailableView("No tours", systemImage: "shippingbox",
                                           description: Text("Released tours of your dispatcher appear here."))
                }
            }
            .navigationTitle("Tours")
            .navigationDestination(for: TourSummary.self) { TourDetailView(summary: $0) }
            .refreshable {
                await state.refreshConfig()
                await state.refreshTours()
                await outbox.flush()
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: { Image(systemName: "gearshape") }
                        .accessibilityLabel(Text("Settings"))
                }
            }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .task {
                await state.refreshConfig()
                await state.refreshTours()
            }
        }
    }

    @ViewBuilder
    private func section(_ title: LocalizedStringKey, _ list: [TourSummary]) -> some View {
        if !list.isEmpty {
            Section(title) {
                ForEach(list) { tour in
                    NavigationLink(value: tour) { TourRow(tour: tour) }
                }
            }
        }
    }
}

extension TourSummary: Hashable {
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

private struct TourRow: View {
    let tour: TourSummary
    @Environment(AppState.self) private var state

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: tour.mode.symbol).foregroundStyle(state.accent)
                Text(tour.title).font(.headline)
                Spacer()
                if tour.isRunning {
                    Text("Running").font(.caption.weight(.semibold)).padding(.horizontal, 8).padding(.vertical, 2)
                        .background(state.accent.opacity(0.15), in: Capsule()).foregroundStyle(state.accent)
                } else if tour.isDone {
                    Image(systemName: "checkmark.seal.fill").foregroundStyle(.green)
                }
            }
            HStack(spacing: 10) {
                if let d = Format.date(tour.date) { Text(d) }
                if let start = tour.plannedStart { Text(start) }
                Text("\(tour.completedCount)/\(tour.stopCount) stops")
                if let km = tour.distanceKm { Text(Format.distance(km)) }
            }
            .font(.caption).foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}

/// Events waiting for the network, or rejected by the server.
struct OutboxStatusRow: View {
    private let outbox = Outbox.shared

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if outbox.pendingCount > 0 {
                Label("\(outbox.pendingCount) deliveries waiting to be sent", systemImage: "arrow.up.circle")
                    .foregroundStyle(.orange)
            }
            if outbox.rejectedCount > 0 {
                Label("\(outbox.rejectedCount) deliveries rejected – open the tour", systemImage: "exclamationmark.octagon.fill")
                    .foregroundStyle(.red)
            }
            if let error = outbox.lastError { Text(error).font(.caption2).foregroundStyle(.secondary) }
        }
        .font(.footnote)
    }
}
