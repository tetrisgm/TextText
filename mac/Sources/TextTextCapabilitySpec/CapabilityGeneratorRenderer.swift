import Foundation

public struct GeneratedCapabilityFile: Equatable, Sendable {
    public var relativePath: String
    public var contents: String

    public init(relativePath: String, contents: String) {
        self.relativePath = relativePath
        self.contents = contents
    }
}

public enum CapabilityGeneratorRenderer {
    public static let canonicalCommand =
        "swift run --package-path mac capability-generator --manifest mac/Resources/AppCapabilities.yaml --output-root ."

    public static func renderOutputs(
        manifest: CapabilityManifest,
        command: String = canonicalCommand
    ) -> [GeneratedCapabilityFile] {
        [
            GeneratedCapabilityFile(
                relativePath: "mac/Sources/TextTextAppIntents/Generated/CapabilityIdentifiers.swift",
                contents: renderIdentifiers(manifest: manifest, command: command)
            ),
            GeneratedCapabilityFile(
                relativePath: "mac/Sources/TextTextAppIntents/Generated/CapabilityCatalog.swift",
                contents: renderCatalog(manifest: manifest, command: command)
            ),
            GeneratedCapabilityFile(
                relativePath: "docs/AppCapabilities.md",
                contents: renderDocumentation(manifest: manifest, command: command)
            ),
            GeneratedCapabilityFile(
                relativePath: "mac/Tests/TextTextAppIntentsTests/GeneratedCapabilityTests.swift",
                contents: renderGeneratedTests(manifest: manifest, command: command)
            ),
        ]
    }

    public static func renderIdentifiers(manifest: CapabilityManifest, command: String) -> String {
        var lines = header(command: command, comment: "//")
        lines.append("public enum CapabilityIdentifiers {")
        lines.append("    public static let manifestVersion = \(manifest.version)")
        lines.append("")
        lines.append("    public enum Entities {")
        for entity in manifest.entities {
            lines.append("        public static let \(swiftIdentifier(entity.id)) = \(swiftString(entity.id))")
        }
        lines.append("    }")
        lines.append("")
        lines.append("    public enum Intents {")
        for intent in manifest.intents {
            lines.append("        public static let \(swiftIdentifier(intent.id)) = \(swiftString(intent.id))")
        }
        lines.append("    }")
        lines.append("}")
        return lines.joined(separator: "\n") + "\n"
    }

    public static func renderCatalog(manifest: CapabilityManifest, command: String) -> String {
        var lines = header(command: command, comment: "//")
        lines.append("import AppIntents")
        lines.append("")
        lines.append("public struct CapabilityEntityDescriptor: Equatable, Sendable {")
        lines.append("    public var id: String")
        lines.append("    public var displayName: String")
        lines.append("    public var doc: String")
        lines.append("}")
        lines.append("")
        lines.append("public struct CapabilityParameterDescriptor: Equatable, Sendable {")
        lines.append("    public var id: String")
        lines.append("    public var type: String")
        lines.append("    public var displayName: String")
        lines.append("    public var required: Bool")
        lines.append("    public var doc: String")
        lines.append("}")
        lines.append("")
        lines.append("public struct CapabilityIntentDescriptor: Equatable, Sendable {")
        lines.append("    public var id: String")
        lines.append("    public var displayName: String")
        lines.append("    public var implementation: String")
        lines.append("    public var availability: String")
        lines.append("    public var result: String")
        lines.append("    public var doc: String")
        lines.append("    public var parameters: [CapabilityParameterDescriptor]")
        lines.append("}")
        lines.append("")
        lines.append("public enum CapabilityCatalog {")
        lines.append("    public static let entities: [CapabilityEntityDescriptor] = [")
        for entity in manifest.entities {
            lines.append("        CapabilityEntityDescriptor(id: \(swiftString(entity.id)), displayName: \(swiftString(entity.displayName)), doc: \(swiftString(entity.doc))),")
        }
        lines.append("    ]")
        lines.append("")
        lines.append("    public static let intents: [CapabilityIntentDescriptor] = [")
        for intent in manifest.intents {
            lines.append("        CapabilityIntentDescriptor(")
            lines.append("            id: \(swiftString(intent.id)),")
            lines.append("            displayName: \(swiftString(intent.displayName)),")
            lines.append("            implementation: \(swiftString(intent.implementation)),")
            lines.append("            availability: \(swiftString(intent.availability)),")
            lines.append("            result: \(swiftString(intent.result)),")
            lines.append("            doc: \(swiftString(intent.doc)),")
            lines.append("            parameters: [")
            for parameter in intent.parameters {
                lines.append("                CapabilityParameterDescriptor(id: \(swiftString(parameter.id)), type: \(swiftString(parameter.type)), displayName: \(swiftString(parameter.displayName)), required: \(parameter.required), doc: \(swiftString(parameter.doc))),")
            }
            lines.append("            ]")
            lines.append("        ),")
        }
        lines.append("    ]")
        lines.append("")
        lines.append("    @available(macOS 13.0, *)")
        lines.append("    public static let intentImplementations: [String: any AppIntent.Type] = [")
        for intent in manifest.intents {
            lines.append("        \(swiftString(intent.id)): \(intent.implementation).self,")
        }
        lines.append("    ]")
        lines.append("")
        lines.append("    @available(macOS 13.0, *)")
        lines.append("    public static var missingImplementationIdentifiers: [String] {")
        lines.append("        intents.map(\\.id).filter { intentImplementations[$0] == nil }")
        lines.append("    }")
        lines.append("}")
        return lines.joined(separator: "\n") + "\n"
    }

    public static func renderDocumentation(manifest: CapabilityManifest, command: String) -> String {
        var lines = header(command: command, comment: "<!--", closeComment: " -->")
        lines.append("# App Capabilities")
        lines.append("")
        lines.append("Manifest version: \(manifest.version)")
        lines.append("")
        lines.append("## Entities")
        lines.append("")
        lines.append("| Entity | Display name | Documentation |")
        lines.append("| --- | --- | --- |")
        for entity in manifest.entities {
            lines.append("| \(markdown(entity.id)) | \(markdown(entity.displayName)) | \(markdown(entity.doc)) |")
        }
        lines.append("")
        lines.append("## Intents")
        lines.append("")
        for intent in manifest.intents {
            lines.append("### \(intent.displayName)")
            lines.append("")
            lines.append("- Identifier: `\(intent.id)`")
            lines.append("- Implementation: `\(intent.implementation)`")
            lines.append("- Availability: \(intent.availability)")
            lines.append("- Result: `\(intent.result)`")
            lines.append("- Documentation: \(intent.doc)")
            lines.append("")
            lines.append("| Parameter | Type | Required | Documentation |")
            lines.append("| --- | --- | --- | --- |")
            for parameter in intent.parameters {
                lines.append("| `\(markdown(parameter.id))` | `\(markdown(parameter.type))` | \(parameter.required ? "yes" : "no") | \(markdown(parameter.doc)) |")
            }
            lines.append("")
        }
        return lines.joined(separator: "\n")
    }

    public static func renderGeneratedTests(manifest: CapabilityManifest, command: String) -> String {
        var lines = header(command: command, comment: "//")
        lines.append("import XCTest")
        lines.append("@testable import TextTextAppIntents")
        lines.append("")
        lines.append("final class GeneratedCapabilityTests: XCTestCase {")
        lines.append("    func testDeclaredIntentImplementationsAreRegistered() throws {")
        lines.append("        if #available(macOS 13.0, *) {")
        lines.append("            XCTAssertEqual(CapabilityCatalog.missingImplementationIdentifiers, [])")
        lines.append("        }")
        lines.append("    }")
        lines.append("")
        lines.append("    func testManifestCountsMatchGeneratedCatalog() throws {")
        lines.append("        XCTAssertEqual(CapabilityCatalog.entities.count, \(manifest.entities.count))")
        lines.append("        XCTAssertEqual(CapabilityCatalog.intents.count, \(manifest.intents.count))")
        lines.append("    }")
        lines.append("}")
        return lines.joined(separator: "\n") + "\n"
    }

    private static func header(command: String, comment: String, closeComment: String = "") -> [String] {
        [
            "\(comment) Generated by: \(command)\(closeComment)",
            "\(comment) Do not edit by hand.\(closeComment)",
            "",
        ]
    }

    private static func swiftIdentifier(_ value: String) -> String {
        let pieces = value
            .split { !$0.isLetter && !$0.isNumber }
            .map(String.init)
        guard let first = pieces.first else { return "value" }
        let rest = pieces.dropFirst().map { $0.prefix(1).uppercased() + $0.dropFirst() }
        let joined = ([first.prefix(1).lowercased() + first.dropFirst()] + rest).joined()
        if joined.first?.isNumber == true { return "value\(joined)" }
        return joined
    }

    private static func swiftString(_ value: String) -> String {
        guard let data = try? JSONEncoder().encode(value),
              let text = String(data: data, encoding: .utf8) else {
            return "\"\(value.replacingOccurrences(of: "\"", with: "\\\""))\""
        }
        return text
    }

    private static func markdown(_ value: String) -> String {
        value
            .replacingOccurrences(of: "|", with: "\\|")
            .replacingOccurrences(of: "\n", with: " ")
    }
}
