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
    func createFile(body: String, folderId: String?, idempotencyKey: String?) async -> Result<WriteManifestItem, WriteSyncError> { .failure(.conflict) }
    func createFile(body: String, folderId: String?, representation: WriteFileRepresentation, idempotencyKey: String?) async -> Result<WriteManifestItem, WriteSyncError> { .failure(.conflict) }
    func putFile(postId: String, body: String, ifMatch hash: String) async -> Result<WriteManifestItem, WriteSyncError> { .failure(.conflict) }
    func patchFile(postId: String, folderId: String?, slug: String?, title: String?, ifMatch hash: String?) async -> Result<WriteManifestItem, WriteSyncError> { .failure(.conflict) }
    func deleteFile(postId: String, ifMatch hash: String?) async -> Result<Void, WriteSyncError> { .success(()) }
    func createFolder(parentPath: String, name: String, idempotencyKey: String?) async -> Result<WriteWorkspaceFolder, WriteSyncError> { .failure(.conflict) }
    func renameFolder(folderId: String, name: String) async -> Result<WriteWorkspaceFolder, WriteSyncError> { .failure(.conflict) }
    func renameWorkspace(name: String) async -> Result<WriteWorkspaceBlog, WriteSyncError> { .failure(.conflict) }
}

final class BridgeTests: XCTestCase {

    // MARK: helpers (self-contained; do not borrow the kit test fixtures)

    private func manifestEntry(
        hash: String = "abc123", url: String? = "https://write.example/item/p1",
        representation: WriteFileRepresentation = .markdown
    ) -> WriteManifestItem {
        WriteManifestItem(
            file: "hello" + representation.filenameSuffix,
            representation: representation, kind: "article", slug: "hello", title: "Hello",
            status: "draft", hash: hash, id: "p1", date: nil,
            createdAt: "2026-07-01T09:00:00Z", updatedAt: "2026-07-11T10:00:00Z", url: url)
    }

    private func fileItem(
        readOnly: Bool = true, hash: String = "abc123",
        representation: WriteFileRepresentation = .markdown
    ) -> WriteItem {
        WriteItemMapper.item(
            for: manifestEntry(hash: hash, representation: representation),
            inFolder: "blog", handle: "demo", readOnly: readOnly)!
    }

    private func folderItem() -> WriteItem {
        let folder = WriteWorkspaceFolder(
            id: "blog", name: "Blog", path: "Blog", mode: "blog", parentId: nil)
        return WriteItemMapper.item(for: folder, handle: "demo", readOnly: true)
    }

    // MARK: Identifier bridging

    func testReservedIdentifiersBridgeToApplesConstants() {
        XCTAssertEqual(NSFileProviderItemIdentifier(WriteItemIdentifier.rootContainer), .rootContainer)
        XCTAssertEqual(NSFileProviderItemIdentifier(WriteItemIdentifier.workingSet), .workingSet)
        XCTAssertEqual(NSFileProviderItemIdentifier(WriteItemIdentifier.trashContainer), .trashContainer)
    }

    func testFolderAndFileIdentifierBridgeRoundTrip() {
        for id in [WriteItemIdentifier.folder(handle: "demo", id: "blog"), .file(handle: "demo", id: "p1")] {
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
        XCTAssertEqual(item.itemIdentifier, NSFileProviderItemIdentifier(rawValue: "file:demo:p1"))
        XCTAssertEqual(item.parentItemIdentifier, NSFileProviderItemIdentifier(rawValue: "folder:demo:blog"))
        XCTAssertEqual(item.filename, "Hello.md") // the TITLE, not the slug
        XCTAssertEqual(item.contentType, UTType("net.daringfireball.markdown"))
        XCTAssertTrue(item.capabilities.contains(.allowsReading))
    }

    func testRepresentationMapsToNativeContentType() {
        let markdown = WriteFileProviderItem(fileItem(representation: .markdown))
        XCTAssertEqual(markdown.filename, "Hello.md")
        XCTAssertEqual(markdown.contentType.identifier, WriteItem.markdownTypeIdentifier)

        let text = WriteFileProviderItem(fileItem(representation: .text))
        XCTAssertEqual(text.filename, "Hello.txt")
        XCTAssertEqual(text.contentType, .plainText)

        let textbundle = WriteFileProviderItem(fileItem(representation: .textbundle))
        XCTAssertEqual(textbundle.filename, "Hello.textbundle")
        XCTAssertEqual(textbundle.contentType.identifier, WriteItem.textBundleTypeIdentifier)
        XCTAssertTrue(textbundle.contentType.conforms(to: .package))
    }

    func testFolderItemIsAFolderType() {
        let item = WriteFileProviderItem(folderItem())
        XCTAssertEqual(item.contentType, .folder)
        XCTAssertEqual(item.filename, "Blog")
        XCTAssertTrue(item.capabilities.contains(.allowsContentEnumerating))
    }

    func testActionPredicateUserInfoIsTruthful() {
        let file = WriteFileProviderItem(fileItem())
        XCTAssertEqual(
            file.userInfo?[WriteFileProviderUserInfoKey.fileActionsAvailable] as? Bool,
            true)
        XCTAssertEqual(
            file.userInfo?[WriteFileProviderUserInfoKey.manifestURLAvailable] as? Bool,
            true)

        let noLink = WriteFileProviderItem(WriteItemMapper.item(
            for: manifestEntry(url: nil), inFolder: "blog", handle: "demo",
            readOnly: true)!)
        XCTAssertEqual(
            noLink.userInfo?[WriteFileProviderUserInfoKey.fileActionsAvailable] as? Bool,
            false)
        XCTAssertEqual(
            noLink.userInfo?[WriteFileProviderUserInfoKey.manifestURLAvailable] as? Bool,
            false)
        XCTAssertNil(WriteFileProviderItem(folderItem()).userInfo)
    }

    func testFileVersionTracksContentHash() {
        let a = WriteFileProviderItem(fileItem(hash: "abc123"))
        let b = WriteFileProviderItem(fileItem(hash: "DIFFERENT"))
        XCTAssertNotEqual(
            a.itemVersion.contentVersion, b.itemVersion.contentVersion,
            "a new server hash must produce a new content version so the framework re-fetches")
    }

    func testBookmarkVersionIncludesNativeRepresentation() throws {
        let entry = WriteManifestItem(
            file: "metroid.md", kind: "bookmark", slug: "metroid",
            title: "Metroid", status: "draft", hash: "server-hash", id: "b1",
            date: nil, createdAt: nil, updatedAt: nil, url: nil)
        let mapped = try XCTUnwrap(WriteItemMapper.item(
            for: entry, inFolder: "bookmarks", handle: "demo", readOnly: false))
        let version = WriteFileProviderItem(mapped).itemVersion

        XCTAssertEqual(
            String(data: version.contentVersion, encoding: .utf8),
            WriteFileProviderItem.nativeMaterializationVersion
                + "markdown:server-hash")
    }

    func testContentVersionTracksRepresentation() {
        let markdown = WriteFileProviderItem(
            fileItem(hash: "same", representation: .markdown)).itemVersion
        let text = WriteFileProviderItem(
            fileItem(hash: "same", representation: .text)).itemVersion

        XCTAssertNotEqual(markdown.contentVersion, text.contentVersion)
        XCTAssertEqual(
            WriteFileProviderItem.serverHash(from: markdown.contentVersion), "same")
        XCTAssertEqual(
            WriteFileProviderItem.serverHash(from: text.contentVersion), "same")
    }

    func testServerHashAcceptsLegacyContentVersions() {
        XCTAssertEqual(
            WriteFileProviderItem.serverHash(from: Data("raw-hash".utf8)),
            "raw-hash")
        XCTAssertEqual(
            WriteFileProviderItem.serverHash(from: Data(
                (WriteFileProviderItem.bookmarkMaterializationVersion + "bookmark-hash").utf8)),
            "bookmark-hash")
        XCTAssertEqual(
            WriteFileProviderItem.serverHash(from: Data(
                (WriteFileProviderItem.legacyNativeMaterializationVersion
                    + "textbundle:legacy-native-hash").utf8)),
            "legacy-native-hash")
        XCTAssertEqual(
            WriteFileProviderItem.serverHash(from: Data(
                (WriteFileProviderItem.previousNativeMaterializationVersion
                    + "textbundle:previous-native-hash").utf8)),
            "previous-native-hash")
        XCTAssertNil(WriteFileProviderItem.serverHash(from: Data(
            (WriteFileProviderItem.nativeMaterializationVersion + "unknown:hash").utf8)))
    }

    func testMetadataVersionTracksRepresentationIndependently() {
        let markdown = WriteFileProviderItem(
            fileItem(representation: .markdown).withFilename("Same name"))
        let text = WriteFileProviderItem(
            fileItem(representation: .text).withFilename("Same name"))

        XCTAssertNotEqual(
            markdown.itemVersion.metadataVersion,
            text.itemVersion.metadataVersion)
    }

    func testVersionFieldsAreNonEmptyAndSmall() {
        for wi in [fileItem(), folderItem()] {
            let v = WriteFileProviderItem(wi).itemVersion
            XCTAssertFalse(v.contentVersion.isEmpty)
            XCTAssertFalse(v.metadataVersion.isEmpty)
            XCTAssertLessThanOrEqual(v.contentVersion.count, 128)
            XCTAssertEqual(v.metadataVersion.count, 32)
        }
    }

    func testVeryLongFilenameStillHasFixedSizeMetadataVersion() {
        let long = fileItem().withFilename(String(repeating: "Long title ", count: 100) + ".md")
        let version = WriteFileProviderItem(long).itemVersion
        XCTAssertEqual(version.metadataVersion.count, 32)
        XCTAssertLessThanOrEqual(version.metadataVersion.count, 128)
    }

    func testRootItemBridges() {
        let e = WorkspaceEnumerator(api: StubAPI(), handle: "demo", workspaceName: "Demo", domainName: "Write")
        let root = WriteFileProviderItem(e.rootItem())
        XCTAssertEqual(root.itemIdentifier, .rootContainer)
        XCTAssertEqual(root.parentItemIdentifier, .rootContainer)
        XCTAssertEqual(root.filename, "Write")
        XCTAssertEqual(root.contentType, .folder)
    }
}
