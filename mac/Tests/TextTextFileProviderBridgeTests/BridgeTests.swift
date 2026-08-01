import XCTest
import FileProvider
import UniformTypeIdentifiers
@testable import TextTextFileProviderBridge
@testable import TextTextFileProviderKit

/// A do-nothing API, only so `WorkspaceEnumerator.rootItem()` (which is
/// synchronous and never touches the network) can be exercised here.
private struct StubAPI: TextTextSyncAPI {
    func workspace() async -> Result<TextTextWorkspace, TextTextSyncError> { .failure(.notFound) }
    func manifest(folderId: String) async -> Result<[TextTextManifestItem], TextTextSyncError> { .success([]) }
    func fileText(postId: String) async -> Result<TextTextFileContent, TextTextSyncError> { .failure(.notFound) }
    func changes(since cursor: String?, wait: Int) async -> Result<TextTextChangeReply, TextTextSyncError> {
        .success(TextTextChangeReply(cursor: "c0", changed: false))
    }
    func createFile(body: String, folderId: String?, idempotencyKey: String?) async -> Result<TextTextManifestItem, TextTextSyncError> { .failure(.conflict) }
    func createFile(body: String, folderId: String?, representation: TextTextFileRepresentation, idempotencyKey: String?) async -> Result<TextTextManifestItem, TextTextSyncError> { .failure(.conflict) }
    func putFile(postId: String, body: String, ifMatch hash: String) async -> Result<TextTextManifestItem, TextTextSyncError> { .failure(.conflict) }
    func patchFile(postId: String, folderId: String?, slug: String?, title: String?, ifMatch hash: String?) async -> Result<TextTextManifestItem, TextTextSyncError> { .failure(.conflict) }
    func deleteFile(postId: String, ifMatch hash: String?) async -> Result<Void, TextTextSyncError> { .success(()) }
    func createFolder(parentPath: String, name: String, idempotencyKey: String?) async -> Result<TextTextWorkspaceFolder, TextTextSyncError> { .failure(.conflict) }
    func renameFolder(folderId: String, name: String) async -> Result<TextTextWorkspaceFolder, TextTextSyncError> { .failure(.conflict) }
    func renameWorkspace(name: String) async -> Result<TextTextWorkspaceBlog, TextTextSyncError> { .failure(.conflict) }
}

final class BridgeTests: XCTestCase {

    // MARK: helpers (self-contained; do not borrow the kit test fixtures)

    private func manifestEntry(
        hash: String = "abc123", url: String? = "https://texttext.example/item/p1",
        representation: TextTextFileRepresentation = .markdown
    ) -> TextTextManifestItem {
        TextTextManifestItem(
            file: "hello" + representation.filenameSuffix,
            representation: representation, kind: "article", slug: "hello", title: "Hello",
            status: "draft", hash: hash, id: "p1", date: nil,
            createdAt: "2026-07-01T09:00:00Z", updatedAt: "2026-07-11T10:00:00Z", url: url)
    }

    private func fileItem(
        readOnly: Bool = true, hash: String = "abc123",
        representation: TextTextFileRepresentation = .markdown
    ) -> TextTextItem {
        TextTextItemMapper.item(
            for: manifestEntry(hash: hash, representation: representation),
            inFolder: "blog", handle: "demo", readOnly: readOnly)!
    }

    private func folderItem() -> TextTextItem {
        let folder = TextTextWorkspaceFolder(
            id: "blog", name: "Blog", path: "Blog", mode: "blog", parentId: nil)
        return TextTextItemMapper.item(for: folder, handle: "demo", readOnly: true)
    }

    // MARK: Identifier bridging

    func testReservedIdentifiersBridgeToApplesConstants() {
        XCTAssertEqual(NSFileProviderItemIdentifier(TextTextItemIdentifier.rootContainer), .rootContainer)
        XCTAssertEqual(NSFileProviderItemIdentifier(TextTextItemIdentifier.workingSet), .workingSet)
        XCTAssertEqual(NSFileProviderItemIdentifier(TextTextItemIdentifier.trashContainer), .trashContainer)
    }

    func testFolderAndFileIdentifierBridgeRoundTrip() {
        for id in [TextTextItemIdentifier.folder(handle: "demo", id: "blog"), .file(handle: "demo", id: "p1")] {
            let ns = NSFileProviderItemIdentifier(id)
            XCTAssertEqual(TextTextItemIdentifier(ns), id)
        }
    }

    func testReservedFrameworkIdentifierBridgesBack() {
        XCTAssertEqual(TextTextItemIdentifier(.rootContainer), .rootContainer)
        XCTAssertEqual(TextTextItemIdentifier(.workingSet), .workingSet)
        XCTAssertEqual(TextTextItemIdentifier(.trashContainer), .trashContainer)
    }

    // MARK: Capabilities bridging

    func testReadOnlyFileCapabilities() {
        let ns = nsCapabilities(from: .readOnlyFile)
        XCTAssertTrue(ns.contains(.allowsReading))
        XCTAssertFalse(ns.contains(.allowsWriting))
        XCTAssertFalse(ns.contains(.allowsDeleting))
    }

    func testWritableFileCapabilities() {
        let caps: TextTextItemCapabilities = [.reading, .writing, .renaming, .deleting, .reparenting]
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
        let full: TextTextItemCapabilities = [.contentEnumerating, .addingSubItems]
        let ns = nsCapabilities(from: full)
        XCTAssertTrue(ns.contains(.allowsContentEnumerating))
        XCTAssertTrue(ns.contains(.allowsAddingSubItems))
    }

    // MARK: Item adapter

    func testFileItemMapsToNSFileProviderItem() {
        let item = TextTextFileProviderItem(fileItem())
        XCTAssertEqual(item.itemIdentifier, NSFileProviderItemIdentifier(rawValue: "file:demo:p1"))
        XCTAssertEqual(item.parentItemIdentifier, NSFileProviderItemIdentifier(rawValue: "folder:demo:blog"))
        XCTAssertEqual(item.filename, "Hello.md") // the TITLE, not the slug
        XCTAssertEqual(item.contentType, UTType("net.daringfireball.markdown"))
        XCTAssertTrue(item.capabilities.contains(.allowsReading))
    }

    func testRepresentationMapsToNativeContentType() {
        let markdown = TextTextFileProviderItem(fileItem(representation: .markdown))
        XCTAssertEqual(markdown.filename, "Hello.md")
        XCTAssertEqual(markdown.contentType.identifier, TextTextItem.markdownTypeIdentifier)

        let text = TextTextFileProviderItem(fileItem(representation: .text))
        XCTAssertEqual(text.filename, "Hello.txt")
        XCTAssertEqual(text.contentType, .plainText)

        let textbundle = TextTextFileProviderItem(fileItem(representation: .textbundle))
        XCTAssertEqual(textbundle.filename, "Hello.textbundle")
        XCTAssertTrue(textbundle.contentType.conforms(to: .package))
        XCTAssertTrue(
            textbundle.contentType == .package
                || textbundle.contentType.identifier == TextTextItem.textBundleTypeIdentifier)

        let textpack = TextTextFileProviderItem(fileItem(representation: .textpack))
        XCTAssertEqual(textpack.filename, "Hello.textpack")
        // Phantom-freeness invariant: a .textpack is a single LEAF zip, NOT a
        // package. If it ever conformed to .package, its directory name and body
        // would reconcile separately and the rename revert-loop would return.
        // The resolved type is `org.textbundle.pack` when that UTI is registered
        // (the app bundle declares it, conforming to public.zip-archive so TextText
        // owns the double-click) and the concrete `public.zip-archive` otherwise;
        // both are zip leaves, which is the property that actually matters here.
        XCTAssertTrue(textpack.contentType.conforms(to: .zip))
        XCTAssertFalse(textpack.contentType.conforms(to: .package))
        XCTAssertTrue(
            textpack.contentType == .zip
                || textpack.contentType.identifier == TextTextItem.textPackTypeIdentifier)
    }

    func testFolderItemIsAFolderType() {
        let item = TextTextFileProviderItem(folderItem())
        XCTAssertEqual(item.contentType, .folder)
        XCTAssertEqual(item.filename, "Blog")
        XCTAssertTrue(item.capabilities.contains(.allowsContentEnumerating))
    }

    func testActionPredicateUserInfoIsTruthful() {
        let file = TextTextFileProviderItem(fileItem())
        XCTAssertEqual(
            file.userInfo?[TextTextFileProviderUserInfoKey.fileActionsAvailable] as? Bool,
            true)
        XCTAssertEqual(
            file.userInfo?[TextTextFileProviderUserInfoKey.manifestURLAvailable] as? Bool,
            true)

        let noLink = TextTextFileProviderItem(TextTextItemMapper.item(
            for: manifestEntry(url: nil), inFolder: "blog", handle: "demo",
            readOnly: true)!)
        XCTAssertEqual(
            noLink.userInfo?[TextTextFileProviderUserInfoKey.fileActionsAvailable] as? Bool,
            false)
        XCTAssertEqual(
            noLink.userInfo?[TextTextFileProviderUserInfoKey.manifestURLAvailable] as? Bool,
            false)
        XCTAssertNil(TextTextFileProviderItem(folderItem()).userInfo)
    }

    func testFileVersionTracksContentHash() {
        let a = TextTextFileProviderItem(fileItem(hash: "abc123"))
        let b = TextTextFileProviderItem(fileItem(hash: "DIFFERENT"))
        XCTAssertNotEqual(
            a.itemVersion.contentVersion, b.itemVersion.contentVersion,
            "a new server hash must produce a new content version so the framework re-fetches")
    }

    func testBookmarkVersionIncludesNativeRepresentation() throws {
        let entry = TextTextManifestItem(
            file: "metroid.md", kind: "bookmark", slug: "metroid",
            title: "Metroid", status: "draft", hash: "server-hash", id: "b1",
            date: nil, createdAt: nil, updatedAt: nil, url: nil)
        let mapped = try XCTUnwrap(TextTextItemMapper.item(
            for: entry, inFolder: "bookmarks", handle: "demo", readOnly: false))
        let version = TextTextFileProviderItem(mapped).itemVersion

        XCTAssertEqual(
            String(data: version.contentVersion, encoding: .utf8),
            TextTextFileProviderItem.nativeMaterializationVersion
                + "markdown:server-hash")
    }

    func testContentVersionTracksRepresentation() {
        let markdown = TextTextFileProviderItem(
            fileItem(hash: "same", representation: .markdown)).itemVersion
        let text = TextTextFileProviderItem(
            fileItem(hash: "same", representation: .text)).itemVersion

        XCTAssertNotEqual(markdown.contentVersion, text.contentVersion)
        XCTAssertEqual(
            TextTextFileProviderItem.serverHash(from: markdown.contentVersion), "same")
        XCTAssertEqual(
            TextTextFileProviderItem.serverHash(from: text.contentVersion), "same")
    }

    func testServerHashAcceptsLegacyContentVersions() {
        XCTAssertEqual(
            TextTextFileProviderItem.serverHash(from: Data("raw-hash".utf8)),
            "raw-hash")
        XCTAssertEqual(
            TextTextFileProviderItem.serverHash(from: Data(
                (TextTextFileProviderItem.bookmarkMaterializationVersion + "bookmark-hash").utf8)),
            "bookmark-hash")
        XCTAssertEqual(
            TextTextFileProviderItem.serverHash(from: Data(
                (TextTextFileProviderItem.legacyNativeMaterializationVersion
                    + "textbundle:legacy-native-hash").utf8)),
            "legacy-native-hash")
        XCTAssertEqual(
            TextTextFileProviderItem.serverHash(from: Data(
                (TextTextFileProviderItem.previousNativeMaterializationVersion
                    + "textbundle:previous-native-hash").utf8)),
            "previous-native-hash")
        XCTAssertEqual(
            TextTextFileProviderItem.serverHash(from: Data(
                (TextTextFileProviderItem.priorNativeMaterializationVersion
                    + "textpack:prior-native-hash").utf8)),
            "prior-native-hash")
        XCTAssertNil(TextTextFileProviderItem.serverHash(from: Data(
            (TextTextFileProviderItem.nativeMaterializationVersion + "unknown:hash").utf8)))
    }

    func testMetadataVersionTracksRepresentationIndependently() {
        let markdown = TextTextFileProviderItem(
            fileItem(representation: .markdown).withFilename("Same name"))
        let text = TextTextFileProviderItem(
            fileItem(representation: .text).withFilename("Same name"))

        XCTAssertNotEqual(
            markdown.itemVersion.metadataVersion,
            text.itemVersion.metadataVersion)
    }

    func testVersionFieldsAreNonEmptyAndSmall() {
        for wi in [fileItem(), folderItem()] {
            let v = TextTextFileProviderItem(wi).itemVersion
            XCTAssertFalse(v.contentVersion.isEmpty)
            XCTAssertFalse(v.metadataVersion.isEmpty)
            XCTAssertLessThanOrEqual(v.contentVersion.count, 128)
            XCTAssertEqual(v.metadataVersion.count, 32)
        }
    }

    func testVeryLongFilenameStillHasFixedSizeMetadataVersion() {
        let long = fileItem().withFilename(String(repeating: "Long title ", count: 100) + ".md")
        let version = TextTextFileProviderItem(long).itemVersion
        XCTAssertEqual(version.metadataVersion.count, 32)
        XCTAssertLessThanOrEqual(version.metadataVersion.count, 128)
    }

    func testRootItemBridges() {
        let e = WorkspaceEnumerator(api: StubAPI(), handle: "demo", workspaceName: "Demo", domainName: "TextText")
        let root = TextTextFileProviderItem(e.rootItem())
        XCTAssertEqual(root.itemIdentifier, .rootContainer)
        XCTAssertEqual(root.parentItemIdentifier, .rootContainer)
        XCTAssertEqual(root.filename, "TextText")
        XCTAssertEqual(root.contentType, .folder)
    }
}
