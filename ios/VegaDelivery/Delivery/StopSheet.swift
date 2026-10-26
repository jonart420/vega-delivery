import CoreLocation
import SwiftUI

/// Everything about one stop: customer, address, orders, contact – and the outcome buttons
/// (delivered, refused …) configured in the back office.
struct StopSheet: View {
    let package: TourPackage
    let stop: TourStop
    let state: StopProgress.State
    /// tour is running (outcomes can be recorded)
    let canRecord: Bool
    /// called after an outcome was recorded (nil = closed without outcome)
    let onDone: (DeliveryOutcome?) -> Void

    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var outcome: DeliveryOutcome?
    @State private var notifyResult: String?
    @State private var showOrders = true
    @State private var recordAgain = false

    private var outcomes: [DeliveryOutcome] { (app.config?.outcomes ?? []).sorted { $0.sort < $1.sort } }

    var body: some View {
        NavigationStack {
            List {
                header
                contactSection
                ordersSection
                if canRecord { outcomeSection }
            }
            .navigationTitle(stop.position.map { String(localized: "Stop \($0)") } ?? String(localized: "Stop"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        onDone(nil)
                        dismiss()
                    }
                    .accessibilityIdentifier("closeStop")
                }
            }
            .navigationDestination(item: $outcome) { outcome in
                OutcomeForm(package: package, stop: stop, outcome: outcome) {
                    onDone(outcome)
                    dismiss()
                }
            }
        }
        .presentationDragIndicator(.visible)
    }

    private var header: some View {
        Section {
            VStack(alignment: .leading, spacing: 6) {
                Text(stop.name).font(.title3.bold())
                Text(stop.streetLine).font(.body)
                if let extra = stop.addressExtra, !extra.isEmpty { Text(extra).font(.subheadline) }
                Text("\(stop.zip) \(stop.city)").font(.body)
                HStack(spacing: 12) {
                    Label("#\(stop.customerNo)", systemImage: "number").font(.caption.monospaced())
                    if let eta = Format.time(stop.eta) { Label("ETA \(eta)", systemImage: "clock").font(.caption) }
                    if let w = stop.timeWindow { Label(w, systemImage: "timer").font(.caption) }
                }
                .foregroundStyle(.secondary)
            }
            if let notes = stop.deliveryNotes, !notes.isEmpty {
                Label(notes, systemImage: "exclamationmark.bubble.fill").font(.subheadline.weight(.medium)).foregroundStyle(.orange)
            }
            stateBadge
        }
    }

    @ViewBuilder
    private var stateBadge: some View {
        switch state {
        case let .delivered(code):
            Label(label(for: code) ?? String(localized: "Delivered"), systemImage: "checkmark.circle.fill").foregroundStyle(.green)
        case let .failed(code):
            Label(label(for: code) ?? String(localized: "Not delivered"), systemImage: "xmark.circle.fill").foregroundStyle(.red)
        case let .rejected(message):
            Label(message, systemImage: "exclamationmark.octagon.fill").foregroundStyle(.red)
        case .arrived, .open:
            EmptyView()
        }
    }

    private var contactSection: some View {
        Section {
            HStack(spacing: 10) {
                if let phone = stop.phone, let url = URL(string: "tel:\(phone.filter { "+0123456789".contains($0) })") {
                    actionButton("Call", "phone.fill") { openURL(url) }
                }
                if let wa = stop.whatsapp, let url = URL(string: "https://wa.me/\(wa.filter(\.isNumber))") {
                    actionButton("WhatsApp", "message.fill") { openURL(url) }
                }
                if let lat = stop.lat, let lon = stop.lon, let url = URL(string: "maps://?daddr=\(lat),\(lon)&dirflg=d") {
                    actionButton("Maps", "map.fill") { openURL(url) }
                }
                if canRecord {
                    actionButton("Notify", "bell.badge.fill") { Task { await notify() } }
                }
            }
            .buttonStyle(.borderless)
            if let notifyResult { Text(notifyResult).font(.caption).foregroundStyle(.secondary) }
        }
    }

    private func actionButton(_ title: LocalizedStringKey, _ symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: symbol).font(.title3)
                Text(title).font(.caption2)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
        }
    }

    private var ordersSection: some View {
        Section(isExpanded: $showOrders) {
            ForEach(stop.orders) { order in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text("Order \(order.orderNo)").font(.subheadline.weight(.semibold))
                        Spacer()
                        Text(order.deliveryEan13).font(.caption.monospaced()).foregroundStyle(.secondary)
                    }
                    ForEach(order.items) { item in
                        Text("\(item.quantityText) × \(item.nameSnapshot)").font(.subheadline)
                    }
                    if let notes = order.notes, !notes.isEmpty {
                        Text(notes).font(.caption).foregroundStyle(.orange)
                    }
                }
            }
        } header: {
            Text("Orders (\(stop.orders.count))")
        }
    }

    @ViewBuilder
    private var outcomeSection: some View {
        if state.isCompleted && !recordAgain {
            Section {
                Button("Record a different outcome") { recordAgain = true }
            }
        } else {
            Section("Outcome") {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    ForEach(outcomes) { o in
                        Button { outcome = o } label: {
                            VStack(spacing: 6) {
                                Image(systemName: o.symbol).font(.title2)
                                Text(o.label).font(.footnote.weight(.semibold)).multilineTextAlignment(.center)
                            }
                            .frame(maxWidth: .infinity, minHeight: 72)
                            .foregroundStyle(.white)
                            .background(color(o), in: RoundedRectangle(cornerRadius: 12))
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("outcome-\(o.code)")
                    }
                }
                .padding(.vertical, 4)
                if outcomes.isEmpty {
                    Text("No outcomes configured – pull to refresh the tour list.").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
    }

    private func color(_ o: DeliveryOutcome) -> Color {
        if let rgb = o.color?.hexRGB { return Color(red: rgb.0, green: rgb.1, blue: rgb.2) }
        return o.isSuccess ? .green : o.kind == "failure" ? .red : .gray
    }

    private func label(for code: String?) -> String? {
        guard let code else { return nil }
        return app.config?.outcomes.first { $0.code == code }?.label
    }

    private func notify() async {
        guard let api = app.api else { return }
        do {
            let n = try await api.notify(tourID: package.tour.id, stopID: stop.id)
            notifyResult = n > 0 ? String(localized: "Customer notified with the tracking link.")
                : String(localized: "The customer has no notification channel or already received this message.")
        } catch {
            notifyResult = error.localizedDescription
        }
    }
}

/// Form for one outcome: reason, recipient, proofs (photo, signature, barcode scan), note.
/// Required fields follow the outcome's settings from the back office.
struct OutcomeForm: View {
    let package: TourPackage
    let stop: TourStop
    let outcome: DeliveryOutcome
    let onSaved: () -> Void

    @Environment(AppState.self) private var app
    @State private var reason: DeliveryReason?
    @State private var reasonText = ""
    @State private var recipient = ""
    @State private var neighbor = ""
    @State private var note = ""
    @State private var photo: UIImage?
    @State private var signature: UIImage?
    @State private var scanned: [String] = []
    @State private var showCamera = false
    @State private var showSignature = false
    @State private var showScanner = false
    @State private var manualCode = ""
    @State private var error: String?

    private var scanAccept: String { app.config?.scanAccept ?? "any" }
    private var acceptedCodes: Set<String> { stop.acceptedCodes(scanAccept: scanAccept) }
    private var validScan: Bool { scanned.contains { acceptedCodes.contains(ScanCode.gtin($0)) } }

    private var missing: [String] {
        var out: [String] = []
        if outcome.requiresReason && reason == nil && reasonText.trimmingCharacters(in: .whitespaces).isEmpty { out.append(String(localized: "Reason")) }
        if outcome.requiresRecipient && recipient.trimmingCharacters(in: .whitespaces).isEmpty { out.append(String(localized: "Recipient")) }
        if outcome.requiresPhoto && photo == nil { out.append(String(localized: "Photo")) }
        if outcome.requiresSignature && signature == nil { out.append(String(localized: "Signature")) }
        if outcome.requiresScan && !validScan { out.append(String(localized: "Barcode scan")) }
        return out
    }

    var body: some View {
        Form {
            if !outcome.reasons.isEmpty || outcome.requiresReason {
                Section {
                    if !outcome.reasons.isEmpty {
                        Picker("Reason", selection: $reason) {
                            Text("Choose …").tag(DeliveryReason?.none)
                            ForEach(outcome.reasons) { r in Text(r.label).tag(Optional(r)) }
                        }
                        .accessibilityIdentifier("reasonPicker")
                    }
                    TextField("Details (optional)", text: $reasonText, axis: .vertical)
                } header: { requiredHeader("Reason", outcome.requiresReason) }
            }

            Section {
                TextField("Name of the recipient", text: $recipient)
                    .textContentType(.name)
                    .accessibilityIdentifier("recipientField")
                if outcome.code == "neighbor" || outcome.code == "safe_place" {
                    TextField(outcome.code == "neighbor" ? String(localized: "Neighbour (name, house no., floor)") : String(localized: "Safe place"), text: $neighbor)
                }
            } header: { requiredHeader("Recipient", outcome.requiresRecipient) }

            Section {
                Button { showCamera = true } label: {
                    Label(photo == nil ? String(localized: "Take photo") : String(localized: "Retake photo"), systemImage: "camera.fill")
                }
                if let photo {
                    Image(uiImage: photo).resizable().scaledToFit().frame(maxHeight: 180).clipShape(RoundedRectangle(cornerRadius: 8))
                }
            } header: { requiredHeader("Photo", outcome.requiresPhoto) }

            Section {
                Button { showSignature = true } label: {
                    Label(signature == nil ? String(localized: "Capture signature") : String(localized: "Sign again"), systemImage: "signature")
                }
                if let signature {
                    Image(uiImage: signature).resizable().scaledToFit().frame(maxHeight: 120)
                        .background(Color.white, in: RoundedRectangle(cornerRadius: 8))
                }
            } header: { requiredHeader("Signature", outcome.requiresSignature) }

            Section {
                Button { showScanner = true } label: { Label("Scan barcode", systemImage: "barcode.viewfinder") }
                    .accessibilityIdentifier("scanBarcode")
                HStack {
                    TextField("Type code", text: $manualCode).keyboardType(.numberPad)
                    Button("Add") { addScan(manualCode); manualCode = "" }.disabled(manualCode.count < 8)
                }
                ForEach(scanned, id: \.self) { code in
                    let ok = acceptedCodes.contains(ScanCode.gtin(code))
                    Label {
                        VStack(alignment: .leading) {
                            Text(ScanCode.gtin(code)).font(.body.monospaced())
                            if let name = ScanCode.compositeName(code) { Text(name).font(.caption) }
                        }
                    } icon: {
                        Image(systemName: ok ? "checkmark.circle.fill" : "questionmark.circle").foregroundStyle(ok ? .green : .orange)
                    }
                }
            } header: { requiredHeader("Barcode scan", outcome.requiresScan) } footer: {
                Text(scanHint)
            }

            Section("Note") {
                TextField("Note for the office (optional)", text: $note, axis: .vertical)
            }

            if let error { Text(error).foregroundStyle(.red) }

            Section {
                Button {
                    save()
                } label: {
                    Text(outcome.label).font(.headline).frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).controlSize(.large)
                .disabled(!missing.isEmpty)
                .accessibilityIdentifier("saveOutcome")
                if !missing.isEmpty {
                    Text("Missing: \(missing.joined(separator: ", "))").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle(outcome.label)
        .sheet(isPresented: $showCamera) {
            PhotoCapture { image in photo = image }
                .ignoresSafeArea()
        }
        .sheet(isPresented: $showSignature) {
            SignatureSheet(name: recipient) { image in signature = image }
        }
        .sheet(isPresented: $showScanner) {
            BarcodeScanSheet(accepted: acceptedCodes) { value in addScan(value) }
        }
    }

    private var scanHint: String {
        switch scanAccept {
        case "customer": String(localized: "Scan the customer barcode at the delivery point (customer no. \(stop.customerNo)).")
        case "delivery": String(localized: "Scan the delivery label of the order.")
        default: String(localized: "Scan the customer barcode (\(stop.customerNo)) or a delivery label.")
        }
    }

    private func requiredHeader(_ title: LocalizedStringKey, _ required: Bool) -> some View {
        HStack(spacing: 4) {
            Text(title)
            if required { Text("required").foregroundStyle(.red) }
        }
    }

    private func addScan(_ raw: String) {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, !scanned.contains(value) else { return }
        scanned.append(value)
    }

    private func save() {
        guard missing.isEmpty else { return }
        let photoName = photo.flatMap { ProofImages.jpeg($0) }.flatMap { ProofFiles.save($0, ext: "jpg") }
        let signatureName = signature.flatMap { $0.pngData() }.flatMap { ProofFiles.save($0, ext: "png") }
        if (photo != nil && photoName == nil) || (signature != nil && signatureName == nil) {
            error = String(localized: "Proof could not be saved on the device")
            return
        }
        let location = CLLocationManager().location
        let clientID = UUID().uuidString
        var meta: [String: Any] = [
            "client_id": clientID,
            "stop_id": stop.id,
            "type": "outcome",
            "outcome_code": outcome.code,
            "scanned_codes": scanned,
            "occurred_at": Format.isoParser.string(from: .now),
        ]
        if let reason { meta["reason_id"] = reason.id }
        func put(_ key: String, _ value: String) {
            let v = value.trimmingCharacters(in: .whitespacesAndNewlines)
            if !v.isEmpty { meta[key] = v }
        }
        put("reason_text", reasonText)
        put("recipient_name", recipient)
        put("neighbor_info", neighbor)
        put("note", note)
        if let location {
            meta["lat"] = location.coordinate.latitude
            meta["lon"] = location.coordinate.longitude
        }
        guard let data = try? JSONSerialization.data(withJSONObject: meta) else { return }
        Outbox.shared.enqueue(PendingEvent(
            clientID: clientID, tourID: package.tour.id, stopID: stop.id, type: "outcome", outcomeCode: outcome.code,
            completesStop: outcome.completesStop, isSuccess: outcome.isSuccess, meta: data,
            photoPath: photoName, signaturePath: signatureName
        ))
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        onSaved()
    }
}

/// Scanned values: EAN digits (composite "|(91)…" part and AIM prefix removed) and the decoded name.
enum ScanCode {
    static func gtin(_ raw: String) -> String {
        var s = raw
        if s.hasPrefix("]"), s.count > 3 { s = String(s.dropFirst(3)) }
        return String(s.split(separator: "|").first ?? "").filter(\.isNumber)
    }

    /// Name from the 2D part of the customer indicator: "(91)Herbert_M%C3%BCller" → "Herbert Müller"
    /// (scanners deliver the 2D part either bracketed or raw as "91…", with AIM prefix "]L2" / "]e0")
    static func compositeName(_ raw: String) -> String? {
        var payload: Substring
        if let r = raw.range(of: "(91)") {
            payload = raw[r.upperBound...]
        } else {
            var s = Substring(raw)
            if s.hasPrefix("]"), s.count > 3 { s = s.dropFirst(3) }
            s = s.drop { $0 == "\u{1d}" }
            guard s.hasPrefix("91"), s.count > 2 else { return nil }
            payload = s.dropFirst(2)
        }
        let encoded = payload.replacingOccurrences(of: "_", with: " ")
        return encoded.removingPercentEncoding ?? encoded
    }
}

enum ProofImages {
    /// JPEG, longest side max. 2000 px
    static func jpeg(_ image: UIImage) -> Data? {
        let maxSide: CGFloat = 2000
        let scale = min(1, maxSide / max(image.size.width, image.size.height))
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let resized = UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        return resized.jpegData(compressionQuality: 0.75)
    }
}
