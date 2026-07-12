import XCTest
import FileProvider
import UniformTypeIdentifiers
@testable import WriteFileProviderBridge
@testable import WriteFileProviderKit

/// A do-nothing API, only so `WorkspaceEnumerator.rootItem()` (which is
/// synchronous and never touches the network) can be exercised here.
private struct StubAPI: WriteSyncAPI {
    func workspace() async -> Result<WriteWorkspace, WriteSyncError> { .failure(.notFound) }
    func manifest(folderId: String) async -> Result<[WriteManifestItem], WriteSyncError> { .success([]) }
    func fileText(postId: String) async -> Result<WriteFileContent, WriteSyncError> { .failure(.notFound) }
    func changes(since cursor: String?, wait: Int) async -> Result<WriteChangeReply, WriteSyncError> {
        .success(WriteChangeReply(cursor: "c0", changed: false))
    }
    func createFile(body: String, folderId: String?) async -> Result<WriteManifestItem, WriteSyncError> { .failure(.conflict) }
    func putFile(postId: String, body: String, ifMatch hash: String) async -> Result<WriteManifestItem, WriteSyncError> { .failure(.conflict) }
    func patchFile(postId: String, folderId: String?, slug: String?) async -> Result<WriteManifestItem, WriteSyncError> { .failure(.conflict) }
    func deleteFile(postId: String) async -> Result<Void, WriteSyncError> { .success(()) }
    func createFolder(parentPath: String, name: String) async -> Result<WriteWorkspaceFolder, WriteSyncError> { .failure(.conflict) }
    func renameFolder(folderId: String, name: String) async -> Result<WriteWorkspaceFolder, WriteSyncError> { .failure(.conflict) }
}

final class BridgeTests: XCTestCase {

    // MARK: helpers (self-contained; do not borrow the kit test fixtures)

    private func manifestEntry(hash: String = "abc123") -> WriteManifestItem {
        WriteManifestItem(
            file: "hello.md", kind: "article", slug: "hello", title: "Hello",
            status: "draft", hash: hash, id: "p1", date: nil,
            createdAt: "2026-07-01T09:00:00Z", updatedAt: "2026-07-11T10:00:00Z", url: nil)
    }

    private func fileItem(readOnly: Bool = true, hash: String = "abc123") -> WriteItem {
        WriteItemMapper.item(for: manifestEntry(hash: hash), inFolder: "blog", readOnly: readOnly)!
    }

    private func folderItem() -> WriteItem {
        let folder = WriteWorkspaceFolder(
            id: "blog", name: "Blog", path: "Blog", mode: "blog", parentId: nil)
        return WriteItemMapper.item(for: folder, readOnly: true)
    }

    // MARK: Identifier bridging

    func testReservedIdentifiersBridgeToApplesConstants() {
        XCTAssertEqual(NSFileProviderItemIdentifier(WriteItemIdentifier.rootContainer), .rootContainer)
        XCTAssertEqual(NSFileProviderItemIdentifier(WriteItemIdentifier.workingSet), .workingSet)
        XCTAssertEqual(NSFileProviderItemIdentifier(WriteItemIdentifier.trashContainer), .trashContainer)
    }

    func testFolderAndFileIdentifierBridgeRoundTrip() {
        for id in [WriteItemIdentifier.folder("blog"), .file("p1")] {
            let ns = NSFileProviderItemIdentifier(id)
            XCTAssertEqual(WriteItemIdentifier(ns), id)
        }
    }

    func testReservedFrameworkIdentifierBridgesBack() {
        XCTAssertEqual(WriteItemIdentifier(.rootContainer), .rootContainer)
        XCTAssertEqual(WriteItemIdentifier(.workingSet), .workingSet)
        XCTAssertEqual(WriteItemIdentifier(.trashContainer), .trashContainer)
    }

    // MARK: Capabilities bridging

    func testReadOnlyFileCapabilities() {
        let ns = nsCapabilities(from: .readOnlyFile)
        XCTAssertTrue(ns.contains(.allowsReading))
        XCTAssertFalse(ns.contains(.allowsWriting))
        XCTAssertFalse(ns.contains(.allowsDeleting))
    }

    func testWritableFileCapabilities() {
        let caps: WriteItemCapabilities = [.reading, .writing, .renaming, .deleting, .reparenting]
        let ns = nsCapabilities(from: caps)
        XCTAssertTrue(ns.contains(.allowsReading))
        XCTAssertTrue(ns.contains(.allowsWriting))
        XCTAssertTrue(ns.contains(.allowsRenaming))
        XCTAssertTrue(ns.contains(.allowsDeleting))
        XCTAssertTrue(ns.contains(.allowsReparenting))
    }

    func testFolderCapabilities() {
        let ns = nsCapabilities(from: .readOnlyFolder)
        XCTAssertTrue(ns.contains(.allowsContentEnumerating))
        // Note: .allowsContentEnumerating and .allowsReading are the SAME bit
        // (1), so containment of reading is not a meaningful distinction here.
        // What matters is that a read-only folder cannot gain sub-items, which
        // is a genuinely distinct bit (2 == .allowsWriting).
        XCTAssertFalse(ns.contains(.allowsAddingSubItems))
    }

    func testCapabilityBitAliasingIsHandled() {
        // Apple aliases reading<->contentEnumerating (bit 1) and
        // writing<->addingSubItems (bit 2). The kit models them as distinct
        // semantic flags; the bridge must still land on the right bits.
        let full: WriteItemCapabilities = [.contentEnumerating, .addingSubItems]
        let ns = nsCapabilities(from: full)
        XCTAssertTrue(ns.contains(.allowsContentEnumerating))
        XCTAssertTrue(ns.contains(.allowsAddingSubItems))
    }

    // MARK: Item adapter

    func testFileItemMapsToNSFileProviderItem() {
        let item = WriteFileProviderItem(fileItem())
        XCTAssertEqual(item.itemIdentifier, NSFileProviderItemIdentifier(rawValue: "file:p1"))
        XCTAssertEqual(item.parentItemIdentifier, NSFileProviderItemIdentifier(rawValue: "folder:blog"))
        XCTAssertEqual(item.filename, "hello.md")
        XCTAssertEqual(item.contentType, UTType("net.daringfireball.markdown"))
        XCTAssertTrue(item.capabilities.contains(.allowsReading))
    }

    func testFolderItemIsAFolderType() {
        let item = WriteFileProviderItem(folderItem())
        XCTAssertEqual(item.contentType, .folder)
        XCTAssertEqual(item.filename, "Blog")
        XCTAssertTrue(item.capabilities.contains(.allowsContentEnumerating))
    }

    func testFileVersionTracksContentHash() {
        let a = WriteFileProviderItem(fileItem(hash: "abc123"))
        let b = WriteFileProviderItem(fileItem(hash: "DIFFERENT"))
        XCTAssertNotEqual(
            a.itemVersion.contentVersion, b.itemVersion.contentVersion,
            "a new server hash must produce a new content version so the framework re-fetches")
    }

    func testVersionFieldsAreNonEmptyAndSmall() {
        for wi in [fileItem(), folderItem()] {
            let v = WriteFileProviderItem(wi).itemVersion
            XCTAssertFalse(v.contentVersion.isEmpty)
            XCTAssertFalse(v.metadataVersion.isEmpty)
            XCTAssertLessThanOrEqual(v.contentVersion.count, 128)
            XCTAssertLessThanOrEqual(v.metadataVersion.count, 128)
        }
    }

    func testRootItemBridges() {
        let e = WorkspaceEnumerator(api: StubAPI(), domainName: "Write")
        let root = WriteFileProviderItem(e.rootItem())
        XCTAssertEqual(root.itemIdentifier, .rootContainer)
        XCTAssertEqual(root.parentItemIdentifier, .rootContainer)
        XCTAssertEqual(root.filename, "Write")
        XCTAssertEqual(root.contentType, .folder)
    }
}
