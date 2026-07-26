import Foundation
import XCTest
@testable import Write

#if canImport(FoundationModels)
    import FoundationModels

    private final class NativeAIIntegrationProbeRecorder: @unchecked Sendable {
        private let lock = NSLock()
        private var names: [String] = []

        func record(_ name: String) {
            lock.lock()
            names.append(name)
            lock.unlock()
        }

        func recordedNames() -> [String] {
            lock.lock()
            defer { lock.unlock() }
            return names
        }
    }

    @available(macOS 26.0, *)
    private struct NativeAIIntegrationProbeTool: Tool {
        typealias Arguments = GeneratedContent
        typealias Output = String

        let name: String
        let description: String
        let parameters: GenerationSchema
        let recorder: NativeAIIntegrationProbeRecorder

        init(
            spec: NativeAIBridge.AgentToolSpec,
            recorder: NativeAIIntegrationProbeRecorder
        ) throws {
            name = spec.name
            description = spec.description
            parameters = try spec.makeGenerationSchema()
            self.recorder = recorder
        }

        func call(arguments: GeneratedContent) async throws -> String {
            recorder.record(name)
            return "{\"ok\":true}"
        }
    }
#endif

final class NativeAIIntegrationProbeTests: XCTestCase {
    #if canImport(FoundationModels)
        @available(macOS 26.0, *)
        @MainActor
        func testLiveAgentToolSession() async throws {
            guard ProcessInfo.processInfo.environment["WRITE_LIVE_AI_PROBE"] == "1"
            else { throw XCTSkip("Set WRITE_LIVE_AI_PROBE=1 to run") }

            let recorder = NativeAIIntegrationProbeRecorder()
            let requestedSpecs = NativeAIBridge.agentToolSpecs.filter {
                $0.name == "update_item"
            }
            XCTAssertEqual(requestedSpecs.map(\.name), ["update_item"])
            let tools: [any Tool] = try requestedSpecs.map {
                try NativeAIIntegrationProbeTool(spec: $0, recorder: recorder)
            }
            let session = LanguageModelSession(
                model: .default,
                tools: tools,
                instructions:
                    "Use the update_item tool exactly once as requested. Then reply Done."
            )
            do {
                _ = try await session.respond(
                    to: "Set the title of item post-1 to A funny title."
                )
                let names = recorder.recordedNames()
                XCTAssertTrue(names.contains("update_item"), "recorded tools: \(names)")
            } catch {
                XCTFail(
                    "type=\(String(reflecting: type(of: error))) error=\(String(reflecting: error))"
                )
            }
        }
    #endif
}
