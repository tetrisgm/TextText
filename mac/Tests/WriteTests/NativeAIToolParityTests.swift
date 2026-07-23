import Foundation
import XCTest
@testable import Write

#if canImport(FoundationModels)
    import FoundationModels
#endif

final class NativeAIToolParityTests: XCTestCase {
    private let expectedNames = [
        "get_workspace",
        "list_folders",
        "list_items",
        "read_item",
        "search",
        "list_trash",
        "list_comments",
        "list_access",
        "list_document_templates",
        "customize_document_template",
        "set_item_template",
        "create_item",
        "update_item",
        "append_to_item",
        "set_item_status",
        "move_item",
        "delete_item",
        "restore_item",
        "add_item_asset",
        "remove_item_asset",
        "recapture_bookmark",
        "add_comment",
        "set_comment_resolved",
        "create_folder",
        "rename_folder",
        "delete_folder",
        "restore_folder",
        "set_access",
        "revoke_access",
    ]

    func testNativeAgentExposesOnlyTheSafeWorkspaceToolSurface() {
        let names = NativeAIBridge.agentToolSpecs.map(\.name)

        XCTAssertEqual(names, expectedNames)
        XCTAssertEqual(Set(names).count, names.count)
        XCTAssertFalse(names.contains { $0.contains("permanent") })
        XCTAssertFalse(names.contains { $0.contains("member") })
    }

    #if canImport(FoundationModels)
        @available(macOS 26.0, *)
        func testAgentChecksEveryUnavailableModelReasonWithHelpfulCopy() {
            let disabled = NativeAIBridge.unavailableModelMessage(
                for: .unavailable(.appleIntelligenceNotEnabled))
            let downloading = NativeAIBridge.unavailableModelMessage(
                for: .unavailable(.modelNotReady))
            let ineligible = NativeAIBridge.unavailableModelMessage(
                for: .unavailable(.deviceNotEligible))

            XCTAssertNil(NativeAIBridge.unavailableModelMessage(for: .available))
            XCTAssertTrue(disabled?.contains("Enable it in System Settings") == true)
            XCTAssertTrue(downloading?.contains("macOS is preparing") == true)
            XCTAssertTrue(ineligible?.contains("does not support") == true)
            XCTAssertTrue(disabled?.contains("cloud AI key") == true)
        }

        @available(macOS 26.0, *)
        func testToolFailureWinsOverMisleadingModelAssetError() {
            let frameworkError = LanguageModelSession.GenerationError.assetsUnavailable(
                .init(debugDescription: "Resource (Local Model Asset) unavailable error."))
            let toolMessage = NativeAIBridge.agentSessionErrorMessage(
                frameworkError,
                modelAvailability: .available,
                toolFailure: "No folder at path ideas")
            let modelMessage = NativeAIBridge.agentSessionErrorMessage(
                frameworkError,
                modelAvailability: .available)

            XCTAssertEqual(toolMessage, "No folder at path ideas")
            XCTAssertFalse(modelMessage.contains("Local Model Asset"))
            XCTAssertFalse(modelMessage.localizedCaseInsensitiveContains(
                "model is unavailable"))
        }

        @available(macOS 26.0, *)
        func testEveryNativeToolBuildsAFoundationModelsSchema() throws {
            for spec in NativeAIBridge.agentToolSpecs {
                FileHandle.standardError.write(
                    Data("Building native schema: \(spec.name)\n".utf8))
                _ = try spec.makeGenerationSchema()
            }
        }

        @available(macOS 26.4, *)
        func testNativeToolSchemasLeaveRegexValidationToTheCommandLayer() throws {
            let update = try generatedJSON(for: "update_item")
            XCTAssertNil(try resolvedProperty("accent", in: update)["pattern"])
            XCTAssertNil(try resolvedProperty("date", in: update)["pattern"])

            let access = try generatedJSON(for: "set_access")
            XCTAssertNil(try resolvedProperty("email", in: access)["pattern"])
        }

        @available(macOS 26.4, *)
        func testGeneratedSchemasPreserveBooleanIntegerEnumAndNullableTypes() throws {
            let pinned = try generatedJSON(for: "update_item")
            XCTAssertEqual(property("pinned", in: pinned)["type"] as? String, "boolean")
            XCTAssertEqual(required(in: pinned), ["id"])

            let listItems = try generatedJSON(for: "list_items")
            let limit = property("limit", in: listItems)
            XCTAssertEqual(limit["type"] as? String, "integer")
            XCTAssertEqual(limit["minimum"] as? Int, 1)
            XCTAssertEqual(limit["maximum"] as? Int, 100)
            XCTAssertFalse(required(in: listItems).contains("limit"))

            let status = try resolvedProperty("status", in: generatedJSON(
                for: "set_item_status"))
            XCTAssertEqual(status["enum"] as? [String], ["draft", "published"])

            let metadata = try generatedJSON(for: "update_item")
            let coverHeight = try resolvedProperty("cover_height", in: metadata)
            let variants = try XCTUnwrap(coverHeight["anyOf"] as? [[String: Any]])
            XCTAssertTrue(variants.contains { $0["type"] as? String == "integer" })
            XCTAssertTrue(variants.contains { $0["type"] as? String == "null" })
        }

        @available(macOS 26.0, *)
        private func generatedJSON(for name: String) throws -> [String: Any] {
            let spec = try XCTUnwrap(
                NativeAIBridge.agentToolSpecs.first { $0.name == name })
            let data = try JSONEncoder().encode(spec.makeGenerationSchema())
            return try XCTUnwrap(
                JSONSerialization.jsonObject(with: data) as? [String: Any])
        }

        private func property(_ name: String, in schema: [String: Any])
            -> [String: Any]
        {
            let properties = schema["properties"] as? [String: [String: Any]]
            return properties?[name] ?? [:]
        }

        private func required(in schema: [String: Any]) -> [String] {
            (schema["required"] as? [String] ?? []).sorted()
        }

        private func resolvedProperty(_ name: String, in schema: [String: Any]) throws
            -> [String: Any]
        {
            let value = property(name, in: schema)
            guard let reference = value["$ref"] as? String else { return value }
            let definitionName = try XCTUnwrap(reference.split(separator: "/").last)
            let definitions = try XCTUnwrap(
                schema["$defs"] as? [String: [String: Any]])
            return try XCTUnwrap(definitions[String(definitionName)])
        }
    #endif
}
