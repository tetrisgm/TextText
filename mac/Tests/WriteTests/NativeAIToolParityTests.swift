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
        "create_folder",
        "rename_folder",
        "list_items",
        "list_trash",
        "read_item",
        "search",
        "create_item",
        "update_item",
        "append_to_item",
        "move_item",
        "delete_item",
        "restore_item",
        "set_item_status",
        "set_item_metadata",
        "set_item_pinned",
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
        func testEveryNativeToolBuildsAFoundationModelsSchema() throws {
            for spec in NativeAIBridge.agentToolSpecs {
                _ = try spec.makeGenerationSchema()
            }
        }

        @available(macOS 26.4, *)
        func testGeneratedSchemasPreserveBooleanIntegerEnumAndNullableTypes() throws {
            let pinned = try generatedJSON(for: "set_item_pinned")
            XCTAssertEqual(property("pinned", in: pinned)["type"] as? String, "boolean")
            XCTAssertEqual(required(in: pinned), ["id", "pinned"])

            let listItems = try generatedJSON(for: "list_items")
            let limit = property("limit", in: listItems)
            XCTAssertEqual(limit["type"] as? String, "integer")
            XCTAssertEqual(limit["minimum"] as? Int, 1)
            XCTAssertEqual(limit["maximum"] as? Int, 100)
            XCTAssertFalse(required(in: listItems).contains("limit"))

            let status = try resolvedProperty("status", in: generatedJSON(
                for: "set_item_status"))
            XCTAssertEqual(status["enum"] as? [String], ["draft", "published"])

            let metadata = try generatedJSON(for: "set_item_metadata")
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
