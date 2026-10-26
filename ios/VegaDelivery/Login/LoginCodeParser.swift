import Foundation
import Vision

/// Content of a login QR code: login code and the server it belongs to.
struct LoginQR: Equatable {
    let code: String
    /// Server base URL from the QR code (format v3); nil = use the server set in the app
    let server: URL?
}

/// Login code from QR content or typed input.
///
/// QR format v3 (see docs/APP-API.md):
///   vegadelivery://login?v=3&s=<server base URL, URL-encoded>&c=<20 characters Crockford Base32>
/// Typed codes may contain dashes/spaces; I/L are read as 1 and O as 0.
enum LoginCodeParser {
    static let codeLength = 20
    static let scheme = "vegadelivery://login"
    private static let crockford = Set("0123456789ABCDEFGHJKMNPQRSTVWXYZ")

    /// QR content → code + server, otherwise nil (foreign QR codes are ignored)
    static func login(fromQR payload: String?) -> LoginQR? {
        guard let payload = payload?.trimmingCharacters(in: .whitespacesAndNewlines),
              payload.lowercased().hasPrefix(scheme),
              let comps = URLComponents(string: payload) else { return nil }
        let items = comps.queryItems ?? []
        guard let code = normalize(items.first { $0.name == "c" }?.value ?? "") else { return nil }
        let server = (items.first { $0.name == "s" }?.value).flatMap { ServerURL.normalized($0) }
        return LoginQR(code: code, server: server)
    }

    /// Tolerant normalization of a typed code; nil when it cannot be a valid code
    static func normalize(_ input: String) -> String? {
        let s = input.uppercased()
            .replacingOccurrences(of: "[\\s\\-_]", with: "", options: .regularExpression)
            .replacingOccurrences(of: "I", with: "1")
            .replacingOccurrences(of: "L", with: "1")
            .replacingOccurrences(of: "O", with: "0")
        guard s.count == codeLength, s.allSatisfy(crockford.contains) else { return nil }
        return s
    }

    /// Hint below the input field while typing
    static func inputHint(_ input: String) -> String? {
        let n = input.uppercased().filter { !" -_".contains($0) }.count
        guard n > 0, normalize(input) == nil else { return nil }
        return n < codeLength
            ? String(localized: "\(codeLength - n) characters missing")
            : String(localized: "Invalid code")
    }

    static func makeRequest() -> VNDetectBarcodesRequest {
        let request = VNDetectBarcodesRequest()
        request.symbologies = [.qr]
        return request
    }
}
