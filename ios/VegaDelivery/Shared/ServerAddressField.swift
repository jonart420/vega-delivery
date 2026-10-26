import SwiftUI

/// Server address input with warning and "Test connection".
struct ServerAddressField: View {
    @Environment(AppState.self) private var state
    @State private var result: (ok: Bool, message: String)?
    @State private var checking = false

    var body: some View {
        @Bindable var state = state
        VStack(alignment: .leading, spacing: 8) {
            TextField("https://delivery.example.com", text: $state.serverURLString)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("serverField")
                .onChange(of: state.serverURLString) { result = nil }
            if let warning = state.serverWarning {
                Label(warning, systemImage: "exclamationmark.triangle.fill")
                    .font(.caption).foregroundStyle(.orange)
            }
            HStack {
                Button(checking ? String(localized: "Checking …") : String(localized: "Test connection")) {
                    checking = true
                    Task {
                        result = await state.checkServer()
                        checking = false
                    }
                }
                .disabled(checking || state.api == nil)
                .accessibilityIdentifier("checkServerButton")
                if let result {
                    Image(systemName: result.ok ? "checkmark.circle.fill" : "xmark.octagon.fill")
                        .foregroundStyle(result.ok ? .green : .red)
                }
            }
            .font(.subheadline)
            if let result {
                Text(result.message).font(.caption).foregroundStyle(result.ok ? Color.secondary : Color.red)
            }
            Text("Normally set automatically by your login QR code.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
}

/// Server address from input: adds a scheme, public addresses always use https
/// (an http→https redirect would turn POST into GET).
enum ServerURL {
    static func normalized(_ input: String) -> URL? {
        var raw = input.trimmingCharacters(in: .whitespacesAndNewlines)
        while raw.hasSuffix("/") { raw.removeLast() }
        guard !raw.isEmpty else { return nil }
        if !raw.contains("://") { raw = "http://" + raw }
        guard var parts = URLComponents(string: raw), let scheme = parts.scheme?.lowercased(),
              scheme == "http" || scheme == "https", let host = parts.host, !host.isEmpty else { return nil }
        if scheme == "http", !isLocal(host) { parts.scheme = "https" }
        return parts.url
    }

    /// Local network/device: localhost, *.local, host name without dot, private IPv4
    static func isLocal(_ host: String) -> Bool {
        let h = host.lowercased()
        if ["localhost", "127.0.0.1", "::1"].contains(h) || h.hasSuffix(".local") || !h.contains(".") { return true }
        let octets = h.split(separator: ".").compactMap { Int($0) }
        guard octets.count == 4 else { return false }
        return octets[0] == 10 || octets[0] == 127 || (octets[0] == 192 && octets[1] == 168)
            || (octets[0] == 172 && (16...31).contains(octets[1])) || (octets[0] == 169 && octets[1] == 254)
    }
}
