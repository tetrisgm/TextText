import AppKit
import WebKit
import XCTest

@MainActor
private final class VisualParityPending<Value> {
    var continuation: CheckedContinuation<Value, Error>?
    var timeout: Task<Void, Never>?
    func finish(_ result: Result<Value, Error>) {
        timeout?.cancel(); timeout = nil
        let waiting = continuation; continuation = nil
        waiting?.resume(with: result)
    }
}

final class LocalVaultVisualParityTests: XCTestCase {
    private struct Metrics: Codable, Equatable {
        let font: String, lineHeight: String, background: String, color: String, colorScheme: String, buttonFont: String
        let buttonHeight: Double, sidebarWidth: Double
        let overflow: Bool, ready: Bool
    }
    private struct Receipt: Codable {
        let evidence: String, profile: String, theme: String
        let metrics: Metrics
    }

    @MainActor
    private func bounded<Value>(_ stage: String, seconds: Double = 3,
        start: (@escaping @MainActor (Result<Value, Error>) -> Void) -> Void) async throws -> Value {
        let pending = VisualParityPending<Value>()
        return try await withCheckedThrowingContinuation { continuation in
            pending.continuation = continuation
            pending.timeout = Task { @MainActor in
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                guard !Task.isCancelled else { return }
                pending.finish(.failure(NSError(domain: "VisualParity", code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "Timed out: " + stage])))
            }
            start { pending.finish($0) }
        }
    }

    @MainActor
    private func evaluate(_ script: String, in view: WKWebView) async throws -> Any? {
        try await bounded("JavaScript evaluation") { finish in
            view.evaluateJavaScript(script) { value, error in
                if let error { finish(.failure(error)) } else { finish(.success(value)) }
            }
        }
    }

    private func stage(_ text: String) {
        FileHandle.standardError.write(Data(("WK visual parity: " + text + "\n").utf8))
    }

    @MainActor
    func testSharedShellInActualWKWebView() async throws {
        guard let fixture = ProcessInfo.processInfo.environment["TEXTTEXT_VISUAL_PARITY_BUNDLE"] else {
            throw XCTSkip("Requires explicit visual parity bundle; no installed-app parity claimed")
        }
        _ = NSApplication.shared
        let base = URL(fileURLWithPath: fixture)
        let outputBase = ProcessInfo.processInfo.environment["TEXTTEXT_VISUAL_PARITY_RECEIPTS"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.temporaryDirectory
        let output = outputBase.appendingPathComponent("wk-visual-parity-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 1200, height: 800), configuration: configuration)
        let window = NSWindow(contentRect: view.frame, styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.title = "TextText isolated visual parity"
        window.contentView = view
        window.setContentSize(NSSize(width: 1200, height: 800))
        NSApp.unhide(nil)
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        defer { view.stopLoading(); window.orderOut(nil); window.contentView = nil; window.close() }
        var baselines: [String: Metrics] = [:]
        var receipts: [Receipt] = []
        for profile in ["native", "web"] {
            let entry = base.appendingPathComponent(profile + ".html")
            XCTAssertTrue(FileManager.default.fileExists(atPath: entry.path))
            stage("loading " + profile)
            view.loadFileURL(entry, allowingReadAccessTo: base)
            let deadline = Date().addingTimeInterval(15)
            while true {
                let ready = try? await evaluate("location.pathname.endsWith('/\(profile).html') && typeof window.visualParityMetrics==='function' && window.visualParityMetrics()?.ready === true", in: view) as? Bool
                if ready == true { break }
                if Date() > deadline { throw NSError(domain: "VisualParity", code: 1, userInfo: [NSLocalizedDescriptionKey: "Fixture did not become ready: \(profile)"]) }
                try await Task.sleep(nanoseconds: 25_000_000)
            }
            for theme in ["light", "dark"] {
                stage("measuring \(profile) \(theme)")
                window.appearance = NSAppearance(named: theme == "dark" ? .darkAqua : .aqua)
                _ = try await evaluate("document.documentElement.dataset.theme='\(theme)'", in: view)
                let metricsDeadline = Date().addingTimeInterval(5)
                var metrics: Metrics
                repeat {
                    let result = try await evaluate("JSON.stringify(window.visualParityMetrics())", in: view)
                    let raw = try XCTUnwrap(result as? String)
                    metrics = try JSONDecoder().decode(Metrics.self, from: Data(raw.utf8))
                    if metrics.ready && metrics.colorScheme == theme { break }
                    if Date() > metricsDeadline { throw NSError(domain: "VisualParity", code: 3,
                        userInfo: [NSLocalizedDescriptionKey: "Theme did not settle: \(profile) \(theme)"]) }
                    try await Task.sleep(nanoseconds: 25_000_000)
                } while true
                XCTAssertTrue(metrics.ready)
                XCTAssertEqual(metrics.font, "14px")
                XCTAssertEqual(metrics.buttonFont, "14px")
                XCTAssertEqual(Double(metrics.lineHeight.replacingOccurrences(of: "px", with: "")) ?? 0, 20.3, accuracy: 0.02)
                XCTAssertEqual(metrics.buttonHeight, 34, accuracy: 0.1)
                XCTAssertEqual(metrics.sidebarWidth, 240, accuracy: 0.1)
                XCTAssertEqual(metrics.background, theme == "light" ? "rgb(255, 255, 255)" : "rgb(35, 35, 35)")
                XCTAssertEqual(metrics.colorScheme, theme)
                XCTAssertFalse(metrics.overflow)
                let viewport = try await evaluate("innerWidth===1200 && innerHeight===800 && getComputedStyle(document.querySelector('.vault-app')).transform==='none'", in: view) as? Bool
                XCTAssertEqual(viewport, true, "Use an actual equal CSS viewport without transform scaling")
                if let baseline = baselines[theme] { XCTAssertEqual(metrics, baseline, "Web globals changed the shared shell in WKWebView") }
                else { baselines[theme] = metrics }
                stage("capturing \(profile) \(theme)")
                NSApp.activate(ignoringOtherApps: true)
                window.makeKeyAndOrderFront(nil)
                try await Task.sleep(nanoseconds: 100_000_000)
                let snapshot: NSImage = try await bounded("snapshot \(profile) \(theme)", seconds: 10) { finish in
                    view.takeSnapshot(with: nil) { image, error in
                        if let error { finish(.failure(error)) }
                        else if let image { finish(.success(image)) }
                        else { finish(.failure(NSError(domain: "VisualParity", code: 4,
                            userInfo: [NSLocalizedDescriptionKey: "Snapshot returned no image"]))) }
                    }
                }
                let tiff = try XCTUnwrap(snapshot.tiffRepresentation)
                let bitmap = try XCTUnwrap(NSBitmapImageRep(data: tiff))
                let png = try XCTUnwrap(bitmap.representation(using: .png, properties: [:]))
                try png.write(to: output.appendingPathComponent("\(profile)-\(theme).png"))
                receipts.append(Receipt(evidence: "Actual WKWebView isolated shared-component fixture; not installed app or physical input acceptance", profile: profile, theme: theme, metrics: metrics))
            }
        }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(receipts).write(to: output.appendingPathComponent("receipt.json"))
        print("PASS actual WKWebView shared shell light/dark parity. Screenshots and metrics: \(output.path)")
    }
}
