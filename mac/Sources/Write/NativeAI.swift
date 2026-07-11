import AppKit
import Foundation
import Vision
import WebKit

#if canImport(FoundationModels)
    import FoundationModels
#endif

/// On-device AI for the web app: Apple's foundation model (macOS 26+) plus
/// Vision OCR, exposed to the page over the `nativeAI` script-message bridge.
///
/// The contract with the web side (see src/lib/ai/native.ts in the web repo):
/// the page posts {id, op, payload} and the bridge replies by calling
/// window.__writeNativeAIDeliver(id, ok, resultJSON). Every op resolves; a
/// failure resolves with ok=false and {error}. The page treats the bridge as
/// the default AI provider when `capabilities` reports available, and falls
/// back to a configured cloud provider otherwise.
///
/// Ops are stateless one-shot requests (fresh session per call): capabilities,
/// generate, title, tags, excerpt, summarize, rewrite, categorize, ocr.
/// Image understanding (alt text) needs the macOS 27 SDK's image input and is
/// reported as an unsupported op until the toolchain moves.
final class NativeAIBridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?

    // The on-device model's context window is small (about 4k tokens). Inputs
    // are trimmed before prompting so long articles degrade to "first part
    // summarized" instead of a context-overflow error.
    private static let inputCharacterLimit = 12_000

    static let handlerName = "nativeAI"

    /// The JS shim injected at document start (origin-gated by the caller,
    /// same pattern as the app-flags script).
    static let shimScript = """
        (function () {
          if (window.writeNativeAI) return;
          var pending = {};
          var counter = 0;
          window.__writeNativeAIDeliver = function (id, ok, result) {
            var entry = pending[id];
            if (!entry) return;
            delete pending[id];
            if (ok) entry.resolve(result);
            else entry.reject(new Error((result && result.error) || "Native AI failed"));
          };
          window.writeNativeAI = {
            request: function (op, payload) {
              return new Promise(function (resolve, reject) {
                var mh = window.webkit && window.webkit.messageHandlers
                  && window.webkit.messageHandlers.nativeAI;
                if (!mh) { reject(new Error("Native AI bridge missing")); return; }
                var id = "ai" + (++counter) + "_" + Date.now();
                pending[id] = { resolve: resolve, reject: reject };
                mh.postMessage({ id: id, op: op, payload: payload || {} });
              });
            },
          };
        })();
        """

    // MARK: WKScriptMessageHandler

    func userContentController(
        _ ucc: WKUserContentController, didReceive message: WKScriptMessage
    ) {
        guard message.name == Self.handlerName,
              let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              let op = body["op"] as? String
        else { return }
        let payload = body["payload"] as? [String: Any] ?? [:]

        Task { [weak self] in
            guard let self else { return }
            do {
                let result = try await self.run(op: op, payload: payload)
                await self.deliver(id: id, ok: true, result: result)
            } catch {
                await self.deliver(
                    id: id, ok: false,
                    result: ["error": error.localizedDescription])
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
        // The id round-trips through JSON encoding so page JS never sees an
        // unescaped string; [0] unwraps the single-element array form.
        let script =
            "window.__writeNativeAIDeliver && window.__writeNativeAIDeliver(\(idJSON)[0], \(ok ? "true" : "false"), \(json));"
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    // MARK: Ops

    private struct BridgeError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    private func run(op: String, payload: [String: Any]) async throws -> [String: Any] {
        switch op {
        case "capabilities":
            return capabilities()
        case "ocr":
            return try await ocr(payload)
        case "generate", "title", "tags", "excerpt", "summarize", "rewrite",
             "categorize":
            guard #available(macOS 26.0, *) else {
                throw BridgeError(message: "On-device AI needs macOS 26 or later.")
            }
            return try await languageOp(op, payload)
        case "altText", "describeImage":
            throw BridgeError(
                message: "Image understanding arrives with the next SDK; use OCR for text in images.")
        default:
            throw BridgeError(message: "Unknown op: \(op)")
        }
    }

    private func capabilities() -> [String: Any] {
        var result: [String: Any] = [
            "os": ProcessInfo.processInfo.operatingSystemVersionString,
            "ocr": true,
            "imageUnderstanding": false,
        ]
        if #available(macOS 26.0, *) {
            #if canImport(FoundationModels)
                switch SystemLanguageModel.default.availability {
                case .available:
                    result["available"] = true
                    result["textOps"] = [
                        "generate", "title", "tags", "excerpt", "summarize",
                        "rewrite", "categorize",
                    ]
                case .unavailable(let reason):
                    result["available"] = false
                    switch reason {
                    case .deviceNotEligible:
                        result["reason"] = "deviceNotEligible"
                    case .appleIntelligenceNotEnabled:
                        result["reason"] = "appleIntelligenceNotEnabled"
                    case .modelNotReady:
                        result["reason"] = "modelNotReady"
                    @unknown default:
                        result["reason"] = "unavailable"
                    }
                @unknown default:
                    result["available"] = false
                    result["reason"] = "unavailable"
                }
            #else
                result["available"] = false
                result["reason"] = "sdkTooOld"
            #endif
        } else {
            result["available"] = false
            result["reason"] = "osTooOld"
        }
        return result
    }

    private func trimmedText(_ payload: [String: Any], key: String = "text") throws -> (
        text: String, truncated: Bool
    ) {
        guard let raw = payload[key] as? String,
              !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { throw BridgeError(message: "Missing \(key)") }
        if raw.count > Self.inputCharacterLimit {
            return (String(raw.prefix(Self.inputCharacterLimit)), true)
        }
        return (raw, false)
    }

    #if canImport(FoundationModels)
        @available(macOS 26.0, *)
        private func respond(instructions: String, prompt: String) async throws
            -> String
        {
            let session = LanguageModelSession(instructions: instructions)
            let response = try await session.respond(to: prompt)
            return response.content.trimmingCharacters(in: .whitespacesAndNewlines)
        }

        @available(macOS 26.0, *)
        private func languageOp(_ op: String, _ payload: [String: Any]) async throws
            -> [String: Any]
        {
            switch op {
            case "generate":
                let (text, truncated) = try trimmedText(payload, key: "prompt")
                let instructions =
                    payload["instructions"] as? String
                    ?? "You are a concise writing assistant inside a notes and blogging app. Answer directly with no preamble."
                let out = try await respond(instructions: instructions, prompt: text)
                return ["text": out, "truncated": truncated]

            case "title":
                let (text, truncated) = try trimmedText(payload)
                let out = try await respond(
                    instructions:
                        "Write one short, specific title for the given document. Sentence case. No quotes, no trailing period, at most nine words. Reply with the title only.",
                    prompt: text)
                return ["title": clean(line: out), "truncated": truncated]

            case "tags":
                let (text, truncated) = try trimmedText(payload)
                let maxTags = min(max(payload["max"] as? Int ?? 5, 1), 10)
                let out = try await respond(
                    instructions:
                        "Extract up to \(maxTags) topical tags for the given document. Each tag is one or two lowercase words. Reply with one tag per line and nothing else.",
                    prompt: text)
                let tags = out.split(whereSeparator: \.isNewline)
                    .map {
                        clean(line: String($0)).lowercased()
                            .trimmingCharacters(in: CharacterSet(charactersIn: "#"))
                    }
                    .filter { !$0.isEmpty && $0.count <= 40 }
                return ["tags": Array(tags.prefix(maxTags)), "truncated": truncated]

            case "excerpt":
                let (text, truncated) = try trimmedText(payload)
                let out = try await respond(
                    instructions:
                        "Write a one or two sentence excerpt that makes someone want to read the given document. Plain prose, no quotes, at most 240 characters. Reply with the excerpt only.",
                    prompt: text)
                return ["excerpt": out, "truncated": truncated]

            case "summarize":
                let (text, truncated) = try trimmedText(payload)
                let out = try await respond(
                    instructions:
                        "Summarize the given text faithfully and concisely in at most four sentences. Reply with the summary only.",
                    prompt: text)
                return ["summary": out, "truncated": truncated]

            case "rewrite":
                let (text, truncated) = try trimmedText(payload)
                let style = payload["style"] as? String ?? "clearer and tighter"
                let out = try await respond(
                    instructions:
                        "Rewrite the given text to be \(style). Preserve the meaning, the language, and any markdown structure. Reply with the rewritten text only.",
                    prompt: text)
                return ["text": out, "truncated": truncated]

            case "categorize":
                let (text, truncated) = try trimmedText(payload)
                let categories = (payload["categories"] as? [String] ?? [])
                    .filter { !$0.isEmpty }
                guard !categories.isEmpty else {
                    throw BridgeError(message: "Missing categories")
                }
                let out = try await respond(
                    instructions:
                        "Pick the single best matching category for the given document from this list: \(categories.joined(separator: ", ")). Reply with exactly one category from the list and nothing else.",
                    prompt: text)
                let picked = clean(line: out)
                let match =
                    categories.first { $0.caseInsensitiveCompare(picked) == .orderedSame }
                    ?? categories.first {
                        picked.localizedCaseInsensitiveContains($0)
                    }
                return [
                    "category": match ?? categories[0],
                    "confident": match != nil,
                    "truncated": truncated,
                ]

            default:
                throw BridgeError(message: "Unknown op: \(op)")
            }
        }
    #else
        private func languageOp(_ op: String, _ payload: [String: Any]) async throws
            -> [String: Any]
        {
            throw BridgeError(message: "On-device AI is not in this build.")
        }
    #endif

    /// Strips list markers and wrapping quotes the model sometimes adds.
    private func clean(line: String) -> String {
        var value = line.trimmingCharacters(in: .whitespacesAndNewlines)
        while let first = value.first, "-*•\"'".contains(first) {
            value = String(value.dropFirst()).trimmingCharacters(in: .whitespaces)
        }
        while let last = value.last, "\"'.".contains(last) {
            value = String(value.dropLast()).trimmingCharacters(in: .whitespaces)
        }
        return value
    }

    // MARK: OCR (Vision, works on every supported macOS)

    private func ocr(_ payload: [String: Any]) async throws -> [String: Any] {
        guard let base64 = payload["imageBase64"] as? String,
              let data = Data(base64Encoded: base64),
              let image = NSImage(data: data),
              let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
        else { throw BridgeError(message: "Missing or unreadable imageBase64") }

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
                continuation.resume(returning: ["text": lines.joined(separator: "\n")])
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
}
