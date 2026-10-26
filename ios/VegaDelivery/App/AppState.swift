import Foundation
import Observation
import SwiftUI
import UIKit

/// Central state: server, sign-in, configuration, tours.
@MainActor
@Observable
final class AppState {
    private(set) var user: AppUser?
    private(set) var tours: [TourSummary] = []
    private(set) var config: AppConfig?
    var isLoading = false
    var errorMessage: String?
    /// Server unreachable – list comes from the offline copy
    private(set) var isOffline = false

    var serverURLString: String {
        didSet { UserDefaults.standard.set(serverURLString, forKey: Keys.server) }
    }

    private var token: String? {
        didSet { Keychain.set(token, for: Keys.token) }
    }

    let store = TourStore()

    private enum Keys {
        static let server = "serverURL"
        static let token = "deviceToken"
        static let user = "user"
    }

    init() {
        let fallback = Bundle.main.object(forInfoDictionaryKey: "VDDefaultServerURL") as? String ?? "http://localhost:3100"
        serverURLString = UserDefaults.standard.string(forKey: Keys.server) ?? fallback
        token = Keychain.get(Keys.token)
        if let data = UserDefaults.standard.data(forKey: Keys.user) {
            user = try? JSONDecoder().decode(AppUser.self, from: data)
        }
        tours = store.cachedSummaries()
        config = store.cachedConfig()
        Outbox.shared.start { [weak self] in self?.api }
    }

    static func isLocalhost(_ urlString: String) -> Bool {
        let host = URL(string: urlString.trimmingCharacters(in: .whitespaces))?.host() ?? ""
        return ["localhost", "127.0.0.1", "::1"].contains(host)
    }

    var serverWarning: String? {
        if api == nil { return String(localized: "Invalid address – example: https://delivery.example.com") }
        if !APIClient.isSimulator, Self.isLocalhost(serverURLString) {
            return String(localized: "\"localhost\" is the phone itself – enter the server address.")
        }
        return nil
    }

    func checkServer() async -> (ok: Bool, message: String) {
        guard let api else { return (false, String(localized: "Invalid address")) }
        do {
            try await api.health()
            return (true, String(localized: "Connected to \(api.baseURL.host() ?? "server")"))
        } catch {
            return (false, error.localizedDescription)
        }
    }

    var isLoggedIn: Bool { token != nil && user != nil }

    /// For Ferrostar (routing proxy)
    var deviceToken: String? { token }
    var baseURL: URL? { api?.baseURL }

    var api: APIClient? {
        guard let url = ServerURL.normalized(serverURLString) else { return nil }
        return APIClient(baseURL: url, token: token)
    }

    /// Accent colour from the server's branding (BRAND_COLOR)
    var accent: Color {
        guard let rgb = config?.brand.color.hexRGB else { return Color(red: 0.145, green: 0.388, blue: 0.922) }
        return Color(red: rgb.0, green: rgb.1, blue: rgb.2)
    }

    var brandName: String { config?.brand.name ?? "VEGA Delivery" }

    // MARK: - Sign-in

    /// Sign-in via QR code: the code contains the server URL
    func login(qr: LoginQR) async -> Bool {
        if let server = qr.server { serverURLString = server.absoluteString }
        return await login(code: qr.code)
    }

    func login(code: String) async -> Bool {
        guard let api else {
            errorMessage = String(localized: "Invalid server address")
            return false
        }
        isLoading = true
        defer { isLoading = false }
        do {
            let (newToken, newUser) = try await api.login(code: code, deviceName: UIDevice.current.name)
            token = newToken
            setUser(newUser)
            errorMessage = nil
            await refreshConfig()
            await refreshTours()
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func logout() async {
        await api?.logout()
        token = nil
        setUser(nil)
        tours = []
        config = nil
        store.clear()
        Outbox.shared.clearAll()
    }

    private func setUser(_ newUser: AppUser?) {
        user = newUser
        if let newUser, let data = try? JSONEncoder().encode(newUser) {
            UserDefaults.standard.set(data, forKey: Keys.user)
        } else {
            UserDefaults.standard.removeObject(forKey: Keys.user)
        }
    }

    private func handleUnauthorized(_ message: String) {
        token = nil
        setUser(nil)
        store.clear()
        tours = []
        errorMessage = message
    }

    // MARK: - Data

    func refreshConfig() async {
        guard let api, token != nil else { return }
        do {
            let (cfg, data) = try await api.config()
            config = cfg
            store.saveConfig(data)
        } catch APIError.unauthorized(let message) {
            handleUnauthorized(message)
        } catch {
            // keep the cached configuration
        }
    }

    /// Fetch the list; without network the cached list stays.
    func refreshTours() async {
        guard let api, token != nil else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let list = try await api.tours()
            tours = list
            store.saveSummaries(list)
            errorMessage = nil
            isOffline = false
        } catch APIError.unauthorized(let message) {
            handleUnauthorized(message)
        } catch APIError.network {
            isOffline = true
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /// Tour package (network preferred, otherwise the offline copy).
    func loadPackage(id: String) async throws -> (TourPackage, fromCache: Bool) {
        if let api, token != nil {
            do {
                let (pkg, data) = try await api.tourPackage(id: id)
                store.savePackage(data, id: id)
                return (pkg, false)
            } catch APIError.network {
                // offline → fallback below
            }
        }
        if let cached = store.cachedPackage(id: id) { return (cached, true) }
        throw APIError.network(String(localized: "Tour is not saved for offline use yet"))
    }

    func startTour(id: String) async throws {
        guard let api else { throw APIError.network(String(localized: "Invalid server address")) }
        _ = try await api.startTour(id: id)
        await refreshTours()
    }

    func finishTour(id: String) async throws {
        guard let api else { throw APIError.network(String(localized: "Invalid server address")) }
        await Outbox.shared.flush()
        _ = try await api.finishTour(id: id)
        PositionReporter.shared.stop()
        await refreshTours()
    }
}
