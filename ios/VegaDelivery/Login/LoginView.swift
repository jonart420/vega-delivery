import PhotosUI
import SwiftUI

struct LoginView: View {
    @Environment(AppState.self) private var state
    @State private var manualCode = ""
    @State private var showScanner = false
    @State private var scannerError: String?
    @State private var photoItem: PhotosPickerItem?
    @State private var showServer = false

    var body: some View {
        @Bindable var state = state
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(state.brandName).font(.largeTitle.bold())
                        Text("Sign in with your personal login code. Your dispatcher finds it in the back office under \"Team\".")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }

                    Button {
                        scannerError = nil
                        showScanner = true
                    } label: {
                        Label("Scan code", systemImage: "qrcode.viewfinder")
                            .frame(maxWidth: .infinity).padding(.vertical, 6)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .accessibilityIdentifier("scanButton")

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Or type the code").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                        TextField("XXXX-XXXX-XXXX-XXXX-XXXX", text: $manualCode)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .font(.system(.body, design: .monospaced))
                            .padding(12)
                            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
                            .accessibilityIdentifier("codeField")
                            .onSubmit { submitManual() }
                        if let hint = LoginCodeParser.inputHint(manualCode) {
                            Text(hint).font(.caption).foregroundStyle(.secondary)
                        }
                        Button("Sign in") { submitManual() }
                            .buttonStyle(.bordered)
                            .disabled(LoginCodeParser.normalize(manualCode) == nil || state.isLoading)
                            .accessibilityIdentifier("loginButton")
                    }

                    PhotosPicker(selection: $photoItem, matching: .images) {
                        Label("Read code from photo", systemImage: "photo")
                    }
                    .font(.subheadline)

                    if state.isLoading { ProgressView("Signing in …") }
                    if let message = scannerError ?? state.errorMessage {
                        Label(message, systemImage: "exclamationmark.triangle.fill")
                            .font(.subheadline).foregroundStyle(.orange)
                            .accessibilityIdentifier("loginError")
                    }

                    DisclosureGroup("Server", isExpanded: $showServer) {
                        ServerAddressField()
                            .padding(10)
                            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
                    }
                    .font(.subheadline)
                }
                .padding(24)
            }
            .sheet(isPresented: $showScanner) { scannerSheet }
            .onChange(of: photoItem) { _, item in readPhoto(item) }
        }
    }

    private var scannerSheet: some View {
        ZStack(alignment: .bottom) {
            CodeScannerView(
                types: [.qr],
                onValue: { value in
                    guard let qr = LoginCodeParser.login(fromQR: value) else { return false }
                    showScanner = false
                    Task { await state.login(qr: qr) }
                    return true
                },
                onError: { message in
                    showScanner = false
                    scannerError = message
                }
            )
            .ignoresSafeArea()
            RoundedRectangle(cornerRadius: 16)
                .stroke(state.accent, lineWidth: 3)
                .frame(width: 250, height: 250)
                .frame(maxHeight: .infinity)
                .allowsHitTesting(false)
            Text("Hold your login QR code inside the frame")
                .font(.callout.weight(.medium))
                .foregroundStyle(.white)
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(.black.opacity(0.7), in: Capsule())
                .padding(.bottom, 40)
        }
        .presentationDragIndicator(.visible)
    }

    private func submitManual() {
        guard let code = LoginCodeParser.normalize(manualCode) else { return }
        Task { await state.login(code: code) }
    }

    private func readPhoto(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task {
            defer { photoItem = nil }
            guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else {
                scannerError = String(localized: "Photo could not be loaded")
                return
            }
            if let qr = await StillImageCodeReader.read(image) {
                scannerError = nil
                await state.login(qr: qr)
            } else {
                scannerError = String(localized: "No login code found in the photo")
            }
        }
    }
}
