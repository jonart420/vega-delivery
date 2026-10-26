import AVFoundation
import SwiftUI
import Vision

/// Camera scanner for QR login codes and delivery barcodes (EAN-13, EAN-8, MicroPDF417 of the
/// EAN-8 composite). Uses AVFoundation's built-in metadata detection.
struct CodeScannerView: UIViewControllerRepresentable {
    var types: [AVMetadataObject.ObjectType] = [.qr]
    /// Return true to accept the value and stop scanning
    var onValue: (String) -> Bool
    var onError: (String) -> Void

    func makeUIViewController(context: Context) -> ScannerViewController {
        let vc = ScannerViewController()
        vc.types = types
        vc.onValue = onValue
        vc.onError = onError
        return vc
    }

    func updateUIViewController(_ vc: ScannerViewController, context: Context) {}
}

final class ScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var types: [AVMetadataObject.ObjectType] = [.qr]
    var onValue: ((String) -> Bool)?
    var onError: ((String) -> Void)?

    private let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "vegadelivery.scanner")
    private var preview: AVCaptureVideoPreviewLayer?
    private var finished = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
            DispatchQueue.main.async {
                if granted { self?.configure() } else { self?.onError?(String(localized: "No camera access – allow it in Settings or type the code.")) }
            }
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview?.frame = view.bounds
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        queue.async { [session] in session.stopRunning() }
    }

    private func configure() {
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: device) else {
            onError?(String(localized: "No camera available (simulator?) – type the code instead."))
            return
        }
        session.beginConfiguration()
        if session.canAddInput(input) { session.addInput(input) }
        let output = AVCaptureMetadataOutput()
        if session.canAddOutput(output) {
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = types.filter(output.availableMetadataObjectTypes.contains)
        }
        session.commitConfiguration()

        if (try? device.lockForConfiguration()) != nil {
            if device.isAutoFocusRangeRestrictionSupported { device.autoFocusRangeRestriction = .near }
            if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
            device.unlockForConfiguration()
        }

        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        layer.frame = view.bounds
        view.layer.addSublayer(layer)
        preview = layer
        queue.async { [session] in session.startRunning() }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !finished else { return }
        for value in metadataObjects.compactMap({ ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }) {
            if onValue?(value) == true {
                finished = true
                UINotificationFeedbackGenerator().notificationOccurred(.success)
                queue.async { [session] in session.stopRunning() }
                return
            }
        }
    }
}

/// Reads a login QR code from a still image (photo from the library, e.g. in the simulator).
enum StillImageCodeReader {
    static func read(_ image: UIImage) async -> LoginQR? {
        guard let cg = image.cgImage else { return nil }
        return await Task.detached(priority: .userInitiated) {
            let request = LoginCodeParser.makeRequest()
            let orientation = CGImagePropertyOrientation(image.imageOrientation)
            try? VNImageRequestHandler(cgImage: cg, orientation: orientation).perform([request])
            return request.results?.compactMap { LoginCodeParser.login(fromQR: $0.payloadStringValue) }.first
        }.value
    }
}

extension CGImagePropertyOrientation {
    init(_ o: UIImage.Orientation) {
        switch o {
        case .up: self = .up
        case .down: self = .down
        case .left: self = .left
        case .right: self = .right
        case .upMirrored: self = .upMirrored
        case .downMirrored: self = .downMirrored
        case .leftMirrored: self = .leftMirrored
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}
