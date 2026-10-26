import Foundation

/// Offline copy of the tour list, the tour packages and the app configuration
/// (JSON files in Application Support).
struct TourStore {
    private let dir: URL = {
        let d = URL.applicationSupportDirectory.appending(path: "Tours", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()

    func saveSummaries(_ list: [TourSummary]) {
        let enc = JSONEncoder()
        enc.keyEncodingStrategy = .convertToSnakeCase
        try? enc.encode(list).write(to: dir.appending(path: "list.json"), options: .atomic)
    }

    func cachedSummaries() -> [TourSummary] {
        guard let data = try? Data(contentsOf: dir.appending(path: "list.json")) else { return [] }
        return (try? APIClient.decoder.decode([TourSummary].self, from: data)) ?? []
    }

    func savePackage(_ data: Data, id: String) {
        try? data.write(to: dir.appending(path: "tour-\(id).json"), options: .atomic)
    }

    func cachedPackage(id: String) -> TourPackage? {
        guard let data = try? Data(contentsOf: dir.appending(path: "tour-\(id).json")) else { return nil }
        return try? APIClient.decoder.decode(TourPackage.self, from: data)
    }

    func isCached(id: String) -> Bool {
        FileManager.default.fileExists(atPath: dir.appending(path: "tour-\(id).json").path)
    }

    func saveConfig(_ data: Data) {
        try? data.write(to: dir.appending(path: "config.json"), options: .atomic)
    }

    func cachedConfig() -> AppConfig? {
        guard let data = try? Data(contentsOf: dir.appending(path: "config.json")) else { return nil }
        return try? APIClient.decoder.decode(AppConfig.self, from: data)
    }

    func clear() {
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }
}
