import Foundation
import XCTest
@testable import TextTextCapabilitySpec

final class CapabilityManifestTests: XCTestCase {
    func testManifestParsesAndRoundTrips() throws {
        let manifest = try loadManifest()

        XCTAssertEqual(manifest.entities.map(\.id), ["Document", "Folder", "Blog", "Publication", "Bookmark"])
        XCTAssertEqual(manifest.intents.count, 10)
        XCTAssertEqual(manifest.intents.first?.id, "createDocument")
        XCTAssertEqual(manifest.intents.last?.id, "getRecentDocuments")

        let rendered = CapabilityManifestYAML.render(manifest)
        let reparsed = try CapabilityManifestYAML.parse(rendered)
        XCTAssertEqual(reparsed, manifest)
    }

    func testGeneratorOutputsMatchCommittedFiles() throws {
        let manifest = try loadManifest()
        let root = repoRoot()
        let outputs = CapabilityGeneratorRenderer.renderOutputs(manifest: manifest)
        XCTAssertFalse(outputs.isEmpty)

        for output in outputs {
            let url = root.appendingPathComponent(output.relativePath)
            let committed = try String(contentsOf: url, encoding: .utf8)
            XCTAssertEqual(committed, output.contents, output.relativePath)
        }
    }

    private func loadManifest() throws -> CapabilityManifest {
        let url = repoRoot().appendingPathComponent("mac/Resources/AppCapabilities.yaml")
        return try CapabilityManifestYAML.parse(String(contentsOf: url, encoding: .utf8))
    }

    private func repoRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }
}
