import Foundation
import XCTest
@testable import TextTextCLICore

final class CLILocalStateTests: XCTestCase {
    private var temporary: URL!
    override func setUpWithError() throws {
        temporary = FileManager.default.temporaryDirectory.appendingPathComponent("cli-private-state-" + UUID().uuidString).resolvingSymlinksInPath()
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: temporary) }
    func testPrivateBaseCannotEnterWorkspaceOrProviderRoot() throws {
        let workspace = temporary.appendingPathComponent("Workspace")
        try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: false)
        let base = try CLILocalState.baseDirectory(root: workspace, environment: [:], applicationSupportDirectory: temporary.appendingPathComponent("Support"))
        XCTAssertFalse(base.path.hasPrefix(workspace.path + "/"))
        XCTAssertEqual(base.lastPathComponent, "CLI")
        XCTAssertThrowsError(try CLILocalState.baseDirectory(root: workspace, environment: ["TEXTTEXT_STATE_DIR": workspace.path]))
        let provider = temporary.appendingPathComponent("Mobile Documents/Private")
        XCTAssertThrowsError(try CLILocalState.baseDirectory(root: workspace, environment: ["TEXTTEXT_STATE_DIR": provider.path]))
    }
    func testUnknownRootAndNestedLegacyGuardsRefuseWithoutMigration() throws {
        for relative in [".texttext/future-private-state", "Notes/.texttext/cli-creations", "Notes/.texttext-replacements"] {
            let workspace = temporary.appendingPathComponent(UUID().uuidString)
            let state = workspace.appendingPathComponent(relative)
            try FileManager.default.createDirectory(at: state, withIntermediateDirectories: true)
            let bytes = state.appendingPathComponent("keep.bin")
            try Data([0, 255, 4]).write(to: bytes)
            XCTAssertThrowsError(try CLILocalState.requireNoLegacyGuards(root: workspace))
            XCTAssertEqual(try Data(contentsOf: bytes), Data([0, 255, 4]))
        }
    }
    func testPortableBindingAndRecoveryCopiesAreNotPrivateAuthority() throws {
        let workspace = temporary.appendingPathComponent("Workspace")
        try FileManager.default.createDirectory(at: workspace.appendingPathComponent("Notes/.texttext/history"), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: workspace.appendingPathComponent(".texttext/conflicts"), withIntermediateDirectories: true)
        try Data("{}".utf8).write(to: workspace.appendingPathComponent(".texttext/workspace-binding.json"))
        XCTAssertNoThrow(try CLILocalState.requireNoLegacyGuards(root: workspace))
    }
    func testSymlinkedLegacyMetadataAndPrivateBaseRefuse() throws {
        let workspace = temporary.appendingPathComponent("Workspace"), outside = temporary.appendingPathComponent("Outside")
        try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: false)
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: false)
        try FileManager.default.createSymbolicLink(at: workspace.appendingPathComponent(".texttext"), withDestinationURL: outside)
        XCTAssertThrowsError(try CLILocalState.requireNoLegacyGuards(root: workspace))
        let alias = temporary.appendingPathComponent("Alias")
        try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: outside)
        XCTAssertThrowsError(try CLILocalState.baseDirectory(root: workspace, environment: ["TEXTTEXT_STATE_DIR": alias.path]))
    }
}
