import Foundation

enum APIError: LocalizedError {
    case unauthorized(String)
    /// Server answered with an error. `status` 4xx = rejected (do not retry), 5xx = retry later.
    case server(String, status: Int, code: String?)
    case network(String)

    var errorDescription: String? {
        switch self {
        case .unauthorized(let m), .server(let m, _, _): m
        case .network(let m): String(localized: "Server unreachable: \(m)")
        }
    }

    /// The request will never succeed as sent (validation error, unknown stop …)
    var isRejection: Bool {
        if case let .server(_, status, _) = self { return (400..<500).contains(status) && status != 408 && status != 429 }
        return false
    }
}

/// Access to the delivery server (/api/app/…).
struct APIClient {
    let baseURL: URL
    var token: String?

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()

    func login(code: String, deviceName: String) async throws -> (token: String, user: AppUser) {
        struct Body: Encodable { let code: String; let device_name: String; let platform = "ios" }
        struct Response: Decodable { let token: String; let user: AppUser }
        let r: Response = try await request("api/app/login", method: "POST", json: Body(code: code, device_name: deviceName))
        return (r.token, r.user)
    }

    func logout() async {
        _ = try? await raw("api/app/logout", method: "POST")
    }

    func config() async throws -> (AppConfig, Data) {
        let data = try await raw("api/app/config")
        return (try decode(AppConfig.self, data), data)
    }

    func tours() async throws -> [TourSummary] {
        struct Response: Decodable { let tours: [TourSummary] }
        let r: Response = try await request("api/app/tours")
        return r.tours
    }

    func tourPackage(id: String) async throws -> (TourPackage, Data) {
        let data = try await raw("api/app/tours/\(id)")
        return (try decode(TourPackage.self, data), data)
    }

    func startTour(id: String) async throws -> String? {
        struct Response: Decodable { let status: String? }
        let r: Response = try await request("api/app/tours/\(id)/start", method: "POST", json: [String: String]())
        return r.status
    }

    func finishTour(id: String) async throws -> String? {
        struct Response: Decodable { let status: String? }
        let r: Response = try await request("api/app/tours/\(id)/finish", method: "POST", json: [String: String]())
        return r.status
    }

    func notify(tourID: String, stopID: String) async throws -> Int {
        struct Response: Decodable { let queued: Int }
        let r: Response = try await request("api/app/tours/\(tourID)/notify", method: "POST", json: ["stop_id": stopID])
        return r.queued
    }

    struct PositionPoint: Codable, Equatable {
        let t: String
        let lat: Double
        let lon: Double
        let acc: Double?
        let speed: Double?
        let heading: Double?
    }

    func postPositions(tourID: String, points: [PositionPoint]) async throws {
        struct Body: Encodable { let points: [PositionPoint] }
        _ = try await raw("api/app/tours/\(tourID)/position", method: "POST", body: try JSONEncoder().encode(Body(points: points)))
    }

    /// Delivery event; with files as multipart/form-data (`meta` + `photo` / `signature`).
    func postEvent(tourID: String, meta: Data, photo: URL?, signature: URL?) async throws {
        let path = "api/app/tours/\(tourID)/events"
        if photo == nil && signature == nil {
            _ = try await raw(path, method: "POST", body: meta)
            return
        }
        var form = MultipartForm()
        form.addField("meta", String(decoding: meta, as: UTF8.self))
        if let photo, let data = try? Data(contentsOf: photo) { form.addFile("photo", filename: photo.lastPathComponent, mime: "image/jpeg", data: data) }
        if let signature, let data = try? Data(contentsOf: signature) { form.addFile("signature", filename: signature.lastPathComponent, mime: "image/png", data: data) }
        _ = try await raw(path, method: "POST", body: form.finish(), contentType: form.contentType, timeout: 60)
    }

    func health() async throws {
        _ = try await raw("api/health")
    }

    // MARK: - internal

    /// Understandable message instead of "Could not connect to the server".
    static func networkHint(_ error: Error, host: String) -> String {
        let isLocalhost = ["localhost", "127.0.0.1", "::1"].contains(host)
        switch (error as? URLError)?.code {
        case .cannotConnectToHost?, .cannotFindHost?, .timedOut?, .dnsLookupFailed?, .networkConnectionLost?:
            if isLocalhost, !Self.isSimulator {
                return String(localized: "\"\(host)\" is the phone itself. Enter the server address under \"Server\".")
            }
            return String(localized: "\(host) does not answer.")
        case .notConnectedToInternet?:
            return String(localized: "No network connection.")
        case .appTransportSecurityRequiresSecureConnection?:
            return String(localized: "\(host) requires HTTPS.")
        default:
            return error.localizedDescription
        }
    }

    static var isSimulator: Bool {
        #if targetEnvironment(simulator)
        true
        #else
        false
        #endif
    }

    private func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do {
            return try Self.decoder.decode(T.self, from: data)
        } catch {
            #if DEBUG
            print("Decoding \(T.self) failed: \(error)")
            #endif
            throw APIError.server(String(localized: "Unexpected answer from the server"), status: 500, code: nil)
        }
    }

    private func request<T: Decodable, B: Encodable>(_ path: String, method: String, json: B) async throws -> T {
        try decode(T.self, try await raw(path, method: method, body: try JSONEncoder().encode(json)))
    }

    private func request<T: Decodable>(_ path: String) async throws -> T {
        try decode(T.self, try await raw(path))
    }

    @discardableResult
    private func raw(_ path: String, method: String = "GET", body: Data? = nil,
                     contentType: String = "application/json", timeout: TimeInterval = 20) async throws -> Data {
        var req = URLRequest(url: baseURL.appending(path: path), timeoutInterval: timeout)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        req.setValue(Locale.current.language.languageCode?.identifier ?? "en", forHTTPHeaderField: "Accept-Language")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue(contentType, forHTTPHeaderField: "Content-Type")
            req.httpBody = body
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw APIError.network(Self.networkHint(error, host: baseURL.host() ?? baseURL.absoluteString))
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let message = obj?["error"] as? String ?? String(localized: "Error \(status)")
            throw status == 401 ? APIError.unauthorized(message) : APIError.server(message, status: status, code: obj?["code"] as? String)
        }
        return data
    }
}

/// Minimal multipart/form-data builder.
struct MultipartForm {
    let boundary = "VegaDelivery-\(UUID().uuidString)"
    private var body = Data()

    var contentType: String { "multipart/form-data; boundary=\(boundary)" }

    mutating func addField(_ name: String, _ value: String) {
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n".utf8))
        body.append(Data(value.utf8))
        body.append(Data("\r\n".utf8))
    }

    mutating func addFile(_ name: String, filename: String, mime: String, data: Data) {
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\nContent-Type: \(mime)\r\n\r\n".utf8))
        body.append(data)
        body.append(Data("\r\n".utf8))
    }

    func finish() -> Data {
        var out = body
        out.append(Data("--\(boundary)--\r\n".utf8))
        return out
    }
}
