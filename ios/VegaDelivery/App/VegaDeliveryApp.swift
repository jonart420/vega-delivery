import SwiftData
import SwiftUI

@main
struct VegaDeliveryApp: App {
    @State private var state = AppState()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Group {
                if state.isLoggedIn {
                    TourListView()
                } else {
                    LoginView()
                }
            }
            .environment(state)
            .tint(state.accent)
            .modelContainer(Persistence.container)
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await Outbox.shared.flush() } }
            }
        }
    }
}
