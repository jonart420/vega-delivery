import AVFoundation
import CoreLocation
import FerrostarCore
import Foundation

/// Voice instructions with the best installed voice for the device language (enhanced/premium
/// voices are free and work offline).
final class NavigationSpeechSynthesizer: NSObject, SpeechSynthesizer, AVSpeechSynthesizerDelegate {
    private let synthesizer = AVSpeechSynthesizer()

    override init() {
        super.init()
        synthesizer.delegate = self
        // Instructions also with locked screen / in background (UIBackgroundModes: audio);
        // music and podcasts are only ducked or briefly interrupted
        try? AVAudioSession.sharedInstance().setCategory(
            .playback, mode: .voicePrompt, options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers]
        )
    }

    /// BCP-47 language of the voice instructions (matches the language requested from Valhalla)
    static var language: String { NavigationLanguage.current == "de" ? "de-DE" : AVSpeechSynthesisVoice.currentLanguageCode() }

    static var preferredVoice: AVSpeechSynthesisVoice? {
        let lang = language
        let prefix = String(lang.prefix(2))
        // Novelty voices (e.g. "Trinoids") are not suitable for instructions
        let voices = AVSpeechSynthesisVoice.speechVoices().filter { !$0.voiceTraits.contains(.isNoveltyVoice) }
        let candidates = voices.filter { $0.language == lang }
        let pool = candidates.isEmpty ? voices.filter { $0.language.hasPrefix(prefix) } : candidates
        let bestQuality = pool.map(\.quality.rawValue).max()
        // Among equal quality prefer the system default voice for the language
        let system = AVSpeechSynthesisVoice(language: lang)
        return pool.first { $0.quality.rawValue == bestQuality && $0.identifier == system?.identifier }
            ?? pool.first { $0.quality.rawValue == bestQuality }
            ?? system
    }

    private let voice = NavigationSpeechSynthesizer.preferredVoice

    var isSpeaking: Bool { synthesizer.isSpeaking }

    func speak(_ utterance: AVSpeechUtterance) {
        // Valhalla appends the next close turn ("Turn right. Then turn left."). The banner shows only
        // "right" – the ear keeps "left". The next turn is announced again at its maneuver anyway.
        let text = Self.withoutFollowUp(utterance.speechString)
        let utterance = text == utterance.speechString ? utterance : AVSpeechUtterance(string: text)
        utterance.voice = voice
        try? AVAudioSession.sharedInstance().setActive(true)
        synthesizer.speak(utterance)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        if !synthesizer.isSpeaking {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }

    /// "X. Then Y." / "X. Dann Y." → "X."
    static func withoutFollowUp(_ text: String) -> String {
        guard let r = text.range(of: #"\.\s+(Dann|Then)\b"#, options: .regularExpression) else { return text }
        return String(text[..<r.lowerBound]) + "."
    }

    @discardableResult
    func stopSpeaking(at boundary: AVSpeechBoundary) -> Bool {
        synthesizer.stopSpeaking(at: boundary)
    }

    /// Own announcement ("Destination reached: …"), same voice
    func say(_ text: String) {
        speak(AVSpeechUtterance(string: text))
    }
}

/// Language for navigation instructions: German devices get German, everything else English.
enum NavigationLanguage {
    static var current: String { Locale.current.language.languageCode?.identifier == "de" ? "de" : "en" }
    /// Valhalla `directions_options.language`
    static var valhalla: String { current == "de" ? "de-DE" : "en-US" }
}

/// Network for Ferrostar: adds the device token to every routing request
/// (Valhalla is only reachable through the server's proxy).
struct AuthorizedSession: URLRequestLoading {
    let token: String?

    func loadData(with urlRequest: URLRequest) async throws -> (Data, URLResponse) {
        var request = urlRequest
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        request.timeoutInterval = 25
        return try await URLSession.shared.data(for: request)
    }
}

/// Small route planning on the device ("re-optimize from here"), also offline:
/// straight line × detour factor, exact up to 9 stops, above nearest neighbour + swaps.
enum LocalReorder {
    static let detourFactor = 1.3

    static func distance(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        CLLocation(latitude: a.latitude, longitude: a.longitude)
            .distance(from: CLLocation(latitude: b.latitude, longitude: b.longitude)) * detourFactor
    }

    /// Order of `points` from `from` to `end` (indices into `points`).
    static func order(from: CLLocationCoordinate2D, points: [CLLocationCoordinate2D], end: CLLocationCoordinate2D) -> [Int] {
        let n = points.count
        guard n > 1 else { return Array(0..<n) }
        func cost(_ order: [Int]) -> Double {
            var sum = 0.0
            var prev = from
            for i in order {
                sum += distance(prev, points[i])
                prev = points[i]
            }
            return sum + distance(prev, end)
        }
        if n <= 9 {
            var best = Array(0..<n)
            var bestCost = cost(best)
            permute(Array(0..<n), 0) { candidate in
                let c = cost(candidate)
                if c < bestCost { bestCost = c; best = candidate }
            }
            return best
        }
        // Nearest neighbour …
        var remaining = Set(0..<n)
        var order: [Int] = []
        var prev = from
        while let next = remaining.min(by: { distance(prev, points[$0]) < distance(prev, points[$1]) }) {
            order.append(next)
            remaining.remove(next)
            prev = points[next]
        }
        // … then swap pairs while it gets shorter
        var current = cost(order)
        var improved = true
        while improved {
            improved = false
            for a in 0..<n {
                for b in (a + 1)..<n {
                    order.swapAt(a, b)
                    let c = cost(order)
                    if c + 0.001 < current { current = c; improved = true } else { order.swapAt(a, b) }
                }
            }
        }
        return order
    }

    private static func permute(_ a: [Int], _ k: Int, _ visit: ([Int]) -> Void) {
        var a = a
        if k == a.count { visit(a); return }
        for i in k..<a.count {
            a.swapAt(k, i)
            permute(a, k + 1, visit)
            a.swapAt(k, i)
        }
    }
}
