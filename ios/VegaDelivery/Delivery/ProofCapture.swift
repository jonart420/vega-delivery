import AVFoundation
import PhotosUI
import SwiftUI
import UIKit

/// Photo of the delivery (camera; photo library when no camera is available, e.g. simulator).
struct PhotoCapture: UIViewControllerRepresentable {
    let onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIViewController {
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            let picker = UIImagePickerController()
            picker.sourceType = .camera
            picker.cameraCaptureMode = .photo
            picker.delegate = context.coordinator
            return picker
        }
        var config = PHPickerConfiguration()
        config.filter = .images
        config.selectionLimit = 1
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate, PHPickerViewControllerDelegate {
        let parent: PhotoCapture
        init(_ parent: PhotoCapture) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage { parent.onImage(image) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            guard let provider = results.first?.itemProvider, provider.canLoadObject(ofClass: UIImage.self) else {
                parent.dismiss()
                return
            }
            provider.loadObject(ofClass: UIImage.self) { object, _ in
                DispatchQueue.main.async {
                    if let image = object as? UIImage { self.parent.onImage(image) }
                    self.parent.dismiss()
                }
            }
        }
    }
}

/// Signature of the recipient on the screen.
struct SignatureSheet: View {
    let name: String
    let onSigned: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var strokes: [[CGPoint]] = []
    @State private var current: [CGPoint] = []
    @State private var canvasSize: CGSize = .zero

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Text("Please sign in the field").font(.subheadline).foregroundStyle(.secondary)
                GeometryReader { geo in
                    ZStack(alignment: .bottomLeading) {
                        RoundedRectangle(cornerRadius: 12).fill(.white)
                        RoundedRectangle(cornerRadius: 12).stroke(.gray.opacity(0.35), lineWidth: 1)
                        Path { p in
                            p.move(to: CGPoint(x: 24, y: geo.size.height - 50))
                            p.addLine(to: CGPoint(x: geo.size.width - 24, y: geo.size.height - 50))
                        }
                        .stroke(.gray.opacity(0.4), lineWidth: 1)
                        if !name.isEmpty {
                            Text(name).font(.caption).foregroundStyle(.gray).padding(.leading, 24).padding(.bottom, 30)
                        }
                        SignatureStrokes(strokes: strokes + [current]).stroke(.black, style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
                    }
                    .contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { current.append($0.location) }
                            .onEnded { _ in
                                strokes.append(current)
                                current = []
                            }
                    )
                    .onAppear { canvasSize = geo.size }
                    .onChange(of: geo.size) { _, s in canvasSize = s }
                }
                .frame(height: 260)
                .accessibilityIdentifier("signatureCanvas")
                Button("Clear") { strokes = []; current = [] }.disabled(allStrokes.isEmpty)
                Spacer()
            }
            .padding()
            .navigationTitle("Signature")
            .navigationBarTitleDisplayMode(.inline)
            // Swiping down would dismiss the sheet and cancel the stroke being drawn
            .interactiveDismissDisabled()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        if let image = render() { onSigned(image) }
                        dismiss()
                    }
                    .disabled(allStrokes.allSatisfy { $0.count < 2 })
                }
            }
        }
    }

    /// Finished strokes plus the one being drawn (a cancelled gesture never calls onEnded)
    private var allStrokes: [[CGPoint]] { (strokes + [current]).filter { !$0.isEmpty } }

    @MainActor
    private func render() -> UIImage? {
        let size = canvasSize == .zero ? CGSize(width: 600, height: 260) : canvasSize
        let renderer = ImageRenderer(content:
            SignatureStrokes(strokes: allStrokes)
                .stroke(.black, style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
                .frame(width: size.width, height: size.height)
                .background(.white)
        )
        renderer.scale = 2
        return renderer.uiImage
    }
}

private struct SignatureStrokes: Shape {
    let strokes: [[CGPoint]]

    func path(in rect: CGRect) -> Path {
        var p = Path()
        for stroke in strokes {
            guard let first = stroke.first else { continue }
            p.move(to: first)
            if stroke.count == 1 { p.addLine(to: CGPoint(x: first.x + 0.5, y: first.y + 0.5)) }
            for point in stroke.dropFirst() { p.addLine(to: point) }
        }
        return p
    }
}

/// Camera scanner for delivery labels (EAN-13) and the customer barcode (EAN-8 composite).
struct BarcodeScanSheet: View {
    let accepted: Set<String>
    let onScan: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var error: String?
    @State private var lastValue: String?

    var body: some View {
        ZStack(alignment: .bottom) {
            CodeScannerView(
                types: [.ean8, .ean13, .microPDF417, .pdf417, .code128, .qr],
                onValue: { value in
                    let gtin = ScanCode.gtin(value)
                    // The 2D part of a composite carries the name only – keep scanning for the digits
                    if gtin.count < 8 { return false }
                    lastValue = value
                    onScan(value)
                    if accepted.contains(gtin) || accepted.isEmpty {
                        dismiss()
                        return true
                    }
                    return false
                },
                onError: { error = $0 }
            )
            .ignoresSafeArea()
            VStack(spacing: 8) {
                if let error {
                    Text(error).font(.callout).foregroundStyle(.white).padding(10).background(.red.opacity(0.8), in: Capsule())
                } else if let lastValue {
                    Text("Code \(ScanCode.gtin(lastValue)) does not belong to this stop")
                        .font(.callout).foregroundStyle(.white).padding(10).background(.orange.opacity(0.85), in: Capsule())
                } else {
                    Text("Scan the customer barcode or a delivery label")
                        .font(.callout.weight(.medium)).foregroundStyle(.white)
                        .padding(.horizontal, 16).padding(.vertical, 10).background(.black.opacity(0.7), in: Capsule())
                }
                Button("Close") { dismiss() }.buttonStyle(.borderedProminent)
            }
            .padding(.bottom, 40)
        }
    }
}
