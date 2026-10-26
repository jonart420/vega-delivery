import AVFoundation
import SwiftUI

struct SettingsView: View {
    @Environment(AppState.self) private var state
    @Environment(\.dismiss) private var dismiss

    private var voice: AVSpeechSynthesisVoice? { NavigationSpeechSynthesizer.preferredVoice }

    var body: some View {
        NavigationStack {
            Form {
                Section("Signed in") {
                    LabeledContent("Name", value: state.user?.name ?? "–")
                    LabeledContent("User", value: state.user?.username ?? "–")
                    if let company = state.config?.company.name, !company.isEmpty {
                        LabeledContent("Company", value: company)
                    }
                }
                Section("Server") {
                    ServerAddressField()
                }
                Section {
                    if let voice {
                        Label("\(voice.name) (\(voice.language))", systemImage: voice.quality == .default ? "speaker.wave.1" : "checkmark.circle.fill")
                    }
                    Text("Better voices: Settings → Accessibility → Spoken Content → Voices. Enhanced or premium voices are free and work offline.")
                        .font(.caption).foregroundStyle(.secondary)
                } header: { Text("Voice instructions") }
                Section("Sync") {
                    OutboxStatusRow()
                    Button("Send now") { Task { await Outbox.shared.flush() } }
                }
                Section {
                    Button("Sign out", role: .destructive) {
                        Task {
                            await state.logout()
                            dismiss()
                        }
                    }
                } footer: {
                    Text("Deliveries not yet sent are discarded when signing out.")
                }
            }
            .navigationTitle("Settings")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
