import MapKit
import SwiftData
import SwiftUI

struct TourDetailView: View {
    let summary: TourSummary
    @Environment(AppState.self) private var state
    @Query private var events: [PendingEvent]
    @State private var package: TourPackage?
    @State private var fromCache = false
    @State private var error: String?
    @State private var busy = false
    @State private var navigation: TourNavigationModel?
    @State private var openStop: TourStop?
    @State private var offline: (cached: Int, total: Int)?
    @State private var confirmFinish = false
    @State private var status: String

    init(summary: TourSummary) {
        self.summary = summary
        _status = State(initialValue: summary.status)
        let tid = summary.id
        _events = Query(filter: #Predicate<PendingEvent> { $0.tourID == tid }, sort: \PendingEvent.createdAt)
    }

    private var states: [String: StopProgress.State] {
        package.map { StopProgress.states($0, events: events) } ?? [:]
    }

    private var openCount: Int { states.values.filter { !$0.isCompleted }.count }

    var body: some View {
        List {
            if let package {
                Section {
                    TourMapPreview(package: package, states: states) { openStop = $0 }
                    infoRows(package)
                    actions(package)
                }
                if let error { Label(error, systemImage: "exclamationmark.triangle.fill").foregroundStyle(.orange).font(.footnote) }
                if events.contains(where: \.rejected) { rejectedSection }
                Section("Stops") {
                    ForEach(package.stops) { stop in
                        Button { openStop = stop } label: { StopRow(stop: stop, state: states[stop.id] ?? .open) }
                            .buttonStyle(.plain)
                    }
                }
            } else if let error {
                ContentUnavailableView("Tour not available", systemImage: "wifi.slash", description: Text(error))
            } else {
                ProgressView()
            }
        }
        .navigationTitle(summary.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $openStop) { stop in
            if let package {
                StopSheet(package: package, stop: stop, state: states[stop.id] ?? .open, canRecord: status == "in_progress") { _ in
                    openStop = nil
                }
            }
        }
        .fullScreenCover(item: $navigation) { model in
            TourNavigationView(model: model)
        }
        .confirmationDialog("Finish tour?", isPresented: $confirmFinish, titleVisibility: .visible) {
            Button("Finish tour", role: .destructive) { Task { await finish() } }
        } message: {
            Text(openCount > 0
                 ? String(localized: "\(openCount) stops are still open. They count as not delivered.")
                 : String(localized: "All stops are done."))
        }
    }

    @ViewBuilder
    private func infoRows(_ package: TourPackage) -> some View {
        HStack(spacing: 14) {
            Label(package.tour.mode.label, systemImage: package.tour.mode.symbol)
            if let d = Format.date(package.tour.date) { Text(d) }
            if let start = package.tour.plannedStart { Label(start, systemImage: "clock") }
        }
        .font(.footnote).foregroundStyle(.secondary)
        HStack(spacing: 14) {
            Text("\(package.stops.count - openCount)/\(package.stops.count) stops done")
            if let r = package.tour.route {
                Text(Format.distance(r.distanceKm))
                Text(Format.duration(r.durationS))
            }
        }
        .font(.footnote)
        if let vehicle = package.tour.vehicle { Label(vehicle, systemImage: "box.truck").font(.footnote) }
        if fromCache { Label("Offline copy", systemImage: "internaldrive").font(.caption).foregroundStyle(.secondary) }
        if let offline, offline.total > 0 {
            Label(offline.cached == offline.total ? String(localized: "Routes saved for offline use")
                  : String(localized: "Offline routes: \(offline.cached)/\(offline.total)"),
                  systemImage: offline.cached == offline.total ? "checkmark.icloud" : "icloud.and.arrow.down")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func actions(_ package: TourPackage) -> some View {
        switch status {
        case "released":
            Button {
                Task { await start(package) }
            } label: {
                Label(busy ? String(localized: "Starting …") : String(localized: "Start tour"), systemImage: "play.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent).controlSize(.large).disabled(busy)
            .accessibilityIdentifier("startTour")
            Text("Starting the tour notifies your customers and activates live tracking for the next \(state.config?.notifyLeadStops ?? 3) stops.")
                .font(.caption).foregroundStyle(.secondary)
        case "in_progress":
            Button {
                openNavigation(package)
            } label: {
                Label(openCount > 0 ? String(localized: "Navigate") : String(localized: "Show map"), systemImage: "location.north.line.fill").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent).controlSize(.large)
            .accessibilityIdentifier("navigate")
            Button(role: openCount > 0 ? .destructive : nil) { confirmFinish = true } label: {
                Label("Finish tour", systemImage: "flag.checkered").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered).disabled(busy)
        default:
            Label("Tour finished", systemImage: "checkmark.seal.fill").foregroundStyle(.green)
        }
    }

    private var rejectedSection: some View {
        Section {
            ForEach(events.filter(\.rejected)) { e in
                VStack(alignment: .leading, spacing: 4) {
                    Text(package?.stops.first { $0.id == e.stopID }?.name ?? e.stopID).font(.subheadline.weight(.semibold))
                    Text(e.lastError ?? "").font(.caption).foregroundStyle(.red)
                    Button("Discard and record again") { Outbox.shared.discard(e) }.font(.caption)
                }
            }
        } header: { Text("Rejected by the server") }
    }

    private func load() async {
        do {
            let (pkg, cached) = try await state.loadPackage(id: summary.id)
            package = pkg
            fromCache = cached
            status = pkg.tour.status
            error = nil
            if let base = state.baseURL, pkg.tour.status != "done" {
                offline = OfflineRoutes.status(pkg)
                offline = await OfflineRoutes.prefetch(pkg, baseURL: base, token: state.deviceToken)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func start(_ package: TourPackage) async {
        busy = true
        defer { busy = false }
        do {
            try await state.startTour(id: package.tour.id)
            await load()
            if let pkg = self.package { openNavigation(pkg) }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func finish() async {
        busy = true
        defer { busy = false }
        do {
            try await state.finishTour(id: summary.id)
            TourSessionStore.clear(tourID: summary.id)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func openNavigation(_ package: TourPackage) {
        guard let base = state.baseURL else { return }
        let session = TourSessionStore.load(tourID: package.tour.id)
        do {
            navigation = try TourNavigationModel(
                package: package,
                baseURL: base,
                token: state.deviceToken,
                completed: StopProgress.completedIDs(package, events: events),
                scanAccept: state.config?.scanAccept ?? "any",
                styleURL: state.config.flatMap { URL(string: $0.map.styleUrl) },
                resumeOrder: session?.order,
                apiProvider: { [weak state] in state?.api }
            )
        } catch {
            self.error = error.localizedDescription
        }
    }
}

private struct StopRow: View {
    let stop: TourStop
    let state: StopProgress.State

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle().fill(color).frame(width: 28, height: 28)
                if case .delivered = state {
                    Image(systemName: "checkmark").font(.caption.bold()).foregroundStyle(.white)
                } else if case .failed = state {
                    Image(systemName: "xmark").font(.caption.bold()).foregroundStyle(.white)
                } else {
                    Text(stop.position.map(String.init) ?? "•").font(.caption.bold().monospacedDigit()).foregroundStyle(.white)
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(stop.name).font(.subheadline.weight(.semibold))
                Text(stop.addressLine).font(.caption).foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    if let eta = Format.time(stop.eta) { Label(eta, systemImage: "clock") }
                    if let w = stop.timeWindow { Label(w, systemImage: "timer") }
                    Text("\(stop.orders.count) orders")
                }
                .font(.caption2).foregroundStyle(.secondary)
                if case let .rejected(message) = state {
                    Text(message).font(.caption2).foregroundStyle(.red)
                }
            }
            Spacer()
        }
        .contentShape(Rectangle())
    }

    private var color: Color {
        switch state {
        case .open: .gray
        case .arrived: .orange
        case .delivered: .green
        case .failed, .rejected: .red
        }
    }
}

/// Map preview in the tour detail: planned route, numbered stops, depot (Apple Maps, no tiles needed).
struct TourMapPreview: View {
    let package: TourPackage
    let states: [String: StopProgress.State]
    let open: (TourStop) -> Void

    private var line: [CLLocationCoordinate2D] {
        (package.tour.route?.geometry ?? []).compactMap { $0.count >= 2 ? CLLocationCoordinate2D(latitude: $0[1], longitude: $0[0]) : nil }
    }

    private var bounds: MapCameraPosition {
        let pts = line + package.stops.compactMap { s in s.lat.map { CLLocationCoordinate2D(latitude: $0, longitude: s.lon ?? 0) } }
        let lats = pts.map(\.latitude), lons = pts.map(\.longitude)
        guard let minLat = lats.min(), let maxLat = lats.max(), let minLon = lons.min(), let maxLon = lons.max() else { return .automatic }
        let center = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2)
        let span = MKCoordinateSpan(latitudeDelta: max(0.005, (maxLat - minLat) * 1.3), longitudeDelta: max(0.005, (maxLon - minLon) * 1.3))
        return .region(MKCoordinateRegion(center: center, span: span))
    }

    var body: some View {
        Map(initialPosition: bounds) {
            if line.count > 1 {
                MapPolyline(coordinates: line).stroke(.white, lineWidth: 7)
                MapPolyline(coordinates: line).stroke(.tint, lineWidth: 4)
            }
            if let start = package.tour.start {
                Annotation("Depot", coordinate: CLLocationCoordinate2D(latitude: start.lat, longitude: start.lon)) {
                    Image(systemName: "house.fill").font(.caption.bold()).padding(5)
                        .background(.black, in: RoundedRectangle(cornerRadius: 6)).foregroundStyle(.white)
                }
                .annotationTitles(.hidden)
            }
            ForEach(package.stops.filter(\.hasCoordinate)) { stop in
                Annotation(stop.name, coordinate: CLLocationCoordinate2D(latitude: stop.lat!, longitude: stop.lon!)) {
                    Button { open(stop) } label: {
                        Text(stop.position.map(String.init) ?? "•").font(.caption.bold().monospacedDigit())
                            .frame(width: 24, height: 24)
                            .background(color(states[stop.id]), in: Circle())
                            .overlay(Circle().stroke(.white, lineWidth: 1.5))
                            .foregroundStyle(.white)
                    }
                }
                .annotationTitles(.hidden)
            }
            UserAnnotation()
        }
        .mapStyle(.standard(pointsOfInterest: .excludingAll))
        .frame(height: 240)
        .listRowInsets(EdgeInsets())
    }

    private func color(_ s: StopProgress.State?) -> Color {
        switch s {
        case .delivered?: .green
        case .failed?, .rejected?: .red
        case .arrived?: .orange
        default: .accentColor
        }
    }
}
