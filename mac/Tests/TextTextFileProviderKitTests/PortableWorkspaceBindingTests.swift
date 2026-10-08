import XCTest
@testable import TextTextFileProviderKit

final class PortableWorkspaceBindingTests: XCTestCase {
    private func root() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: url.appendingPathComponent(".texttext"), withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }; return url
    }
    func testSharedPortableContract() throws {
        let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let cases = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: repository.appendingPathComponent("sync/fixtures/workspace-binding.json"))) as? [[String: Any]])
        for value in cases {
            let root = try root(), data = try JSONSerialization.data(withJSONObject: value["marker"]!)
            try data.write(to: root.appendingPathComponent(".texttext/workspace-binding.json"))
            if value["valid"] as? Bool == true {
                let binding = try XCTUnwrap(PortableWorkspaceBinding.read(root: root))
                XCTAssertEqual(binding.origin.absoluteString, "https://texttext.app", value["name"] as! String)
                XCTAssertEqual(binding.workspaceId, "workspace-1")
            } else { XCTAssertThrowsError(try PortableWorkspaceBinding.read(root: root), value["name"] as! String) }
        }
    }
    func testOversizedAndSymlinkMarkersFailClosed() throws {
        let root = try root(), file = root.appendingPathComponent(".texttext/workspace-binding.json")
        try Data(repeating: 32, count: 4097).write(to:file)
        XCTAssertThrowsError(try PortableWorkspaceBinding.read(root:root))
        try FileManager.default.removeItem(at:file)
        let outside = root.appendingPathComponent("outside.json")
        try Data("{}".utf8).write(to:outside)
        try FileManager.default.createSymbolicLink(at:file, withDestinationURL:outside)
        XCTAssertThrowsError(try PortableWorkspaceBinding.read(root:root))
    }
    func testCreationForeignProtectionAndPlaceholder() throws {
        let root = try root(), binding = try LocalVaultSyncBinding(origin: URL(string:"https://texttext.app/")!, workspaceId:"workspace-1")
        try PortableWorkspaceBinding.bindVerified(root: root, binding: binding)
        let file = root.appendingPathComponent(".texttext/workspace-binding.json"), original = try Data(contentsOf:file)
        try PortableWorkspaceBinding.bindVerified(root: root, binding: binding)
        XCTAssertThrowsError(try PortableWorkspaceBinding.bindVerified(root: root, binding: LocalVaultSyncBinding(origin: binding.origin, workspaceId:"other")))
        XCTAssertEqual(try Data(contentsOf:file), original)
        let evicted = try self.root(); try Data().write(to:evicted.appendingPathComponent(".texttext/.workspace-binding.json.icloud"))
        XCTAssertThrowsError(try PortableWorkspaceBinding.bindVerified(root:evicted,binding:binding))
        XCTAssertFalse(FileManager.default.fileExists(atPath:evicted.appendingPathComponent(".texttext/workspace-binding.json").path))
    }
}
