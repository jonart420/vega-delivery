import CoreLocation
import FerrostarCore
import FerrostarMapLibreUI
import FerrostarSwiftUI
import MapLibre
import MapLibreSwiftDSL
import MapLibreSwiftUI
import SwiftUI

/// Full-screen navigation through a delivery tour.
struct TourNavigationView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var app
    @State var model: TourNavigationModel
    @State private var confirmExit = false
    @State private var detailStop: TourStop?

    var body: some View {
        DynamicallyOrientingNavigationView(
            styleURL: model.styleURL,
            camera: $model.camera,
            navigationCamera: model.package.tour.mode == .auto ? .automotiveNavigation(zoom: 16, pitch: 45) : .bicycleNavigation(zoom: 16.5, pitch: 30),
            navigationState: model.navState,
            isMuted: model.isMuted,
            onTapMute: { model.toggleMute() },
            onTapExit: { confirmExit = true },
            makeMapContent: { stopLayers }
        )
        .unsafeMapViewControllerModifier { controller in
            controller.mapView.showsUserLocation = !model.isSimulated || model.navState?.isNavigating == true
        }
        .navigationViewInnerGrid(topCenter: { EmptyView() })
        .overlay(alignment: .top) {
            Group {
                if let remaining = model.wrongWayRemaining {
                    InfoBanner(text: String(localized: "Please turn around · \(Format.distance(remaining / 1000)) left"), systemImage: "arrow.uturn.down")
                } else if let message = model.errorMessage {
                    InfoBanner(text: message, systemImage: message.hasPrefix("Offline") ? "wifi.slash" : "exclamationmark.triangle.fill")
                        .onTapGesture { model.errorMessage = nil }
                } else if model.phase == .loadingRoute {
                    InfoBanner(text: String(localized: "Calculating route …"), systemImage: "hourglass")
                }
            }
            .padding(.top, model.navState?.isNavigating == true ? 150 : 8)
        }
        .safeAreaInset(edge: .bottom) {
            if model.navState?.isNavigating != true { nextStopCard }
        }
        .overlay(alignment: .bottomLeading) {
            if model.navState?.isNavigating == true { navigatingControls }
        }
        .overlay(alignment: .topLeading) {
            if model.navState?.isNavigating != true {
                Button { confirmExit = true } label: {
                    Label("Back", systemImage: "chevron.left")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(.regularMaterial, in: Capsule())
                }
                .padding(.leading, 12)
                .padding(.top, 4)
                .accessibilityIdentifier("navBack")
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            model.stop()
        }
        .confirmationDialog("Leave navigation?", isPresented: $confirmExit, titleVisibility: .visible) {
            Button("Leave navigation") {
                model.autosave()
                dismiss()
            }
            Button("Continue navigating", role: .cancel) {}
        } message: {
            Text("The tour keeps running and the next stop is remembered. Recorded deliveries are saved.")
        }
        .sheet(item: arrivedStopBinding) { stop in
            StopSheet(package: model.package, stop: stop, state: .arrived, canRecord: model.package.tour.status == "in_progress") { outcome in
                if let outcome, outcome.completesStop {
                    model.markHandled(stop.id)
                    Task { await model.navigateToNext() }
                } else if model.dismissArrival() {
                    Task { await model.navigateToNext() }
                }
            }
            .interactiveDismissDisabled()
        }
        .sheet(item: $detailStop) { stop in
            StopSheet(package: model.package, stop: stop, state: model.handled.contains(stop.id) ? .delivered(outcome: nil) : .open,
                      canRecord: model.package.tour.status == "in_progress") { outcome in
                if let outcome, outcome.completesStop {
                    model.markHandled(stop.id)
                    if stop.id == model.nextStop?.id || model.phase != .navigating { Task { await model.navigateToNext() } }
                }
            }
        }
    }

    // MARK: - Map

    private static let accent = UIColor(red: 0.145, green: 0.388, blue: 0.922, alpha: 1)

    @MapViewContentBuilder
    private var stopLayers: [StyleLayerDefinition] {
        let open = model.order.filter { !model.handled.contains($0) }.compactMap { model.stopsByID[$0] }.filter(\.hasCoordinate)
        let done = model.package.stops.filter { model.handled.contains($0.id) && $0.hasCoordinate }
        let next = model.nextStop

        let planned = (model.package.tour.route?.geometry ?? []).compactMap { p -> CLLocationCoordinate2D? in
            p.count >= 2 ? CLLocationCoordinate2D(latitude: p[1], longitude: p[0]) : nil
        }
        let plannedSource = ShapeSource(identifier: "planned-route") {
            if planned.count > 1 { MLNPolylineFeature(coordinates: planned) }
        }
        LineStyleLayer(identifier: "planned-route-line", source: plannedSource)
            .lineCap(.round).lineJoin(.round)
            .lineColor(Self.accent).lineOpacity(0.35).lineWidth(5)

        let openSource = ShapeSource(identifier: "open-stops") {
            for stop in open where stop.id != next?.id {
                MLNPointFeature(coordinate: CLLocationCoordinate2D(latitude: stop.lat!, longitude: stop.lon!))
            }
        }
        CircleStyleLayer(identifier: "open-stops-layer", source: openSource)
            .radius(9).color(.darkGray).strokeWidth(2).strokeColor(.white)

        let doneSource = ShapeSource(identifier: "done-stops") {
            for stop in done { MLNPointFeature(coordinate: CLLocationCoordinate2D(latitude: stop.lat!, longitude: stop.lon!)) }
        }
        CircleStyleLayer(identifier: "done-stops-layer", source: doneSource)
            .radius(6).color(.systemGreen).strokeWidth(1).strokeColor(.white)

        let nextSource = ShapeSource(identifier: "next-stop") {
            if let next, let lat = next.lat, let lon = next.lon { MLNPointFeature(coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lon)) }
        }
        CircleStyleLayer(identifier: "next-stop-layer", source: nextSource)
            .radius(13).color(Self.accent).strokeWidth(3).strokeColor(.white)
    }

    // MARK: - Controls

    private var nextStopCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let stop = model.nextStop {
                HStack(alignment: .firstTextBaseline) {
                    Text("Next stop").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Text("\(model.remainingCount) open").font(.caption).foregroundStyle(.secondary)
                }
                Button { detailStop = stop } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(stop.name).font(.title3.bold())
                        Text(stop.addressLine).font(.subheadline)
                        if let notes = stop.deliveryNotes, !notes.isEmpty {
                            Label(notes, systemImage: "exclamationmark.bubble").font(.caption).foregroundStyle(.orange)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                Button {
                    Task { await model.navigateToNext() }
                } label: {
                    Label(model.phase == .loadingRoute ? String(localized: "Calculating route …") : String(localized: "Drive"),
                          systemImage: "location.north.line.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).controlSize(.large)
                .disabled(model.phase == .loadingRoute)
                .accessibilityIdentifier("startLeg")
                HStack {
                    Button("I'm here") { model.arriveManually() }
                    Spacer()
                    Button("Later") { model.postponeNext() }
                    Spacer()
                    Button("Re-optimize") { Task { await model.reoptimizeAndContinue() } }
                }
                .font(.subheadline)
                if !model.stopsWithoutCoordinate.isEmpty {
                    Text("\(model.stopsWithoutCoordinate.count) stops without coordinates – open them in the tour list.")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            } else {
                Label("All stops done", systemImage: "checkmark.seal.fill").font(.title3.bold()).foregroundStyle(.green)
                Text("Go back and finish the tour.").font(.subheadline).foregroundStyle(.secondary)
                Button {
                    TourSessionStore.clear(tourID: model.package.tour.id)
                    dismiss()
                } label: {
                    Label("Back to tour", systemImage: "flag.checkered").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).controlSize(.large)
            }
        }
        .padding(16)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
    }

    private var navigatingControls: some View {
        VStack(spacing: 8) {
            NavigationUIButton { model.arriveManually() } label: {
                Image(systemName: "mappin.and.ellipse").accessibilityLabel(Text("I'm here"))
            }
            NavigationUIButton { if let s = model.nextStop { detailStop = s } } label: {
                Image(systemName: "list.bullet.rectangle").accessibilityLabel(Text("Stop details"))
            }
            NavigationUIButton { model.postponeNext() } label: {
                Image(systemName: "arrow.uturn.forward").accessibilityLabel(Text("Later"))
            }
            NavigationUIButton { Task { await model.reoptimizeAndContinue() } } label: {
                Image(systemName: "arrow.triangle.2.circlepath").accessibilityLabel(Text("Re-optimize"))
            }
        }
        .padding(.leading, 16)
        .padding(.bottom, 100)
    }

    private var arrivedStopBinding: Binding<TourStop?> {
        Binding(
            get: {
                if case let .arrived(id) = model.phase { return model.stopsByID[id] }
                return nil
            },
            // Only the sheet's own buttons end the arrival: SwiftUI also sets the binding to nil
            // when Ferrostar rebuilds the map view on arrival.
            set: { _ in }
        )
    }
}

/// Small hint capsule over the map (offline, turn around …)
private struct InfoBanner: View {
    let text: String
    let systemImage: String

    var body: some View {
        Label(text, systemImage: systemImage)
            .font(.caption.weight(.medium))
            .lineLimit(1)
            .foregroundStyle(.white.opacity(0.9))
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(.black.opacity(0.55), in: Capsule())
    }
}
