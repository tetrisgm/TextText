import AppKit
import Foundation
import Vision
import WebKit

#if canImport(FoundationModels)
    import FoundationModels

    @available(macOS 26.0, *)
    private final class NativeModelWarmup: @unchecked Sendable {
        static let shared = NativeModelWarmup()

        private let lock = NSLock()
        private var session: LanguageModelSession?

        func startIfNeeded() {
            lock.lock()
            guard session == nil else {
                lock.unlock()
                return
            }
            let warmSession = LanguageModelSession(
                instructions:
                    "You are the private on-device writing assistant inside Write."
            )
            session = warmSession
            lock.unlock()
            warmSession.prewarm()
        }
    }
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
              let body = message.body as? [String: Any]
        else { return }

        // A tool reply from the page (the second half of an agent tool call).
        if let reply = body["toolReply"] as? [String: Any],
           let callId = reply["callId"] as? String
        {
            let ok = reply["ok"] as? Bool ?? false
            let result = reply["result"] as? String ?? ""
            resolveWebToolCall(callId: callId, ok: ok, result: result)
            return
        }

        guard let id = body["id"] as? String,
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
        case "agent":
            guard #available(macOS 26.0, *) else {
                throw BridgeError(message: "On-device AI needs macOS 26 or later.")
            }
            return try await agentOp(payload)
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
                    NativeModelWarmup.shared.startIfNeeded()
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

    #if canImport(FoundationModels)
        @available(macOS 26.0, *)
        static func unavailableModelMessage(
            for availability: SystemLanguageModel.Availability
        ) -> String? {
            switch availability {
            case .available:
                return nil
            case .unavailable(let reason):
                switch reason {
                case .deviceNotEligible:
                    return "The on-device model is unavailable because this Mac does not support Apple Intelligence. Add a cloud AI key in Workspace Settings to use the Assistant."
                case .appleIntelligenceNotEnabled:
                    return "The on-device model is unavailable because Apple Intelligence is turned off. Enable it in System Settings, then try again, or add a cloud AI key in Workspace Settings."
                case .modelNotReady:
                    return "The on-device model is still downloading. Write will retry automatically, or you can add a cloud AI key in Workspace Settings."
                @unknown default:
                    return "The on-device model is unavailable right now. Try again later, or add a cloud AI key in Workspace Settings."
                }
            @unknown default:
                return "The on-device model is unavailable right now. Try again later, or add a cloud AI key in Workspace Settings."
            }
        }

        @available(macOS 26.0, *)
        static func agentSessionErrorMessage(
            _ error: Error,
            modelAvailability: SystemLanguageModel.Availability,
            toolFailure: String? = nil
        ) -> String {
            if let toolFailure = toolFailure?.trimmingCharacters(
                in: .whitespacesAndNewlines), !toolFailure.isEmpty
            {
                return toolFailure
            }
            if let unavailable = unavailableModelMessage(for: modelAvailability) {
                return unavailable
            }
            guard let generationError =
                error as? LanguageModelSession.GenerationError
            else {
                let message = error.localizedDescription
                if message.localizedCaseInsensitiveContains("Local Model Asset")
                    || message.localizedCaseInsensitiveContains("assets unavailable")
                {
                    return "The on-device model is still preparing or downloading (assets unavailable). Write will retry automatically."
                }
                return message
            }

            switch generationError {
            case .exceededContextWindowSize:
                return "This request is too large for the on-device Assistant. Shorten it or split it into smaller requests."
            case .assetsUnavailable:
                return "The on-device model is still preparing or downloading (assets unavailable). Write will retry automatically."
            case .guardrailViolation:
                return "The on-device Assistant could not complete this request because of its safety checks."
            case .unsupportedGuide:
                return "The on-device Assistant could not follow the requested response format. Try a simpler request."
            case .unsupportedLanguageOrLocale:
                return "The on-device Assistant does not support the language or locale in this request."
            case .decodingFailure:
                return "The Assistant could not understand a workspace tool response. No model availability problem occurred."
            case .rateLimited:
                return "The on-device Assistant is busy. Wait a moment, then try again."
            case .concurrentRequests:
                return "Another on-device Assistant request is running. Wait for it to finish, then try again."
            case .refusal:
                return "The on-device Assistant declined this request."
            @unknown default:
                return "The on-device Assistant could not complete this request."
            }
        }
    #endif

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
            NativeModelWarmup.shared.startIfNeeded()
            let session = LanguageModelSession(instructions: instructions)
            do {
                let response = try await session.respond(to: prompt)
                return response.content.trimmingCharacters(in: .whitespacesAndNewlines)
            } catch {
                throw BridgeError(
                    message: Self.agentSessionErrorMessage(
                        error,
                        modelAvailability: SystemLanguageModel.default.availability))
            }
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

    // MARK: Agent (on-device tool calling over the page's workspace commands)

    /// The model sees the same workspace command contract as MCP and the page
    /// executor. Execution still happens in src/lib/ai/agent-tools.ts, so the
    /// signed-in page remains the authority for validation, confirmation, and
    /// privacy. A TS parity test compares this manifest with ai/tools.ts.
    struct AgentToolSpec: Decodable, Sendable {
        let name: String
        let description: String
        let inputSchema: AgentObjectSchema

        #if canImport(FoundationModels)
            @available(macOS 26.0, *)
            func makeGenerationSchema() throws -> GenerationSchema {
                try inputSchema.makeGenerationSchema(named: name)
            }
        #endif
    }

    struct AgentObjectSchema: Decodable, Sendable {
        let type: String
        let properties: [String: AgentPropertySchema]
        let required: [String]?
        let additionalProperties: Bool

        #if canImport(FoundationModels)
            @available(macOS 26.0, *)
            func makeGenerationSchema(named name: String) throws -> GenerationSchema {
                let required = Set(required ?? [])
                guard type == "object", !additionalProperties,
                      required.isSubset(of: Set(properties.keys))
                else { throw AgentToolSchemaError.invalidObject(name) }

                let generatedProperties = try properties.sorted { $0.key < $1.key }.map {
                    propertyName, property in
                    DynamicGenerationSchema.Property(
                        name: propertyName,
                        description: property.generationDescription,
                        schema: try property.makeDynamicGenerationSchema(
                            named: "\(name)_\(propertyName)"),
                        isOptional: !required.contains(propertyName))
                }
                return try GenerationSchema(
                    root: DynamicGenerationSchema(
                        name: name, properties: generatedProperties),
                    dependencies: [])
            }
        #endif
    }

    struct AgentPropertySchema: Decodable, Sendable {
        let type: String?
        let description: String?
        let minLength: Int?
        let maxLength: Int?
        let minItems: Int?
        let maxItems: Int?
        let items: AgentArrayItemSchema?
        let minimum: Int?
        let maximum: Int?
        let pattern: String?
        let choices: [String]?
        let constant: String?
        let anyOf: [AgentPropertySchema]?

        enum CodingKeys: String, CodingKey {
            case type, description, minLength, maxLength, minItems, maxItems, items
            case minimum, maximum, pattern, anyOf
            case choices = "enum"
            case constant = "const"
        }

        var isNull: Bool { type == "null" }

        var generationDescription: String? {
            var parts = description.map { [$0] } ?? []
            if minLength == 1 {
                parts.append("Must not be empty.")
            } else if let minLength {
                parts.append("At least \(minLength) characters.")
            }
            if let maxLength { parts.append("At most \(maxLength) characters.") }
            return parts.isEmpty ? nil : parts.joined(separator: " ")
        }

        #if canImport(FoundationModels)
            @available(macOS 26.0, *)
            func makeDynamicGenerationSchema(named name: String) throws
                -> DynamicGenerationSchema
            {
                if let anyOf {
                    let schemas: [DynamicGenerationSchema]
                    if #available(macOS 26.4, *) {
                        schemas = try anyOf.enumerated().map { index, choice in
                            if choice.isNull { return .null }
                            return try choice.makeDynamicGenerationSchema(
                                named: "\(name)_choice_\(index)")
                        }
                    } else {
                        // Explicit null schemas arrived in macOS 26.4. On the
                        // initial 26.x runtime the field stays optional; the
                        // page validator remains the final contract authority.
                        schemas = try anyOf.enumerated().compactMap { index, choice in
                            guard !choice.isNull else { return nil }
                            return try choice.makeDynamicGenerationSchema(
                                named: "\(name)_choice_\(index)")
                        }
                    }
                    guard let first = schemas.first else {
                        throw AgentToolSchemaError.invalidProperty(name)
                    }
                    if schemas.count == 1 { return first }
                    return DynamicGenerationSchema(name: name, anyOf: schemas)
                }

                switch type {
                case "string":
                    if let choices {
                        guard !choices.isEmpty else {
                            throw AgentToolSchemaError.invalidProperty(name)
                        }
                        return DynamicGenerationSchema(name: name, anyOf: choices)
                    }
                    if let constant {
                        return DynamicGenerationSchema(name: name, anyOf: [constant])
                    }
                    if let pattern {
                        return DynamicGenerationSchema(
                            type: String.self, guides: [.pattern(try Regex(pattern))])
                    }
                    return DynamicGenerationSchema(type: String.self)

                case "integer":
                    let guides: [GenerationGuide<Int>]
                    switch (minimum, maximum) {
                    case (.some(let lower), .some(let upper)):
                        guides = [.range(lower...upper)]
                    case (.some(let lower), .none):
                        guides = [.minimum(lower)]
                    case (.none, .some(let upper)):
                        guides = [.maximum(upper)]
                    case (.none, .none):
                        guides = []
                    }
                    return DynamicGenerationSchema(type: Int.self, guides: guides)

                case "boolean":
                    return DynamicGenerationSchema(type: Bool.self)

                case "array":
                    guard let items else {
                        throw AgentToolSchemaError.invalidProperty(name)
                    }
                    return DynamicGenerationSchema(
                        arrayOf: try items.makeDynamicGenerationSchema(
                            named: "\(name)_item"),
                        minimumElements: minItems,
                        maximumElements: maxItems
                    )

                default:
                    throw AgentToolSchemaError.invalidProperty(name)
                }
            }
        #endif
    }

    struct AgentArrayItemSchema: Decodable, Sendable {
        let type: String

        #if canImport(FoundationModels)
            @available(macOS 26.0, *)
            func makeDynamicGenerationSchema(named name: String) throws
                -> DynamicGenerationSchema
            {
                guard type == "string" else {
                    throw AgentToolSchemaError.invalidProperty(name)
                }
                return DynamicGenerationSchema(type: String.self)
            }
        #endif
    }

    private enum AgentToolSchemaError: LocalizedError {
        case invalidObject(String)
        case invalidProperty(String)

        var errorDescription: String? {
            switch self {
            case .invalidObject(let name):
                return "Invalid object schema for native tool \(name)."
            case .invalidProperty(let name):
                return "Unsupported property schema for native tool field \(name)."
            }
        }
    }

    // Generated by scripts/sync-native-tool-contract.mjs from the canonical
    // Zod definitions. The parity test rejects manual drift.
    private static let agentToolContractJSON = #"""
        [
          {
            "name": "get_workspace",
            "description": "Return this workspace's handle, name, your effective access, and server capabilities.",
            "inputSchema": {
              "type": "object",
              "properties": {},
              "additionalProperties": false
            }
          },
          {
            "name": "list_folders",
            "description": "List every folder you can see with its id, path, mode, and item count.",
            "inputSchema": {
              "type": "object",
              "properties": {},
              "additionalProperties": false
            }
          },
          {
            "name": "list_items",
            "description": "List the live items in one folder with their ids, titles, tags, status, and content hash.",
            "inputSchema": {
              "type": "object",
              "properties": {
                "folder_path": {
                  "description": "Defaults to \"blog\".",
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256
                },
                "limit": {
                  "description": "Defaults to 50.",
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 100
                }
              },
              "additionalProperties": false
            }
          },
          {
            "name": "read_item",
            "description": "Read one item's markdown, metadata, tags, outbound links, backlinks, and assets by id.",
            "inputSchema": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128,
                  "description": "The workspace item id."
                }
              },
              "required": [
                "id"
              ],
              "additionalProperties": false
            }
          },
          {
            "name": "search",
            "description": "Search item titles, excerpts, and bodies you can access, and return matches with snippets.",
            "inputSchema": {
              "type": "object",
              "properties": {
                "query": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 500
                },
                "limit": {
                  "description": "Defaults to 25.",
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 50
                }
              },
              "required": [
                "query"
              ],
              "additionalProperties": false
            }
          },
          {
            "name": "list_trash",
            "description": "List soft-deleted items and folder restore-units. Nothing here is permanently deleted.",
            "inputSchema": {
              "type": "object",
              "properties": {},
              "additionalProperties": false
            }
          },
          {
            "name": "list_comments",
            "description": "List comment threads on one item, with anchored quotes and resolution state.",
            "inputSchema": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128,
                  "description": "The workspace item id."
                },
                "state": {
                  "type": "string",
                  "enum": [
                    "open",
                    "resolved",
                    "all"
                  ]
                }
              },
              "required": [
                "id"
              ],
              "additionalProperties": false
            }
          },
          {
            "name": "list_access",
            "description": "List who can access the workspace, one folder, or one item, and their role.",
            "inputSchema": {
              "type": "object",
              "properties": {
                "scope_type": {
                  "type": "string",
                  "enum": [
                    "workspace",
                    "folder",
                    "item"
                  ]
                },
                "scope_id": {
                  "description": "Required for folder and item scopes. Omit for the current workspace.",
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128
                }
              },
              "required": [
                "scope_type"
              ],
              "additionalProperties": false
            }
          },
          {
            "name": "create_item",
            "description": "Create one draft item in a folder from fields or a full markdown file. Never published, never pinned.",
            "inputSchema": {
              "type": "object",
              "properties": {
                "folder_path": {
                  "description": "The destination folder path. Defaults to the Blog folder at \"blog\".",
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256
                },
                "title": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 300
                },
                "body": {
                  "type": "string",
                  "maxLength": 1000000
                },
                "excerpt": {
                  "anyOf": [
                    {
                      "type": "string",
                      "maxLength": 2000
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "kind": {
                  "type": "string",
                  "enum": [
                    "article",
                    "media_post",
                    "video_post",
                    "note",
                    "bookmark"
                  ]
                },
                "markdown": {
                  "description": "A complete Write markdown file. Use this instead of title, body, excerpt, and kind.",
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 1000000
                }
              },
              "additionalProperties": false
            }
          },
          {
            "name": "update_item",
            "description": "Update one item's content or metadata: title, body, excerpt, tags, slug, cover, pin, and publication date. Full markdown may update the same fields. Cannot publish, unpublish, or move an item.",
            "inputSchema": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128,
                  "description": "The workspace item id."
                },
                "title": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 300
                },
                "excerpt": {
                  "anyOf": [
                    {
                      "type": "string",
                      "maxLength": 2000
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "body": {
                  "type": "string",
                  "maxLength": 1000000
                },
                "tags": {
                  "maxItems": 24,
                  "type": "array",
                  "items": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 48
                  },
                  "description": "The complete tag list; replaces existing tags."
                },
                "slug": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 120
                },
                "accent": {
                  "anyOf": [
                    {
                      "type": "string",
                      "pattern": "^#[0-9a-fA-F]{6}$"
                    },
                    {
                      "type": "string",
                      "const": ""
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "cover": {
                  "anyOf": [
                    {
                      "type": "string",
                      "maxLength": 2048
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "cover_caption": {
                  "anyOf": [
                    {
                      "type": "string",
                      "maxLength": 2000
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "cover_height": {
                  "anyOf": [
                    {
                      "type": "integer",
                      "minimum": 180,
                      "maximum": 860
                    },
                    {
                      "type": "null"
                    }
                  ]
                },
                "date": {
                  "description": "Publication date for an already-published item, as YYYY-MM-DD.",
                  "type": "string",
                  "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                },
                "pinned": {
                  "type": "boolean"
                },
                "markdown": {
                  "description": "A complete Write markdown file. Content and owner metadata may change, but status, kind, and folder cannot.",
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 1000000
                },
                "if_match_hash": {
                  "description": "The hash returned by list_items, search, or the previous mutation. A stale hash rejects the write.",
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256
                }
              },
              "required": [
                "id"
              ],
              "additionalProperties": false
            }
          },
          {
            "name": "append_to_item",
            "description": "Append a markdown block to the end of one item's body without touching its metadata.",
            "inputSchema": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128,
                  "description": "The workspace item id."
                },
                "markdown_fragment": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 1000000
                },
                "if_match_hash": {
                  "description": "The hash returned by list_items, search, or the previous mutation. A stale hash rejects the write.",
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256
                }
              },
              "required": [
                "id",
                "markdown_fragment"
              ],
              "additionalProperties": false
            }
          },
          {
            "name": "set_item_status",
            "description": "Publish or unpublish one blog item. Notes and bookmarks can never be published. This can change what readers can see. Obtain explicit human confirmation immediately before calling it.",
            "inputSchema": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128,
                  "description": "The workspace item id."
                },
                "status": {
                  "type": "string",
                  "enum": [
                    "draft",
                    "published"
                  ]
                },
                "if_match_hash": {
                  "description": "The hash returned by list_items, search, or the previous mutation. A stale hash rejects the write.",
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256
                }
              },
              "required": [
                "id",
                "status"
              ],
              "additionalProperties": false
            }
          },
          {
            "name": "move_item",
            "description": "Move one item to another folder of the same mode.",
            "inputSchema": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128,
                  "description": "The workspace item id."
                },
                "folder_path": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256,
                  "description": "A full folder path from list_folders, such as \"blog/ideas\"."
                },
                "if_match_hash": {
                  "description": "The hash returned by list_items, search, or the previous mutation. A stale hash rejects the write.",
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256
                }
              },
              "required": [
                "id",
                "folder_path"
              ],
              "additionalProperties": false
            }
          },
          {
            "name": "delete_item",
            "description": "Move one item to Trash. It stays restorable; this never permanently deletes. This changes or removes existing workspace state. Obtain explicit human confirmation immediately before calling it.",
            "inputSchema": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128,
                  "description": "The workspace item id."
                },
                "if_match_hash": {
                  "description": "The hash returned by list_items, search, or the previous mutation. A stale hash rejects the write.",
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256
                }
              },
              "required": [
                "id"
              ],
              "additionalProperties": false
            }
          },
          {
            "name": "restore_item",
            "description": "Restore one item from Trash with its previous status. This can change what readers can see. Obtain explicit human confirmation immediately before calling it.",
            "inputSchema": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128,
                  "description": "The workspace item id."
                }
              },
              "required": [
                "id"
              ],
              "additionalProperties": false
            }
          },
          {
            "name": "add_item_asset",
            "description": "Import one public image or video URL into Write and attach it as cover, body, or gallery.",
            "inputSchema": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128,
                  "description": "The workspace item id."
                },
                "source_url": {
                  "type": "string",
                  "maxLength": 2048,
                  "format": "uri"
                },
                "placement": {
                  "type": "string",
                  "enum": [
                    "cover",
                    "body_end",
                    "gallery"
                  ]
                },
                "alt_text": {
                  "type": "string",
                  "maxLength": 500
                },
                "caption": {
                  "type": "string",
                  "maxLength": 2000
                },
                "if_match_hash": {
                  "description": "The hash returned by list_items, search, or the previous mutation. A stale hash rejects the write.",
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256
                }
              },
              "required": [
                "id",
                "source_url",
                "placement"
              ],
              "additionalProperties": false
            }
          },
          {
            "name": "remove_item_asset",
            "description": "Remove references to one asset URL from an item's cover, body, and gallery. This changes or removes existing workspace state. Obtain explicit human confirmation immediately before calling it.",
            "inputSchema": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128,
                  "description": "The workspace item id."
                },
                "asset_url": {
                  "type": "string",
                  "maxLength": 2048,
                  "format": "uri"
                },
                "if_match_hash": {
                  "description": "The hash returned by list_items, search, or the previous mutation. A stale hash rejects the write.",
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256
                }
              },
              "required": [
                "id",
                "asset_url"
              ],
              "additionalProperties": false
            }
          },
          {
            "name": "recapture_bookmark",
            "description": "Re-fetch one bookmark from its saved URL. The current capture stays visible until the new one lands.",
            "inputSchema": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128,
                  "description": "The workspace item id."
                },
                "if_match_hash": {
                  "description": "The hash returned by list_items, search, or the previous mutation. A stale hash rejects the write.",
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256
                }
              },
              "required": [
                "id"
              ],
              "additionalProperties": false
            }
          },
          {
            "name": "add_comment",
            "description": "Add a comment or reply on one item, optionally anchored to an exact quote.",
            "inputSchema": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128,
                  "description": "The workspace item id."
                },
                "body": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 20000
                },
                "parent_comment_id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128
                },
                "anchor_field": {
                  "type": "string",
                  "enum": [
                    "title",
                    "excerpt",
                    "body"
                  ]
                },
                "anchor_exact": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 4000
                },
                "anchor_start": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 9007199254740991
                },
                "anchor_end": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 9007199254740991
                }
              },
              "required": [
                "id",
                "body"
              ],
              "additionalProperties": false
            }
          },
          {
            "name": "set_comment_resolved",
            "description": "Resolve or reopen one comment thread.",
            "inputSchema": {
              "type": "object",
              "properties": {
                "id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128,
                  "description": "The workspace item id."
                },
                "comment_id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128
                },
                "resolved": {
                  "type": "boolean"
                }
              },
              "required": [
                "id",
                "comment_id",
                "resolved"
              ],
              "additionalProperties": false
            }
          },
          {
            "name": "create_folder",
            "description": "Create a subfolder under an existing folder path; it inherits the parent's mode and privacy.",
            "inputSchema": {
              "type": "object",
              "properties": {
                "parent_path": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256,
                  "description": "The existing parent folder path."
                },
                "name": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 80,
                  "description": "The new display name."
                }
              },
              "required": [
                "parent_path",
                "name"
              ],
              "additionalProperties": false
            }
          },
          {
            "name": "rename_folder",
            "description": "Rename one folder. Its id and path do not change.",
            "inputSchema": {
              "type": "object",
              "properties": {
                "folder_id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128
                },
                "name": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 80
                }
              },
              "required": [
                "folder_id",
                "name"
              ],
              "additionalProperties": false
            }
          },
          {
            "name": "delete_folder",
            "description": "Move one folder subtree to Trash. Restorable; never permanently deleted. This changes or removes existing workspace state. Obtain explicit human confirmation immediately before calling it.",
            "inputSchema": {
              "type": "object",
              "properties": {
                "folder_id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128,
                  "description": "The stable workspace folder id."
                }
              },
              "required": [
                "folder_id"
              ],
              "additionalProperties": false
            }
          },
          {
            "name": "restore_folder",
            "description": "Restore one folder subtree from Trash. This can change what readers can see. Obtain explicit human confirmation immediately before calling it.",
            "inputSchema": {
              "type": "object",
              "properties": {
                "folder_id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128,
                  "description": "The stable workspace folder id."
                }
              },
              "required": [
                "folder_id"
              ],
              "additionalProperties": false
            }
          },
          {
            "name": "set_access",
            "description": "Grant or change one person's role on the workspace, a folder, or an item, by email. This can change what readers can see. Obtain explicit human confirmation immediately before calling it.",
            "inputSchema": {
              "type": "object",
              "properties": {
                "scope_type": {
                  "type": "string",
                  "enum": [
                    "workspace",
                    "folder",
                    "item"
                  ]
                },
                "scope_id": {
                  "description": "Required for folder and item scopes. Omit for the current workspace.",
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128
                },
                "email": {
                  "type": "string",
                  "maxLength": 320,
                  "format": "email",
                  "pattern": "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"
                },
                "role": {
                  "type": "string",
                  "enum": [
                    "member",
                    "guest",
                    "editor",
                    "viewer"
                  ]
                }
              },
              "required": [
                "scope_type",
                "email",
                "role"
              ],
              "additionalProperties": false
            }
          },
          {
            "name": "revoke_access",
            "description": "Revoke one person's access to the workspace, a folder, or an item. This can change what readers can see. Obtain explicit human confirmation immediately before calling it.",
            "inputSchema": {
              "type": "object",
              "properties": {
                "scope_type": {
                  "type": "string",
                  "enum": [
                    "workspace",
                    "folder",
                    "item"
                  ]
                },
                "scope_id": {
                  "description": "Required for folder and item scopes. Omit for the current workspace.",
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128
                },
                "access_id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128
                }
              },
              "required": [
                "scope_type",
                "access_id"
              ],
              "additionalProperties": false
            }
          }
        ]
        """#

    static let agentToolSpecs: [AgentToolSpec] = {
        do {
            return try JSONDecoder().decode(
                [AgentToolSpec].self, from: Data(agentToolContractJSON.utf8))
        } catch {
            preconditionFailure("Invalid native agent tool contract: \(error)")
        }
    }()

    private let toolCallLock = NSLock()
    private var pendingToolCalls: [String: CheckedContinuation<String, Error>] = [:]
    private var agentToolFailures: [String: String] = [:]

    private func takeToolCall(callId: String) -> CheckedContinuation<String, Error>? {
        toolCallLock.lock()
        defer { toolCallLock.unlock() }
        return pendingToolCalls.removeValue(forKey: callId)
    }

    private func storeToolCall(
        callId: String, continuation: CheckedContinuation<String, Error>
    ) {
        toolCallLock.lock()
        defer { toolCallLock.unlock() }
        pendingToolCalls[callId] = continuation
    }

    fileprivate func recordToolFailure(tag: String, error: Error) {
        toolCallLock.lock()
        defer { toolCallLock.unlock() }
        agentToolFailures[tag] = error.localizedDescription
    }

    private func takeToolFailure(tag: String) -> String? {
        toolCallLock.lock()
        defer { toolCallLock.unlock() }
        return agentToolFailures.removeValue(forKey: tag)
    }

    private func resolveWebToolCall(callId: String, ok: Bool, result: String) {
        guard let continuation = takeToolCall(callId: callId) else { return }
        if ok {
            continuation.resume(returning: result)
        } else {
            continuation.resume(
                throwing: BridgeError(message: result.isEmpty ? "Tool failed" : result))
        }
    }

    /// Forwards one model-initiated tool call into the page and awaits the
    /// page's reply. Fails fast when no executor is registered and times out
    /// so a dead page can never hang a session.
    fileprivate func callWebTool(
        name: String, argsJSON: String, eventTag: String
    ) async throws -> String {
        let callId = UUID().uuidString
        let dispatched: Bool = await MainActor.run { [weak self] in
            guard let self, let webView = self.webView else { return false }
            guard
                let encoded = try? JSONSerialization.data(
                    withJSONObject: [callId, name, argsJSON, eventTag]),
                let args = String(data: encoded, encoding: .utf8)
            else { return false }
            let script = """
                (function (a) {
                  if (!window.__writeNativeAIToolCall) return false;
                  return window.__writeNativeAIToolCall(a[0], a[1], a[2], a[3]) === true;
                })(\(args));
                """
            webView.evaluateJavaScript(script) { [weak self] result, _ in
                if (result as? Bool) != true {
                    self?.resolveWebToolCall(
                        callId: callId, ok: false,
                        result: "The page has no agent tool executor registered.")
                }
            }
            return true
        }
        guard dispatched else {
            throw BridgeError(message: "The web view is gone.")
        }

        // 60s guards content-writing tools (server save round-trips included);
        // the reply path removes the continuation first, so only one side wins.
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 60_000_000_000)
            self?.resolveWebToolCall(
                callId: callId, ok: false, result: "Tool call timed out.")
        }

        return try await withCheckedThrowingContinuation { continuation in
            storeToolCall(callId: callId, continuation: continuation)
        }
    }

    #if canImport(FoundationModels)
        /// A FoundationModels tool whose implementation is the web page.
        @available(macOS 26.0, *)
        private struct WebProxyTool: Tool {
            typealias Arguments = GeneratedContent
            typealias Output = String

            let name: String
            let description: String
            let parameters: GenerationSchema
            let bridge: NativeAIBridge
            let eventTag: String

            init(spec: AgentToolSpec, bridge: NativeAIBridge, eventTag: String) throws {
                self.name = spec.name
                self.description = spec.description
                self.bridge = bridge
                self.eventTag = eventTag
                self.parameters = try spec.makeGenerationSchema()
            }

            func call(arguments: GeneratedContent) async throws -> String {
                let argsJSON = arguments.jsonString
                await bridge.countToolCall(tag: eventTag)
                await bridge.emitAgentEvent(
                    tag: eventTag, event: ["type": "tool", "name": name])
                do {
                    return try await bridge.callWebTool(
                        name: name, argsJSON: argsJSON, eventTag: eventTag)
                } catch {
                    await bridge.recordToolFailure(tag: eventTag, error: error)
                    throw error
                }
            }
        }

        // Tool calls per agent request, keyed by event tag. The small
        // on-device model tends to stop after the first item of a multi-item
        // request; agentOp uses this count to decide whether to run a
        // completion-check turn on the same session.
        private var toolCallCounts: [String: Int] = [:]

        fileprivate func countToolCall(tag: String) {
            toolCallLock.lock()
            defer { toolCallLock.unlock() }
            toolCallCounts[tag, default: 0] += 1
        }

        private func takeToolCallCount(tag: String) -> Int {
            toolCallLock.lock()
            defer { toolCallLock.unlock() }
            return toolCallCounts.removeValue(forKey: tag) ?? 0
        }

        @MainActor
        fileprivate func emitAgentEvent(tag: String, event: [String: Any]) {
            guard let webView,
                  let data = try? JSONSerialization.data(withJSONObject: [tag]),
                  let tagJSON = String(data: data, encoding: .utf8),
                  let eventData = try? JSONSerialization.data(withJSONObject: event),
                  let eventJSON = String(data: eventData, encoding: .utf8)
            else { return }
            webView.evaluateJavaScript(
                "window.__writeNativeAIAgentEvent && window.__writeNativeAIAgentEvent(\(tagJSON)[0], \(eventJSON));",
                completionHandler: nil)
        }

        @available(macOS 26.0, *)
        private func agentOp(_ payload: [String: Any]) async throws -> [String: Any] {
            let model = SystemLanguageModel.default
            if let unavailable = Self.unavailableModelMessage(
                for: model.availability)
            {
                throw BridgeError(message: unavailable)
            }
            NativeModelWarmup.shared.startIfNeeded()
            let (prompt, truncated) = try trimmedText(payload, key: "prompt")
            let eventTag = payload["eventTag"] as? String ?? UUID().uuidString
            let enabled = payload["tools"] as? [String]
            let specs = Self.agentToolSpecs.filter {
                enabled == nil || enabled!.contains($0.name)
            }
            let tools: [any Tool] = try specs.map {
                try WebProxyTool(spec: $0, bridge: self, eventTag: eventTag)
            }

            var instructions =
                payload["instructions"] as? String
                ?? """
                You are the assistant inside Write, a notes and blogging app. \
                Perform the user's request on their workspace with the tools.

                First, silently count how many distinct items the request names. \
                Then call the right tool once for EACH item, one call per item, \
                until every single item is done. A request naming three posts \
                needs three create_item calls. Never stop after the first item. \
                Write real, complete content whenever the user asks for content. \
                Never delete or publish unless the user explicitly asked. When \
                every item is done, reply with one short sentence listing what \
                you did.
                """
            if let context = payload["context"] as? String, !context.isEmpty {
                instructions += "\n\nCurrent context: \(context.prefix(2_000))"
            }

            // No model-judged completion pass: the decomposition instructions
            // above make the first pass complete multi-item requests, and a
            // self-check turn measurably DUPLICATES the last item instead of
            // detecting completion (the page executor also dedupes create_item
            // per request as the deterministic safety net).
            let session = LanguageModelSession(
                model: model, tools: tools, instructions: instructions)
            do {
                let response = try await session.respond(to: prompt)
                _ = takeToolCallCount(tag: eventTag)
                _ = takeToolFailure(tag: eventTag)
                return [
                    "text": response.content.trimmingCharacters(
                        in: .whitespacesAndNewlines),
                    "truncated": truncated,
                ]
            } catch {
                _ = takeToolCallCount(tag: eventTag)
                let message = Self.agentSessionErrorMessage(
                    error,
                    modelAvailability: SystemLanguageModel.default.availability,
                    toolFailure: takeToolFailure(tag: eventTag))
                throw BridgeError(message: message)
            }
        }
    #else
        @MainActor
        fileprivate func emitAgentEvent(tag: String, event: [String: Any]) {}

        private func agentOp(_ payload: [String: Any]) async throws -> [String: Any] {
            throw BridgeError(message: "On-device AI is not in this build.")
        }
    #endif

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
