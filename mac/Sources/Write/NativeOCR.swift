import AppKit
import Foundation
@preconcurrency import Vision
import WebKit

/// Vision OCR is a native utility, not an AI provider. It remains available to
/// the web editor for extracting text from dropped images.
final class NativeOCRBridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?

    static let handlerName = "nativeOCR"

    static let shimScript = """
        (function () {
          if (window.writeNativeOCR) return;
          var pending = {};
          var counter = 0;
          window.__texttextNativeOCRDeliver = function (id, ok, result) {
            var entry = pending[id];
            if (!entry) return;
            delete pending[id];
            if (ok) entry.resolve(result);
            else entry.reject(new Error((result && result.error) || "OCR failed"));
          };
          window.writeNativeOCR = {
            recognize: function (imageBase64) {
              return new Promise(function (resolve, reject) {
                var mh = window.webkit && window.webkit.messageHandlers
                  && window.webkit.messageHandlers.nativeOCR;
                if (!mh) { reject(new Error("Native OCR bridge missing")); return; }
                var id = "ocr" + (++counter) + "_" + Date.now();
                pending[id] = { resolve: resolve, reject: reject };
                mh.postMessage({ id: id, imageBase64: imageBase64 });
              });
            },
          };
        })();
        """

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == Self.handlerName,
              let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              let base64 = body["imageBase64"] as? String
        else { return }

        Task { [weak self] in
            do {
                let result = try await Self.recognize(base64: base64)
                self?.deliver(id: id, ok: true, result: ["text": result])
            } catch {
                self?.deliver(
                    id: id,
                    ok: false,
                    result: ["error": error.localizedDescription])
            }
        }
    }

    private struct OCRError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private static func recognize(base64: String) async throws -> String {
        guard let data = Data(base64Encoded: base64),
              let image = NSImage(data: data),
              let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
        else { throw OCRError(message: "Missing or unreadable image data") }

        return try await withCheckedThrowingContinuation { continuation in
            let request = VNRecognizeTextRequest { request, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                let observations =
                    request.results as? [VNRecognizedTextObservation] ?? []
                let lines = observations.compactMap {
                    $0.topCandidates(1).first?.string
                }
                continuation.resume(returning: lines.joined(separator: "\n"))
            }
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            let handler = VNImageRequestHandler(cgImage: cgImage)
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    try handler.perform([request])
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    @MainActor
    private func deliver(id: String, ok: Bool, result: [String: Any]) {
        guard let webView,
              let data = try? JSONSerialization.data(withJSONObject: result),
              let json = String(data: data, encoding: .utf8),
              let idData = try? JSONSerialization.data(withJSONObject: [id]),
              let idJSON = String(data: idData, encoding: .utf8)
        else { return }
        webView.evaluateJavaScript(
            "window.__texttextNativeOCRDeliver && window.__texttextNativeOCRDeliver(\(idJSON)[0], \(ok ? "true" : "false"), \(json));",
            completionHandler: nil)
    }
}
