import Foundation
import XCTest
@testable import TextTextWorkspaceCore

final class TextTextWorkspaceCoreTests: XCTestCase {
    func testMarkdownIdentityRoundTripAndCanonicalHash() throws {
        let serverText = """
        ---
        schema: "texttext.markdown-file.v1"
        title: "Known"
        ---

        Body
        """

        let withIdentity = MarkdownIdentityCodec.inject(
            into: serverText,
            itemId: "post-1",
            folderId: "folder-1",
            kind: "note"
        )

        XCTAssertEqual(
            MarkdownIdentityCodec.extract(from: withIdentity),
            MarkdownIdentity(itemId: "post-1", folderId: "folder-1", kind: "note")
        )
        XCTAssertEqual(MarkdownIdentityCodec.strip(from: withIdentity), serverText)
        XCTAssertEqual(
            MarkdownIdentityCodec.syncHash(for: withIdentity),
            MarkdownIdentityCodec.syncHash(for: serverText)
        )
    }

    func testFolderWatcherReceivesTempDirectoryFileEventWithoutCrashing() throws {
        let root = try fseventsTemporaryDirectory()
        let queue = DispatchQueue(label: "TextTextWorkspaceCoreTests.folder-watcher")
        let fired = DispatchSemaphore(value: 0)
        let watcher = try XCTUnwrap(WorkspaceFolderWatcher(
            path: root.path,
            queue: queue
        ) {
            fired.signal()
        })
        defer { watcher.stop() }
        guard watcher.fseventsStarted else {
            throw XCTSkip("FSEvents stream did not start in this test runner")
        }

        _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.1))
        try Data("hello\n".utf8).write(to: root.appendingPathComponent("event.md"))
        watcher.flush()

        let deadline = Date().addingTimeInterval(5)
        var received = false
        while Date() < deadline {
            if fired.wait(timeout: .now()) == .success {
                received = true
                break
            }
            _ = RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
        }
        XCTAssertTrue(received)
    }

    func testFolderWatcherFiltersCFEventPathsWithoutCrashing() throws {
        let root = try temporaryDirectory()
        let watcher = try XCTUnwrap(WorkspaceFolderWatcher(
            path: root.path,
            queue: DispatchQueue(label: "TextTextWorkspaceCoreTests.cf-event-paths")
        ) {})
        defer { watcher.stop() }

        XCTAssertTrue(watcher.shouldHandleEventPathsForTesting([
            root.appendingPathComponent("Notes/a.md").path
        ]))
        XCTAssertFalse(watcher.shouldHandleEventPathsForTesting([
            root.appendingPathComponent(".texttext/state/index.json").path
        ]))
        XCTAssertFalse(watcher.shouldHandleEventPathsForTesting([
            root.appendingPathComponent(".texttext-local.nosync/recovery/a.md").path
        ]))
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(
                "TextTextWorkspaceCoreTests-\(UUID().uuidString)",
                isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func fseventsTemporaryDirectory() throws -> URL {
        let url = URL(fileURLWithPath: "/private/tmp", isDirectory: true)
            .appendingPathComponent(
                "TextTextWorkspaceCoreTests-\(UUID().uuidString)",
                isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }
}
