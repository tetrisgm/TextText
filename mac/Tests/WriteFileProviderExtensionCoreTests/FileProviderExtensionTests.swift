import XCTest
import FileProvider
import UniformTypeIdentifiers
@testable import WriteFileProviderExtensionCore
@testable import WriteFileProviderKit
@testable import WriteFileProviderBridge

private final class ReimportTemplateItem: NSObject, NSFileProviderItem {
    let itemIdentifier: NSFileProviderItemIdentifier
    let parentItemIdentifier: NSFileProviderItemIdentifier
    let filename: String
    let contentType: UTType

    init(id: String, parent: String, filename: String, contentType: UTType) {
        itemIdentifier = NSFileProviderItemIdentifier(rawValue: id)
        parentItemIdentifier = NSFileProviderItemIdentifier(rawValue: parent)
        self.filename = filename
        self.contentType = contentType
    }
}

final class FileProviderExtensionTests: XCTestCase {

    private func ext(
        _ api: WriteSyncAPI?,
        descriptors: [FileProviderWorkspace]? = nil,
        temporaryDirectory: URL? = nil,
        copyLinkHandler: @escaping (String) -> Bool = { _ in true },
        openURLHandler: @escaping (URL) -> Bool = { _ in true }
    ) -> FileProviderExtension {
        let domain = NSFileProviderDomain(
            identifier: NSFileProviderDomainIdentifier(rawValue: "write"),
            displayName: "Write")
        // Every handle resolves to the same injected API in these tests.
        let workspaces = descriptors ?? [FileProviderWorkspace(
            name: "Demo", handle: "demo", origin: "https://example.test", token: "token")]
        return FileProviderExtension(
            domain: domain, apiFactory: { _ in api },
            descriptorsProvider: { workspaces },
            temporaryDirectoryProvider: temporaryDirectory.map { directory in { directory } },
            copyLinkHandler: copyLinkHandler,
            openURLHandler: openURLHandler)
    }

    private func fileItem(
        id: String, file: String, folder: String,
        representation: WriteFileRepresentation = .markdown
    ) -> WriteFileProviderItem {
        // `file` is the literal Finder filename the framework hands us (e.g. after
        // a rename), so set it verbatim rather than re-deriving it from a title.
        let base = WriteItemMapper.item(
            for: Fixtures.item(
                id: id, file: file, kind: "note",
                representation: representation),
            inFolder: folder, handle: "demo", readOnly: false)!
        return WriteFileProviderItem(base.withFilename(file))
    }

    private func tempFile(_ body: String) -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try? Data(body.utf8).write(to: url)
        return url
    }

    private func tempDirectory() -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(
            UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(
            at: url, withIntermediateDirectories: true)
        return url
    }

    private func textBundle(
        in directory: URL, filename: String = "Draft.textbundle",
        markdown: String, assets: [String: Data]
    ) throws -> URL {
        let package = directory.appendingPathComponent(filename, isDirectory: true)
        let assetDirectory = package.appendingPathComponent("assets", isDirectory: true)
        try FileManager.default.createDirectory(
            at: assetDirectory, withIntermediateDirectories: true)
        try Data(markdown.utf8).write(to: package.appendingPathComponent("text.md"))
        try JSONEncoder().encode(WriteTextBundleInfo()).write(
            to: package.appendingPathComponent("info.json"))
        for (name, data) in assets {
            try data.write(to: assetDirectory.appendingPathComponent(name))
        }
        return package
    }

    private func textBundleTemplate(
        id: String = "tmp", filename: String = "My Note.textbundle"
    ) throws -> WriteFileProviderItem {
        let entry = Fixtures.item(
            id: id, file: filename, kind: "note", title: "My Note",
            representation: .textbundle)
        let item = try XCTUnwrap(WriteItemMapper.item(
            for: entry, inFolder: "notes", handle: "demo", readOnly: false))
        return WriteFileProviderItem(item.withFilename(filename))
    }

    private func version(_ hash: String) -> NSFileProviderItemVersion {
        let current = WriteItemMapper.item(
            for: Fixtures.item(
                id: "p1", file: "a.md", kind: "note", title: "a", hash: hash),
            inFolder: "notes", handle: "demo", readOnly: false)!
        return NSFileProviderItemVersion(
            contentVersion: Data(hash.utf8),
            metadataVersion: WriteFileProviderItem(current).itemVersion.metadataVersion)
    }

    private func version(_ item: WriteItem) -> NSFileProviderItemVersion {
        WriteFileProviderItem(item).itemVersion
    }

    private func version(
        contentHash: String, metadataFor item: WriteItem
    ) -> NSFileProviderItemVersion {
        NSFileProviderItemVersion(
            contentVersion: Data(contentHash.utf8),
            metadataVersion: WriteFileProviderItem(item).itemVersion.metadataVersion)
    }

    private func bookmarkWorkspace() -> WriteWorkspace {
        let base = Fixtures.workspace()
        return WriteWorkspace(
            blog: base.blog,
            folders: base.folders + [WriteWorkspaceFolder(
                id: "bookmarks", name: "Bookmarks", path: "Bookmarks",
                mode: "bookmarks", parentId: nil)])
    }

    private func bookmarkEntry(hash: String = "h1") -> WriteManifestItem {
        Fixtures.item(
            id: "b1", file: "metroid.textbundle", kind: "bookmark",
            slug: "metroid?", title: "Metroid", hash: hash,
            representation: .textbundle)
    }

    private var bookmarkCaptureURL: String {
        "https://write.public.blob.vercel-storage.com/captures/demo/b1/assets/hero.png"
    }

    private func documentArtifactManifest(
        hash: String = "h1"
    ) -> WriteArtifactManifest {
        WriteArtifactManifest(
            postId: "b1", slug: "metroid?", fileHash: hash,
            artifacts: [WriteArtifact(
                filename: "asset-001.png", role: "asset",
                url: bookmarkCaptureURL, contentType: "image/png")])
    }

    private func actionDefinitions() throws -> [[String: Any]] {
        let macDirectory = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let plistURL = macDirectory.appendingPathComponent(
            "Extensions/WriteFileProviderExtension/Info.plist")
        let data = try Data(contentsOf: plistURL)
        let root = try XCTUnwrap(
            PropertyListSerialization.propertyList(from: data, format: nil)
                as? [String: Any])
        let extensionInfo = try XCTUnwrap(root["NSExtension"] as? [String: Any])
        XCTAssertEqual(
            extensionInfo["NSExtensionPointIdentifier"] as? String,
            "com.apple.fileprovider-nonui")
        return try XCTUnwrap(
            extensionInfo["NSExtensionFileProviderActions"] as? [[String: Any]])
    }

    // MARK: not authenticated

    func testItemWithoutAuthIsNotAuthenticated() {
        let exp = expectation(description: "item")
        var err: NSError?
        let progress = ext(nil).item(
            for: NSFileProviderItemIdentifier(rawValue: "file:demo:p1"),
            request: NSFileProviderRequest()
        ) { _, error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(err?.code, NSFileProviderError.notAuthenticated.rawValue)
        XCTAssertEqual(progress.completedUnitCount, 1)
    }

    func testFolderEnumeratorWithoutAuthThrows() {
        // The root and working set list from the handoff (no API), so use a
        // workspace-scoped folder to exercise the not-authenticated path.
        XCTAssertThrowsError(
            try ext(nil).enumerator(
                for: NSFileProviderItemIdentifier(rawValue: "folder:demo:blog"),
            request: NSFileProviderRequest()))
    }

    func testVirtualContainerMetadataNeverAliasesRoot() {
        let provider = ext(nil)

        for identifier in [
            NSFileProviderItemIdentifier.workingSet,
            NSFileProviderItemIdentifier.trashContainer,
        ] {
            let exp = expectation(description: "virtual-container-\(identifier.rawValue)")
            var returnedItem: NSFileProviderItem?
            var returnedError: NSError?

            _ = provider.item(
                for: identifier,
                request: NSFileProviderRequest()
            ) { item, error in
                returnedItem = item
                returnedError = error as NSError?
                exp.fulfill()
            }
            wait(for: [exp], timeout: 5)

            XCTAssertNil(returnedItem)
            XCTAssertEqual(returnedError?.domain, NSFileProviderErrorDomain)
            XCTAssertEqual(
                returnedError?.code,
                NSFileProviderError.noSuchItem.rawValue)
        }
    }

    func testTrashEnumeratorReportsUnsupported() {
        XCTAssertThrowsError(try ext(nil).enumerator(
            for: .trashContainer,
            request: NSFileProviderRequest()
        )) { error in
            let nsError = error as NSError
            XCTAssertEqual(nsError.domain, NSCocoaErrorDomain)
            XCTAssertEqual(nsError.code, NSFeatureUnsupportedError)
        }
    }

    // MARK: Finder actions

    func testActionPlistMatchesImplementationAndActivatesOnlyForFiles() throws {
        let actions = try actionDefinitions()
        let identifiers = Set(actions.compactMap {
            $0["NSExtensionFileProviderActionIdentifier"] as? String
        })
        XCTAssertEqual(identifiers, [
            FileProviderExtension.copyWriteLinkActionIdentifier.rawValue,
            FileProviderExtension.shareActionIdentifier.rawValue,
            FileProviderExtension.manageAccessActionIdentifier.rawValue,
        ])

        let linked = WriteFileProviderItem(WriteItemMapper.item(
            for: Fixtures.item(
                id: "p1", file: "a.md", kind: "note",
                url: "https://write.example/authoritative"),
            inFolder: "notes", handle: "demo", readOnly: false)!)
        let noLink = WriteFileProviderItem(WriteItemMapper.item(
            for: Fixtures.item(id: "p2", file: "b.md", kind: "note"),
            inFolder: "notes", handle: "demo", readOnly: false)!)
        let folder = WriteFileProviderItem(WriteItemMapper.item(
            for: Fixtures.workspace().folders[0], handle: "demo", readOnly: false))

        for action in actions {
            let identifier = try XCTUnwrap(
                action["NSExtensionFileProviderActionIdentifier"] as? String)
            let rule = try XCTUnwrap(
                action["NSExtensionFileProviderActionActivationRule"] as? String)
            let predicate = NSPredicate(format: rule)
            XCTAssertTrue(predicate.evaluate(with: ["fileproviderItems": [linked]]))
            XCTAssertFalse(predicate.evaluate(with: ["fileproviderItems": [folder]]))
            XCTAssertFalse(predicate.evaluate(
                with: ["fileproviderItems": [linked, noLink]]))
            XCTAssertFalse(predicate.evaluate(with: ["fileproviderItems": [noLink]]),
                           "\(identifier) requires an authoritative Write URL")
        }
    }

    func testCopyWriteLinkUsesFreshAuthoritativeManifestURL() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.manifests["notes"] = [Fixtures.item(
            id: "p1", file: "stale-slug.md", kind: "note", slug: "stale-slug",
            url: "https://links.example/current-write-link")]
        var copied: [String] = []
        let provider = ext(api, copyLinkHandler: { copied.append($0); return true })
        let exp = expectation(description: "copy-write-link")
        var err: NSError?

        _ = provider.performAction(
            identifier: FileProviderExtension.copyWriteLinkActionIdentifier,
            onItemsWithIdentifiers: [NSFileProviderItemIdentifier(
                rawValue: "file:demo:p1")]
        ) { error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertNil(err)
        XCTAssertEqual(copied, ["https://links.example/current-write-link"])
    }

    func testCopyWriteLinkResolvesOriginRelativeManifestURL() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.manifests["notes"] = [Fixtures.item(
            id: "p1", file: "a.md", kind: "note",
            url: "/api/sync/v1/files/p1")]
        var copied: String?
        let provider = ext(api, copyLinkHandler: { copied = $0; return true })
        let exp = expectation(description: "copy-relative-write-link")

        _ = provider.performAction(
            identifier: FileProviderExtension.copyWriteLinkActionIdentifier,
            onItemsWithIdentifiers: [NSFileProviderItemIdentifier(
                rawValue: "file:demo:p1")]
        ) { _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(copied, "https://example.test/api/sync/v1/files/p1")
    }

    func testShareAndManageAccessOpenWriteAppDeepLinks() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.manifests["notes"] = [Fixtures.item(
            id: "p1", file: "a.md", kind: "note",
            url: "https://links.example/current-write-link")]
        var opened: [URL] = []
        let provider = ext(api, openURLHandler: { opened.append($0); return true })
        let cases: [(NSFileProviderExtensionActionIdentifier, String)] = [
            (FileProviderExtension.shareActionIdentifier, "share"),
            (FileProviderExtension.manageAccessActionIdentifier, "manage-access"),
        ]

        for (identifier, action) in cases {
            let exp = expectation(description: action)
            _ = provider.performAction(
                identifier: identifier,
                onItemsWithIdentifiers: [NSFileProviderItemIdentifier(
                    rawValue: "file:demo:p1")]
            ) { _ in exp.fulfill() }
            wait(for: [exp], timeout: 5)
        }

        XCTAssertEqual(opened.count, 2)
        XCTAssertEqual(opened.map(\.scheme), ["write-app", "write-app"])
        XCTAssertEqual(opened.map(\.host), ["item", "item"])
        XCTAssertEqual(opened.map(\.path), ["/p1", "/p1"])
        XCTAssertEqual(opened.compactMap {
            URLComponents(url: $0, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "action" })?.value
        }, ["share", "manage-access"])
        XCTAssertEqual(opened.compactMap {
            URLComponents(url: $0, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "url" })?.value
        }, [
            "https://links.example/current-write-link",
            "https://links.example/current-write-link",
        ])
    }

    func testCustomActionCancellationCompletesOnceWithoutCopying() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.manifestDelayNanoseconds = 5_000_000_000
        api.manifests["notes"] = [Fixtures.item(
            id: "p1", file: "a.md", kind: "note",
            url: "https://links.example/p1")]
        var copied: [String] = []
        let provider = ext(api, copyLinkHandler: { copied.append($0); return true })
        let first = expectation(description: "action-cancelled")
        let duplicate = expectation(description: "action-completed-twice")
        duplicate.isInverted = true
        var callbacks = 0
        var err: NSError?

        let progress = provider.performAction(
            identifier: FileProviderExtension.copyWriteLinkActionIdentifier,
            onItemsWithIdentifiers: [NSFileProviderItemIdentifier(
                rawValue: "file:demo:p1")]
        ) { error in
            callbacks += 1
            err = error as NSError?
            callbacks == 1 ? first.fulfill() : duplicate.fulfill()
        }
        progress.cancel()
        wait(for: [first, duplicate], timeout: 0.25)

        XCTAssertEqual(err?.domain, NSCocoaErrorDomain)
        XCTAssertEqual(err?.code, NSUserCancelledError)
        XCTAssertEqual(callbacks, 1)
        XCTAssertTrue(copied.isEmpty)
    }

    // MARK: fetch

    func testFetchContentsRetriesUntilMetadataAndBytesShareOneRevision() throws {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let old = Fixtures.item(
            id: "p1", file: "old.md", kind: "note", title: "Old", hash: "h1")
        let new = Fixtures.item(
            id: "p1", file: "new.md", kind: "note", title: "New", hash: "h2")
        api.manifestResults["notes"] = [
            .success([old]), .success([new]), .success([new]), .success([new]),
        ]
        api.fileTextResults = [
            .success(WriteFileContent(text: "old bytes", hash: "h1")),
            .success(WriteFileContent(text: "new bytes", hash: "h2")),
        ]
        let directory = tempDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }

        let exp = expectation(description: "fetch-consistent")
        var fetchedURL: URL?
        var fetchedItem: NSFileProviderItem?
        var fetchedError: Error?
        _ = ext(api, temporaryDirectory: directory).fetchContents(
            for: NSFileProviderItemIdentifier(rawValue: "file:demo:p1"),
            version: nil, request: NSFileProviderRequest()
        ) { url, item, error in
            fetchedURL = url; fetchedItem = item; fetchedError = error; exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertNil(fetchedError)
        XCTAssertEqual(api.fileTextCalls, 2)
        XCTAssertEqual(try String(contentsOf: XCTUnwrap(fetchedURL), encoding: .utf8),
                       "new bytes")
        XCTAssertEqual(fetchedItem?.filename, "New.md")
        let fetchedVersion = try XCTUnwrap(try XCTUnwrap(fetchedItem).itemVersion)
        XCTAssertEqual(
            String(decoding: fetchedVersion.contentVersion, as: UTF8.self),
            "native-local-v3:markdown:h2")
    }

    func testStrictFetchReportsRequestedRevisionNoLongerAvailable() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.manifests["notes"] = [Fixtures.item(
            id: "p1", file: "new.md", kind: "note", title: "New", hash: "h2")]
        api.fileTextResults = [
            .success(WriteFileContent(text: "new bytes", hash: "h2")),
        ]
        let directory = tempDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let requested = NSFileProviderItemVersion(
            contentVersion: Data("h1".utf8),
            metadataVersion: NSFileProviderItemVersion.beforeFirstSyncComponent)
        let exp = expectation(description: "strict-fetch")
        var fetchedURL: URL?
        var err: NSError?

        _ = ext(api, temporaryDirectory: directory).fetchContents(
            for: NSFileProviderItemIdentifier(rawValue: "file:demo:p1"),
            version: requested, request: NSFileProviderRequest()
        ) { url, _, error in fetchedURL = url; err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertNil(fetchedURL)
        XCTAssertEqual(err?.domain, NSFileProviderErrorDomain)
        XCTAssertEqual(err?.code, NSFileProviderError.versionNoLongerAvailable.rawValue)
    }

    func testBookmarkFetchMaterializesOneTextBundleWithCapturedAssets() throws {
        let api = FakeExtensionAPI(workspace: bookmarkWorkspace())
        api.manifests["bookmarks"] = [bookmarkEntry()]
        let canonical = "# Metroid\n\n![Hero](\(bookmarkCaptureURL))"
        api.fileTextResults = [
            .success(WriteFileContent(text: canonical, hash: "h1")),
        ]
        api.artifactManifests["b1"] = documentArtifactManifest()
        let png = Data([0x89, 0x50, 0x4E, 0x47])
        api.artifactContents[bookmarkCaptureURL] = WriteArtifactContent(
            data: png, contentType: "image/png")
        let directory = tempDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let exp = expectation(description: "fetch-bookmark-local-copy")
        var fetchedURL: URL?
        var fetchedItem: NSFileProviderItem?
        var fetchedError: Error?

        _ = ext(api, temporaryDirectory: directory).fetchContents(
            for: NSFileProviderItemIdentifier(rawValue: "file:demo:b1"),
            version: nil, request: NSFileProviderRequest()
        ) { url, item, error in
            fetchedURL = url; fetchedItem = item; fetchedError = error; exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertNil(fetchedError)
        XCTAssertTrue(try XCTUnwrap(fetchedURL).resourceValues(
            forKeys: [.isDirectoryKey]).isDirectory == true)
        let materializedItem = try XCTUnwrap(fetchedItem)
        XCTAssertNil(materializedItem.documentSize ?? nil)
        XCTAssertEqual(
            try XCTUnwrap(materializedItem.contentType).identifier,
            WriteItem.textBundleTypeIdentifier)
        let contents = try WriteTextBundlePackage.read(
            from: XCTUnwrap(fetchedURL), in: directory)
        XCTAssertEqual(contents.markdown, canonical)
        XCTAssertEqual(contents.assets.map(\.filename), ["asset-001.png"])
        XCTAssertEqual(contents.assets.first?.data, png)
        XCTAssertEqual(api.fileTextCalls, 1)
        XCTAssertEqual(api.documentArtifactCalls, 1)
        XCTAssertEqual(api.artifactDataCalls, 1)
        XCTAssertTrue(api.putCalls.isEmpty,
                      "materialization must never mutate canonical server Markdown")
    }

    func testFetchCancellationUsesUserCancelledErrorAndCompletesOnce() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.manifestDelayNanoseconds = 5_000_000_000
        let directory = tempDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let first = expectation(description: "fetch-cancelled")
        let duplicate = expectation(description: "fetch-completed-twice")
        duplicate.isInverted = true
        var callbacks = 0
        var err: NSError?

        let progress = ext(api, temporaryDirectory: directory).fetchContents(
            for: NSFileProviderItemIdentifier(rawValue: "file:demo:p1"),
            version: nil, request: NSFileProviderRequest()
        ) { _, _, error in
            callbacks += 1
            err = error as NSError?
            callbacks == 1 ? first.fulfill() : duplicate.fulfill()
        }
        progress.cancel()
        wait(for: [first, duplicate], timeout: 0.25)

        XCTAssertEqual(err?.domain, NSCocoaErrorDomain)
        XCTAssertEqual(err?.code, NSUserCancelledError)
        XCTAssertEqual(callbacks, 1)
    }

    // MARK: create

    func testReimportAdoptsWorkspaceByParentAndFilename() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let template = ReimportTemplateItem(
            id: "restored-disk-workspace",
            parent: WriteItemIdentifier.rootContainer.rawValue,
            filename: "Demo", contentType: .folder)
        let exp = expectation(description: "adopt-workspace")
        var adopted: NSFileProviderItem?
        var err: Error?

        _ = ext(api).createItem(
            basedOn: template, fields: [], contents: nil,
            options: [.mayAlreadyExist], request: NSFileProviderRequest()
        ) { item, _, _, error in
            adopted = item; err = error; exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertNil(err)
        XCTAssertEqual(adopted?.itemIdentifier.rawValue, "workspace:demo")
        XCTAssertTrue(api.createFolderCalls.isEmpty)
        XCTAssertTrue(api.createFileCalls.isEmpty)
    }

    func testReimportAdoptsFolderAndFileByParentAndFilename() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let provider = ext(api)
        let folderTemplate = ReimportTemplateItem(
            id: "restored-disk-folder", parent: "workspace:demo",
            filename: "Notes", contentType: .folder)
        let folderExp = expectation(description: "adopt-folder")
        var folder: NSFileProviderItem?

        _ = provider.createItem(
            basedOn: folderTemplate, fields: [], contents: nil,
            options: [.mayAlreadyExist], request: NSFileProviderRequest()
        ) { item, _, _, _ in folder = item; folderExp.fulfill() }
        wait(for: [folderExp], timeout: 5)

        let fileTemplate = ReimportTemplateItem(
            id: "restored-disk-file", parent: "folder:demo:notes",
            filename: "a.md", contentType: UTType(filenameExtension: "md")!)
        let fileExp = expectation(description: "adopt-file")
        var file: NSFileProviderItem?

        _ = provider.createItem(
            basedOn: fileTemplate, fields: [], contents: tempFile("old disk body"),
            options: [.mayAlreadyExist], request: NSFileProviderRequest()
        ) { item, _, _, _ in file = item; fileExp.fulfill() }
        wait(for: [fileExp], timeout: 5)

        XCTAssertEqual(folder?.itemIdentifier.rawValue, "folder:demo:notes")
        XCTAssertEqual(file?.itemIdentifier.rawValue, "file:demo:p1")
        XCTAssertTrue(api.createFolderCalls.isEmpty)
        XCTAssertTrue(api.createFileCalls.isEmpty)
        XCTAssertTrue(api.patchCalls.isEmpty)
    }

    func testReimportAdoptsFileAcrossRepresentationMigration() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.manifests["notes"] = [Fixtures.item(
            id: "p1", file: "Why~3F~3F.textbundle", kind: "note",
            title: "Why??", representation: .textbundle)]
        let template = ReimportTemplateItem(
            id: "restored-disk-file", parent: "folder:demo:notes",
            filename: "Why~3F~3F.md", contentType: UTType(filenameExtension: "md")!)
        let exp = expectation(description: "adopt-migrated-file")
        var adopted: NSFileProviderItem?
        var error: NSError?

        _ = ext(api).createItem(
            basedOn: template, fields: [], contents: tempFile("old disk body"),
            options: [.mayAlreadyExist], request: NSFileProviderRequest()
        ) { item, _, _, returnedError in
            adopted = item
            error = returnedError as NSError?
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertNil(error)
        XCTAssertEqual(adopted?.itemIdentifier.rawValue, "file:demo:p1")
        XCTAssertTrue(api.createFileCalls.isEmpty)
    }

    func testReimportAdoptsRawReservedAndCanonicallyEquivalentTextFilename() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let composed = "Caf\u{00E9}??"
        let decomposed = "Cafe\u{0301}??"
        api.manifests["notes"] = [Fixtures.item(
            id: "p1",
            file: WriteFilename.filename(
                title: composed, slug: "", representation: .text),
            kind: "note", title: composed, representation: .text)]
        let template = ReimportTemplateItem(
            id: "restored-disk-file", parent: "folder:demo:notes",
            filename: decomposed + ".txt", contentType: .plainText)
        let exp = expectation(description: "adopt-portable-text-file")
        var adopted: NSFileProviderItem?

        _ = ext(api).createItem(
            basedOn: template, fields: [], contents: tempFile("old disk body"),
            options: [.mayAlreadyExist], request: NSFileProviderRequest()
        ) { item, _, _, _ in adopted = item; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(adopted?.itemIdentifier.rawValue, "file:demo:p1")
        XCTAssertTrue(api.createFileCalls.isEmpty)
    }

    func testReimportRefusesAmbiguousSemanticMatch() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.manifests["notes"] = [
            Fixtures.item(
                id: "p1", file: "Why~3F~3F.textbundle", kind: "note",
                title: "Why??", representation: .textbundle),
            Fixtures.item(
                id: "p2", file: "Why~3F~3F [p2].textbundle", kind: "note",
                title: "Why??", representation: .textbundle),
        ]
        let template = ReimportTemplateItem(
            id: "restored-disk-file", parent: "folder:demo:notes",
            filename: "Why??.md", contentType: UTType(filenameExtension: "md")!)
        let exp = expectation(description: "reject-ambiguous-file")
        var error: NSError?

        _ = ext(api).createItem(
            basedOn: template, fields: [], contents: tempFile("old disk body"),
            options: [.mayAlreadyExist], request: NSFileProviderRequest()
        ) { _, _, _, returnedError in
            error = returnedError as NSError?
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertNotNil(error)
        XCTAssertTrue(api.createFileCalls.isEmpty)
    }

    func testReimportDropsLegacyBookmarkSidecarInsteadOfRepublishingIt() {
        let api = FakeExtensionAPI(workspace: bookmarkWorkspace())
        let provider = ext(api)
        let sidecarTemplate = ReimportTemplateItem(
            id: "restored-sidecar", parent: "folder:demo:bookmarks",
            filename: "metroid.assets",
            contentType: .folder)
        let sidecarExp = expectation(description: "drop-sidecar")
        var sidecar: NSFileProviderItem?
        var sidecarError: Error?

        _ = provider.createItem(
            basedOn: sidecarTemplate, fields: [], contents: nil,
            options: [.mayAlreadyExist], request: NSFileProviderRequest()
        ) { item, _, _, error in
            sidecar = item; sidecarError = error; sidecarExp.fulfill()
        }
        wait(for: [sidecarExp], timeout: 5)

        XCTAssertNil(sidecar)
        XCTAssertNil(sidecarError)
        XCTAssertTrue(api.createFolderCalls.isEmpty)
        XCTAssertTrue(api.createFileCalls.isEmpty)
    }

    func testCreateFileCallsCreateFileInParentFolder() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.createFileResult = .success(Fixtures.item(id: "n9", file: "my-note.md", kind: "note", slug: "my-note"))
        let template = fileItem(id: "tmp", file: "My Note.md", folder: "notes")
        let exp = expectation(description: "create")
        _ = ext(api).createItem(
            basedOn: template, fields: [], contents: tempFile("hello"), options: [],
            request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.createFileCalls.count, 1)
        XCTAssertEqual(api.createFileCalls.first?.folderId, "notes")
        XCTAssertEqual(api.createFileCalls.first?.body, "hello")
        XCTAssertEqual(api.createFileCalls.first?.representation, .markdown)
        // The template's stable identifier is the idempotency key, so a retried
        // create returns the original item instead of a duplicate.
        XCTAssertEqual(api.createFileCalls.first?.idempotencyKey, "file:demo:tmp")
    }

    func testCreateTextBundleUploadsAssetsBeforeCommittingMarkdown() throws {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.createFileResult = .success(Fixtures.item(
            id: "n9", file: "my-note.textbundle", kind: "note",
            title: "My Note", hash: "h0", representation: .textbundle))
        let uploadedURL =
            "https://write.public.blob.vercel-storage.com/documents/demo/n9/assets/photo.png"
        api.uploadAssetResult = .success(WriteArtifact(
            filename: "photo.png", role: "asset", url: uploadedURL,
            contentType: "image/png"))
        api.putResult = .success(Fixtures.item(
            id: "n9", file: "my-note.textbundle", kind: "note",
            title: "My Note", hash: "h1", representation: .textbundle))
        let directory = tempDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let image = Data([0x89, 0x50, 0x4e, 0x47])
        let package = try textBundle(
            in: directory, filename: "My Note.textbundle",
            markdown: "# My Note\n\n![Photo](assets/photo.png)",
            assets: ["photo.png": image])
        let exp = expectation(description: "create-textbundle")
        var returnedError: NSError?

        _ = ext(api, temporaryDirectory: directory).createItem(
            basedOn: try textBundleTemplate(), fields: [.contents],
            contents: package, options: [], request: NSFileProviderRequest()
        ) { _, _, _, error in
            returnedError = error as NSError?
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertNil(returnedError)
        XCTAssertEqual(api.createFileCalls.first?.body, "")
        XCTAssertEqual(api.createFileCalls.first?.representation, .textbundle)
        XCTAssertEqual(api.uploadAssetCalls.first?.postId, "n9")
        XCTAssertEqual(api.uploadAssetCalls.first?.filename, "photo.png")
        XCTAssertEqual(api.uploadAssetCalls.first?.data, image)
        XCTAssertEqual(
            api.putCalls.first?.body,
            "# My Note\n\n![Photo](\(uploadedURL))")
        XCTAssertEqual(api.putCalls.first?.hash, "h0")
        XCTAssertEqual(api.writeOperations, ["create", "upload:photo.png", "put"])
        XCTAssertTrue(api.deleteCalls.isEmpty)
    }

    func testCreateTextBundleRollsBackEmptyItemWhenMarkdownCommitFails() throws {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.createFileResult = .success(Fixtures.item(
            id: "n9", file: "untitled.textbundle", kind: "note",
            title: "", hash: "h0", representation: .textbundle))
        let uploadedURL =
            "https://write.public.blob.vercel-storage.com/documents/demo/n9/assets/photo.png"
        api.uploadAssetResult = .success(WriteArtifact(
            filename: "photo.png", role: "asset", url: uploadedURL,
            contentType: "image/png"))
        api.putResult = .failure(.network("commit failed"))
        let directory = tempDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let package = try textBundle(
            in: directory, markdown: "![Photo](assets/photo.png)",
            assets: ["photo.png": Data([0x89, 0x50, 0x4e, 0x47])])
        let exp = expectation(description: "create-textbundle-rollback")
        var returnedError: NSError?

        _ = ext(api, temporaryDirectory: directory).createItem(
            basedOn: try textBundleTemplate(), fields: [.contents],
            contents: package, options: [], request: NSFileProviderRequest()
        ) { _, _, _, error in
            returnedError = error as NSError?
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertNotNil(returnedError)
        XCTAssertEqual(api.writeOperations, ["create", "upload:photo.png", "put"])
        XCTAssertEqual(api.deleteCalls, ["n9"])
        XCTAssertEqual(api.deleteIfMatchCalls, ["h0"])
        XCTAssertTrue(api.patchCalls.isEmpty)
    }

    func testCreateFileTitlesTheNewPostFromTheFilename() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.createFileResult = .success(Fixtures.item(id: "n9", file: "untitled-x.md", kind: "note", slug: "untitled-x", title: ""))
        let template = fileItem(id: "tmp", file: "My Great Note.md", folder: "notes")
        let exp = expectation(description: "create")
        _ = ext(api).createItem(
            basedOn: template, fields: [], contents: tempFile(""), options: [],
            request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        // A Finder-created "My Great Note.md" retitles the fresh post (not reslug).
        XCTAssertEqual(api.patchCalls.first?.title, "My Great Note")
        XCTAssertNil(api.patchCalls.first?.slug)
    }

    func testCreateTextFileUsesTextRepresentationWhenDerivingTitle() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.createFileResult = .success(Fixtures.item(
            id: "n9", file: "untitled.txt", kind: "note", title: "",
            representation: .text))
        let template = ReimportTemplateItem(
            id: "file:demo:tmp", parent: "folder:demo:notes",
            filename: "Why~3F~3F.txt", contentType: .plainText)
        let exp = expectation(description: "create-text")

        _ = ext(api).createItem(
            basedOn: template, fields: [], contents: tempFile("hello"), options: [],
            request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(api.createFileCalls.first?.representation, .text)
        XCTAssertEqual(api.patchCalls.first?.title, "Why??")
    }

    func testCreateTextBundleUsesPackageRepresentationWhenDerivingTitle() throws {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.createFileResult = .success(Fixtures.item(
            id: "n9", file: "untitled.textbundle", kind: "note", title: "",
            representation: .textbundle))
        let directory = tempDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let package = try textBundle(
            in: directory, filename: "Why~3F~3F.textbundle",
            markdown: "hello", assets: [:])
        let template = try textBundleTemplate(
            filename: "Why~3F~3F.textbundle")
        let exp = expectation(description: "create-textbundle-title")

        _ = ext(api, temporaryDirectory: directory).createItem(
            basedOn: template, fields: [.contents], contents: package, options: [],
            request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(api.createFileCalls.first?.representation, .textbundle)
        XCTAssertEqual(api.patchCalls.first?.title, "Why??")
    }

    func testCreateReturnsFilenamePendingWhenTitlePatchCanRetry() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.createFileResult = .success(Fixtures.item(
            id: "n9", file: "untitled-x.md", kind: "note",
            slug: "untitled-x", title: "", hash: "created-hash"))
        api.patchResult = .failure(.network("offline"))
        let template = fileItem(id: "tmp", file: "My Great Note.md", folder: "notes")
        let exp = expectation(description: "create-title-pending")
        var result: NSFileProviderItem?
        var pending: NSFileProviderItemFields = []
        var shouldFetch = true
        var err: NSError?

        _ = ext(api).createItem(
            basedOn: template, fields: [.filename, .contents],
            contents: tempFile("body"), options: [], request: NSFileProviderRequest()
        ) { item, fields, fetch, error in
            result = item
            pending = fields
            shouldFetch = fetch
            err = error as NSError?
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertNil(err)
        XCTAssertNotNil(result)
        XCTAssertEqual(pending, [.filename])
        XCTAssertFalse(shouldFetch)
        XCTAssertEqual(api.createFileCalls.count, 1)
        XCTAssertEqual(api.patchCalls.count, 1)
    }

    func testCreateFileWithUnreadableURLFailsWithoutUploadingEmptyText() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let template = fileItem(id: "tmp", file: "My Note.md", folder: "notes")
        let missing = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
        let exp = expectation(description: "create-unreadable")
        var err: NSError?

        _ = ext(api).createItem(
            basedOn: template, fields: [], contents: missing, options: [],
            request: NSFileProviderRequest()
        ) { _, _, _, error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.createFileCalls.isEmpty)
        XCTAssertEqual(err?.domain, NSFileProviderErrorDomain)
        XCTAssertEqual(err?.code, NSFileProviderError.cannotSynchronize.rawValue)
    }

    func testCreateFolderCallsCreateFolderWithParentPath() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let folder = WriteWorkspaceFolder(id: "tmp", name: "Ideas", path: "Blog/Ideas", mode: "blog", parentId: "blog")
        let template = WriteFileProviderItem(WriteItemMapper.item(for: folder, handle: "demo", readOnly: false))
        let exp = expectation(description: "createFolder")
        _ = ext(api).createItem(
            basedOn: template, fields: [], contents: nil, options: [],
            request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.createFolderCalls.first?.parentPath, "Blog")
        XCTAssertEqual(api.createFolderCalls.first?.name, "Ideas")
        XCTAssertEqual(api.createFolderCalls.first?.idempotencyKey, "folder:demo:tmp")
    }

    func testCreateFolderDecodesPortableFinderComponent() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let folder = WriteWorkspaceFolder(
            id: "tmp", name: "Why??", path: "Blog/Why??", mode: "blog", parentId: "blog")
        let template = WriteFileProviderItem(
            WriteItemMapper.item(for: folder, handle: "demo", readOnly: false))
        let exp = expectation(description: "createFolderEscaped")
        _ = ext(api).createItem(
            basedOn: template, fields: [], contents: nil, options: [],
            request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.createFolderCalls.first?.name, "Why??")
    }

    // MARK: modify

    func testModifyContentsCallsPutWithBaseHash() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.putResult = .success(Fixtures.item(id: "p1", file: "a.md", kind: "note"))
        let item = fileItem(id: "p1", file: "a.md", folder: "notes")
        let exp = expectation(description: "put")
        _ = ext(api).modifyItem(
            item, baseVersion: version("basehash"), changedFields: [.contents],
            contents: tempFile("new body"), options: [], request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.putCalls.first?.postId, "p1")
        XCTAssertEqual(api.putCalls.first?.body, "new body")
        XCTAssertEqual(api.putCalls.first?.hash, "basehash")
    }

    func testTextBundleEditKeepsUnchangedAssetURLWithoutUploadingAgain() throws {
        let api = FakeExtensionAPI(workspace: bookmarkWorkspace())
        let entry = bookmarkEntry()
        api.manifests["bookmarks"] = [entry]
        api.putResult = .success(bookmarkEntry(hash: "h2"))
        let item = WriteItemMapper.item(
            for: entry, inFolder: "bookmarks", handle: "demo", readOnly: false)!
        let directory = tempDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let png = Data([0x89, 0x50, 0x4e, 0x47])
        let package = try WriteTextBundlePackage.materialize(
            canonicalMarkdown: "# Metroid\n\n![Hero](\(bookmarkCaptureURL))",
            assets: [.init(
                filename: "asset-001.png", data: png,
                remoteURL: bookmarkCaptureURL, contentType: "image/png")],
            sourceURL: nil, in: directory)
        let exp = expectation(description: "put-package-canonical-copy")

        _ = ext(api, temporaryDirectory: directory).modifyItem(
            WriteFileProviderItem(item), baseVersion: version(item),
            changedFields: [.contents], contents: package.url, options: [],
            request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(api.putCalls.count, 1)
        XCTAssertEqual(api.putCalls.first?.postId, "b1")
        XCTAssertEqual(api.putCalls.first?.hash, "h1")
        XCTAssertEqual(
            api.putCalls.first?.body,
            "# Metroid\n\n![Hero](\(bookmarkCaptureURL))")
        XCTAssertTrue(api.uploadAssetCalls.isEmpty)
        XCTAssertEqual(api.writeOperations, ["put"])
    }

    func testTextBundleEditUploadsNewAssetBeforeMarkdownRevision() throws {
        let api = FakeExtensionAPI(workspace: bookmarkWorkspace())
        let entry = bookmarkEntry()
        api.manifests["bookmarks"] = [entry]
        let uploadedURL =
            "https://write.public.blob.vercel-storage.com/documents/demo/b1/assets/new.png"
        api.uploadAssetResult = .success(WriteArtifact(
            filename: "new.png", role: "asset", url: uploadedURL,
            contentType: "image/png"))
        api.putResult = .success(bookmarkEntry(hash: "h2"))
        let item = try XCTUnwrap(WriteItemMapper.item(
            for: entry, inFolder: "bookmarks", handle: "demo", readOnly: false))
        let directory = tempDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let package = directory.appendingPathComponent("Metroid.textbundle", isDirectory: true)
        let assets = package.appendingPathComponent("assets", isDirectory: true)
        try FileManager.default.createDirectory(
            at: assets, withIntermediateDirectories: true)
        try Data("# Metroid\n\n![New](assets/new.png)".utf8).write(
            to: package.appendingPathComponent("text.md"))
        try JSONEncoder().encode(WriteTextBundleInfo()).write(
            to: package.appendingPathComponent("info.json"))
        let png = Data([0x89, 0x50, 0x4e, 0x47, 0x0d])
        try png.write(to: assets.appendingPathComponent("new.png"))
        let exp = expectation(description: "upload-package-asset")

        _ = ext(api, temporaryDirectory: directory).modifyItem(
            WriteFileProviderItem(item), baseVersion: version(item),
            changedFields: [.contents], contents: package, options: [],
            request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(api.uploadAssetCalls.first?.postId, "b1")
        XCTAssertEqual(api.uploadAssetCalls.first?.filename, "new.png")
        XCTAssertEqual(api.uploadAssetCalls.first?.data, png)
        XCTAssertEqual(api.putCalls.first?.body, "# Metroid\n\n![New](\(uploadedURL))")
        XCTAssertEqual(api.writeOperations, ["upload:new.png", "put"])
    }

    func testModifyContentsWithoutReadableURLFailsWithoutUploadingEmptyText() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let item = fileItem(id: "p1", file: "a.md", folder: "notes")
        let exp = expectation(description: "missing-contents")
        var err: NSError?
        _ = ext(api).modifyItem(
            item, baseVersion: version("basehash"), changedFields: [.contents],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { _, _, _, error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.putCalls.isEmpty)
        XCTAssertEqual(err?.domain, NSFileProviderErrorDomain)
        XCTAssertEqual(err?.code, NSFileProviderError.cannotSynchronize.rawValue)
    }

    func testModifyContentsWithUnreadableURLFailsWithoutUpload() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let item = fileItem(id: "p1", file: "a.md", folder: "notes")
        let missing = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
        let exp = expectation(description: "unreadable-contents")
        var err: NSError?
        _ = ext(api).modifyItem(
            item, baseVersion: version("basehash"), changedFields: [.contents],
            contents: missing, options: [], request: NSFileProviderRequest()
        ) { _, _, _, error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.putCalls.isEmpty)
        XCTAssertEqual(err?.code, NSFileProviderError.cannotSynchronize.rawValue)
    }

    func testModifyCancellationReturnsRequiredEmptyPendingShape() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.putFileDelayNanoseconds = 5_000_000_000
        api.putResult = .success(Fixtures.item(
            id: "p1", file: "a.md", kind: "note", hash: "new-hash"))
        let item = fileItem(id: "p1", file: "a.md", folder: "notes")
        let exp = expectation(description: "modify-cancelled")
        var result: NSFileProviderItem?
        var pending: NSFileProviderItemFields = [.contents]
        var shouldFetch = true
        var err: NSError?

        let progress = ext(api).modifyItem(
            item, baseVersion: version("basehash"), changedFields: [.contents],
            contents: tempFile("new body"), options: [], request: NSFileProviderRequest()
        ) { returned, fields, fetch, error in
            result = returned
            pending = fields
            shouldFetch = fetch
            err = error as NSError?
            exp.fulfill()
        }
        progress.cancel()
        wait(for: [exp], timeout: 5)

        XCTAssertNil(result)
        XCTAssertTrue(pending.isEmpty)
        XCTAssertFalse(shouldFetch)
        XCTAssertEqual(err?.domain, NSCocoaErrorDomain)
        XCTAssertEqual(err?.code, NSUserCancelledError)
        XCTAssertTrue(api.putCalls.isEmpty)
    }

    func testBeforeFirstSyncContentSentinelNeverUploads() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.manifests["notes"] = [
            Fixtures.item(id: "p1", file: "remote.md", kind: "note", title: "Remote")
        ]
        let item = fileItem(id: "p1", file: "a.md", folder: "notes")
        let beforeFirst = NSFileProviderItemVersion(
            contentVersion: NSFileProviderItemVersion.beforeFirstSyncComponent,
            metadataVersion: Data("m".utf8))
        let exp = expectation(description: "before-first")
        var current: NSFileProviderItem?
        _ = ext(api).modifyItem(
            item, baseVersion: beforeFirst, changedFields: [.contents],
            contents: tempFile("local"), options: [], request: NSFileProviderRequest()
        ) { result, _, _, _ in current = result; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.putCalls.isEmpty)
        XCTAssertEqual(current?.filename, "Remote.md")
    }

    func testInvalidDestinationParentFailsBeforeCompoundUpload() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let base = WriteItemMapper.item(
            for: Fixtures.item(id: "p1", file: "a.md", kind: "note"),
            inFolder: "notes", handle: "demo", readOnly: false)!
        let item = WriteFileProviderItem(
            base.withParentIdentifier(.workspace("demo")))
        let exp = expectation(description: "invalid-parent")
        var err: NSError?
        _ = ext(api).modifyItem(
            item, baseVersion: version("basehash"),
            changedFields: [.contents, .parentItemIdentifier],
            contents: tempFile("local"), options: [], request: NSFileProviderRequest()
        ) { _, _, _, error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.putCalls.isEmpty)
        XCTAssertTrue(api.patchCalls.isEmpty)
        XCTAssertEqual(err?.code, NSFileProviderError.noSuchItem.rawValue)
    }

    func testCompoundModifyPatchesWithPutReturnedHash() {
        // A content edit plus a rename must be atomic against a concurrent
        // metadata change: the rename PATCH must build on the hash the PUT just
        // returned, not the original base version, so a change slipping in
        // between conflicts (412) instead of being silently overwritten.
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.putResult = .success(WriteManifestItem(
            file: "a.md", kind: "note", slug: "a", title: "a", status: "draft",
            hash: "puthash", id: "p1", date: nil, createdAt: nil, updatedAt: nil, url: nil))
        let item = fileItem(id: "p1", file: "Renamed.md", folder: "notes")
        let exp = expectation(description: "compound")
        _ = ext(api).modifyItem(
            item, baseVersion: version("basehash"), changedFields: [.contents, .filename],
            contents: tempFile("new body"), options: [], request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.putCalls.first?.hash, "basehash", "the PUT still uses the base version")
        XCTAssertEqual(api.patchCalls.first?.ifMatch, "puthash",
                       "the PATCH must guard on the bytes the PUT just wrote")
        // A Finder rename retitles the post (the filename is the title, not the slug).
        XCTAssertEqual(api.patchCalls.first?.title, "Renamed")
        XCTAssertNil(api.patchCalls.first?.slug)
    }

    func testCompoundModifyReturnsMetadataPendingAfterContentSave() throws {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.putResult = .success(WriteManifestItem(
            file: "a.md", kind: "note", slug: "a", title: "a", status: "draft",
            hash: "puthash", id: "p1", date: nil, createdAt: nil, updatedAt: nil,
            url: "https://links.example/p1"))
        api.patchResult = .failure(.network("offline"))
        let item = fileItem(id: "p1", file: "Renamed.md", folder: "notes")
        let exp = expectation(description: "compound-partial")
        var result: NSFileProviderItem?
        var pending: NSFileProviderItemFields = []
        var shouldFetch = true
        var err: NSError?

        _ = ext(api).modifyItem(
            item, baseVersion: version("basehash"),
            changedFields: [.contents, .filename], contents: tempFile("new body"),
            options: [], request: NSFileProviderRequest()
        ) { returned, fields, fetch, error in
            result = returned
            pending = fields
            shouldFetch = fetch
            err = error as NSError?
            exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertNil(err)
        XCTAssertEqual(pending, [.filename])
        XCTAssertFalse(shouldFetch)
        XCTAssertEqual(result?.filename, "a.md")
        XCTAssertEqual(
            String(decoding: try XCTUnwrap(result?.itemVersion?.contentVersion), as: UTF8.self),
            "native-local-v3:markdown:puthash")
        XCTAssertEqual(api.putCalls.count, 1)
        XCTAssertEqual(api.patchCalls.count, 1)
    }

    func testCompoundModifyDoesNotPatchWhenPutReturnsNoHash() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.putResult = .success(WriteManifestItem(
            file: "a.md", kind: "note", slug: "a", title: "a", status: "draft",
            hash: "", id: "p1", date: nil, createdAt: nil, updatedAt: nil, url: nil))
        let item = fileItem(id: "p1", file: "Renamed.md", folder: "notes")
        let exp = expectation(description: "compound-no-hash")
        var err: NSError?
        _ = ext(api).modifyItem(
            item, baseVersion: version("basehash"), changedFields: [.contents, .filename],
            contents: tempFile("new body"), options: [], request: NSFileProviderRequest()
        ) { _, _, _, error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.patchCalls.isEmpty)
        XCTAssertEqual(err?.domain, NSFileProviderErrorDomain)
        XCTAssertEqual(err?.code, NSFileProviderError.cannotSynchronize.rawValue)
    }

    func testRenameFileCallsPatchWithTitle() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let item = fileItem(id: "p1", file: "Renamed Title.md", folder: "notes")
        let exp = expectation(description: "rename")
        _ = ext(api).modifyItem(
            item, baseVersion: version("h"), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.patchCalls.first?.postId, "p1")
        XCTAssertEqual(api.patchCalls.first?.title, "Renamed Title")
        XCTAssertNil(api.patchCalls.first?.slug)
        XCTAssertNil(api.patchCalls.first?.folderId)
    }

    func testRenameFileDecodesPortableNameAndRemovesItsCollisionSuffix() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let suffix = WriteFilename.collisionSuffix("p1")
        let item = fileItem(id: "p1", file: "Why~3F~3F\(suffix).md", folder: "notes")
        let exp = expectation(description: "rename-portable")
        _ = ext(api).modifyItem(
            item, baseVersion: version("h"), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(api.patchCalls.first?.title, "Why??")
    }

    func testRenameTextFileUsesItsNativeRepresentation() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let entry = Fixtures.item(
            id: "p1", file: "Original.txt", kind: "note", title: "Original",
            representation: .text)
        api.manifests["notes"] = [entry]
        let current = WriteItemMapper.item(
            for: entry, inFolder: "notes", handle: "demo", readOnly: false)!
        let suffix = WriteFilename.collisionSuffix("p1")
        let item = fileItem(
            id: "p1", file: "Why~3F~3F\(suffix).txt", folder: "notes",
            representation: .text)
        let exp = expectation(description: "rename-text")

        _ = ext(api).modifyItem(
            item, baseVersion: version(current), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(api.patchCalls.first?.title, "Why??")
    }

    func testRenameTextBundleUsesItsNativeRepresentation() throws {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let entry = Fixtures.item(
            id: "p1", file: "Original.textbundle", kind: "note", title: "Original",
            representation: .textbundle)
        api.manifests["notes"] = [entry]
        let current = WriteItemMapper.item(
            for: entry, inFolder: "notes", handle: "demo", readOnly: false)!
        let suffix = WriteFilename.collisionSuffix("p1")
        let item = fileItem(
            id: "p1", file: "Why~3F~3F\(suffix).textbundle", folder: "notes",
            representation: .textbundle)
        let exp = expectation(description: "rename-textbundle")

        _ = ext(api).modifyItem(
            item, baseVersion: version(current), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(api.patchCalls.first?.title, "Why??")
    }

    func testRenameConflictReturnsCurrentRemoteItemWithoutReplayingIntent() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.patchResult = .failure(.conflict)
        let remoteEntry = Fixtures.item(
            id: "p1", file: "remote.md", kind: "note", title: "Remote Title")
        api.manifests["notes"] = [remoteEntry]
        let remote = WriteItemMapper.item(
            for: remoteEntry, inFolder: "notes", handle: "demo", readOnly: false)!
        let item = fileItem(id: "p1", file: "Stale Rename.md", folder: "notes")
        let exp = expectation(description: "rename-conflict")
        var err: NSError?
        var current: NSFileProviderItem?
        var shouldFetch = false
        _ = ext(api).modifyItem(
            item,
            baseVersion: version(contentHash: "stale-hash", metadataFor: remote),
            changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { result, _, fetch, error in
            current = result; shouldFetch = fetch; err = error as NSError?; exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(api.patchCalls.count, 1,
                       "a 412 must not resend a stale rename against a new server snapshot")
        XCTAssertEqual(api.patchCalls.first?.ifMatch, "stale-hash")
        XCTAssertNil(err)
        XCTAssertEqual(current?.filename, "Remote Title.md")
        XCTAssertTrue(shouldFetch)
    }

    func testStaleFileMetadataBaseReturnsCurrentItemWithoutPatch() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let original = WriteItemMapper.item(
            for: Fixtures.item(
                id: "p1", file: "a.md", kind: "note", title: "a"),
            inFolder: "notes", handle: "demo", readOnly: false)!
        api.manifests["notes"] = [Fixtures.item(
            id: "p1", file: "remote.md", kind: "note", title: "Remote", hash: "h")]
        let local = fileItem(id: "p1", file: "Local.md", folder: "notes")
        let exp = expectation(description: "stale-file-metadata")
        var result: NSFileProviderItem?

        _ = ext(api).modifyItem(
            local, baseVersion: version(original), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { item, _, _, _ in result = item; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.patchCalls.isEmpty)
        XCTAssertEqual(result?.filename, "Remote.md")
    }

    func testBoundedCanonicalFilenameDoesNotRetitleStoredFullTitle() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let fullTitle = String(repeating: "Why? ", count: 80)
        let entry = Fixtures.item(
            id: "p1", file: "post.md", kind: "note", slug: "post",
            title: fullTitle, hash: "h")
        api.manifests["notes"] = [entry]
        let current = WriteItemMapper.item(
            for: entry, inFolder: "notes", handle: "demo", readOnly: false)!
        XCTAssertLessThanOrEqual(
            current.filename.utf8.count, WriteFilename.maximumComponentUTF8Length)
        let exp = expectation(description: "bounded-no-op")
        var result: NSFileProviderItem?

        _ = ext(api).modifyItem(
            WriteFileProviderItem(current), baseVersion: version(current),
            changedFields: [.filename], contents: nil, options: [],
            request: NSFileProviderRequest()
        ) { item, _, _, _ in result = item; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.patchCalls.isEmpty)
        XCTAssertEqual(result?.filename, current.filename)
    }

    @available(macOS 26.0, *)
    func testExplicitFailOnConflictReturnsLocalVersionConflictError() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.patchResult = .failure(.conflict)
        let item = fileItem(id: "p1", file: "Stale Rename.md", folder: "notes")
        let exp = expectation(description: "fail-on-conflict")
        var err: NSError?
        _ = ext(api).modifyItem(
            item, baseVersion: version("stale-hash"), changedFields: [.filename],
            contents: nil, options: [.failOnConflict], request: NSFileProviderRequest()
        ) { _, _, _, error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(api.patchCalls.count, 1)
        XCTAssertEqual(err?.domain, NSFileProviderErrorDomain)
        XCTAssertEqual(
            err?.code,
            NSFileProviderError.localVersionConflictingWithServer.rawValue)
    }

    func testRenameWithoutBaseHashReturnsCurrentItemWithoutUnguardedPatch() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.manifests["notes"] = [
            Fixtures.item(id: "p1", file: "remote.md", kind: "note", title: "Remote Title")
        ]
        let item = fileItem(id: "p1", file: "Rename.md", folder: "notes")
        let exp = expectation(description: "rename-without-version")
        var err: NSError?
        var current: NSFileProviderItem?
        _ = ext(api).modifyItem(
            item, baseVersion: version(""), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { result, _, _, error in current = result; err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.patchCalls.isEmpty)
        XCTAssertNil(err)
        XCTAssertEqual(current?.filename, "Remote Title.md")
    }

    func testMoveFileCallsPatchWithFolder() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        // Item now parented under "blog" (moved out of notes).
        let item = fileItem(id: "p1", file: "a.md", folder: "blog")
        let exp = expectation(description: "move")
        _ = ext(api).modifyItem(
            item, baseVersion: version("h"), changedFields: [.parentItemIdentifier],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.patchCalls.first?.postId, "p1")
        XCTAssertEqual(api.patchCalls.first?.folderId, "blog")
    }

    func testRenameFolderCallsRenameFolder() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let folder = api.workspaceValue.folders.first { $0.id == "blog" }!
        let current = WriteItemMapper.item(for: folder, handle: "demo", readOnly: false)
        let item = WriteFileProviderItem(
            current.withFilename(WriteFilename.encodeComponent("Writing")))
        let exp = expectation(description: "renameFolder")
        _ = ext(api).modifyItem(
            item, baseVersion: version(current), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.renameFolderCalls.first?.folderId, "blog")
        XCTAssertEqual(api.renameFolderCalls.first?.name, "Writing")
    }

    func testRenameFolderAndWorkspaceDecodePortableNames() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let folder = api.workspaceValue.folders.first { $0.id == "blog" }!
        let currentFolder = WriteItemMapper.item(
            for: folder, handle: "demo", readOnly: false)
        let folderItem = WriteFileProviderItem(
            currentFolder.withFilename(WriteFilename.encodeComponent("Why??")))
        let folderExp = expectation(description: "renameFolderEscaped")
        _ = ext(api).modifyItem(
            folderItem, baseVersion: version(currentFolder), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { _, _, _, _ in folderExp.fulfill() }

        let currentWorkspace = WriteItemMapper.workspaceItem(
            handle: "demo", name: "Demo", readOnly: false)
        let workspaceItem = WriteFileProviderItem(
            currentWorkspace.withFilename(
                "What~3F~3F\(WriteFilename.collisionSuffix("demo"))"))
        let workspaceExp = expectation(description: "renameWorkspaceEscaped")
        _ = ext(api).modifyItem(
            workspaceItem, baseVersion: version(currentWorkspace), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { _, _, _, _ in workspaceExp.fulfill() }
        wait(for: [folderExp, workspaceExp], timeout: 5)

        XCTAssertEqual(api.renameFolderCalls.first?.name, "Why??")
        XCTAssertEqual(api.renameWorkspaceCalls.first?.name, "What??")
    }

    func testRenameWorkspaceCallsRenameWorkspace() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let current = WriteItemMapper.workspaceItem(
            handle: "demo", name: "Demo", readOnly: false)
        let item = WriteFileProviderItem(
            current.withFilename(WriteFilename.encodeComponent("Studio")))
        let exp = expectation(description: "renameWorkspace")
        _ = ext(api).modifyItem(
            item, baseVersion: version(current), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { _, _, _, _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.renameWorkspaceCalls.first?.name, "Studio")
    }

    func testWorkspaceModificationDateIsAcknowledgedWithoutServerRename() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let current = WriteItemMapper.workspaceItem(
            handle: "demo", name: "Demo", readOnly: false)
        let exp = expectation(description: "workspace-mtime")
        var result: NSFileProviderItem?
        var pending: NSFileProviderItemFields = [.contentModificationDate]
        var err: NSError?
        _ = ext(api).modifyItem(
            WriteFileProviderItem(current), baseVersion: version(current),
            changedFields: [.contentModificationDate], contents: nil,
            options: [], request: NSFileProviderRequest()
        ) { item, fields, _, error in
            result = item; pending = fields; err = error as NSError?; exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertNil(err)
        XCTAssertTrue(pending.isEmpty)
        XCTAssertEqual(result?.itemIdentifier.rawValue, "workspace:demo")
        XCTAssertTrue(api.renameWorkspaceCalls.isEmpty)
    }

    func testFolderModificationDateIsAcknowledgedWithoutServerRename() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let folder = api.workspaceValue.folders.first { $0.id == "blog" }!
        let current = WriteItemMapper.item(
            for: folder, handle: "demo", readOnly: false)
        let exp = expectation(description: "folder-mtime")
        var result: NSFileProviderItem?
        var pending: NSFileProviderItemFields = [.contentModificationDate]
        var err: NSError?
        _ = ext(api).modifyItem(
            WriteFileProviderItem(current), baseVersion: version(current),
            changedFields: [.contentModificationDate], contents: nil,
            options: [], request: NSFileProviderRequest()
        ) { item, fields, _, error in
            result = item; pending = fields; err = error as NSError?; exp.fulfill()
        }
        wait(for: [exp], timeout: 5)

        XCTAssertNil(err)
        XCTAssertTrue(pending.isEmpty)
        XCTAssertEqual(result?.itemIdentifier.rawValue, "folder:demo:blog")
        XCTAssertTrue(api.renameFolderCalls.isEmpty)
    }

    func testWorkspaceRenameAndModificationDateStillRenamesWorkspace() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let current = WriteItemMapper.workspaceItem(
            handle: "demo", name: "Demo", readOnly: false)
        let local = WriteFileProviderItem(
            current.withFilename(WriteFilename.encodeComponent("Studio")))
        let exp = expectation(description: "workspace-rename-mtime")
        var err: NSError?
        _ = ext(api).modifyItem(
            local, baseVersion: version(current),
            changedFields: [.filename, .contentModificationDate], contents: nil,
            options: [], request: NSFileProviderRequest()
        ) { _, _, _, error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertNil(err)
        XCTAssertEqual(api.renameWorkspaceCalls.first?.name, "Studio")
    }

    func testWorkspaceMoveRemainsUnsupported() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let current = WriteItemMapper.workspaceItem(
            handle: "demo", name: "Demo", readOnly: false)
        let exp = expectation(description: "workspace-move")
        var err: NSError?
        _ = ext(api).modifyItem(
            WriteFileProviderItem(current), baseVersion: version(current),
            changedFields: [.parentItemIdentifier], contents: nil,
            options: [], request: NSFileProviderRequest()
        ) { _, _, _, error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(err?.domain, NSCocoaErrorDomain)
        XCTAssertEqual(err?.code, NSFeatureUnsupportedError)
        XCTAssertTrue(api.renameWorkspaceCalls.isEmpty)
    }

    func testStaleMountedFolderNameDoesNotOverwriteRemoteRename() {
        let original = Fixtures.workspace()
        let oldFolder = original.folders.first { $0.id == "blog" }!
        let renamedFolders = original.folders.map { folder in
            folder.id == "blog"
                ? WriteWorkspaceFolder(
                    id: folder.id, name: "Remote Folder", path: "Remote Folder",
                    mode: folder.mode, parentId: folder.parentId)
                : folder
        }
        let api = FakeExtensionAPI(workspace: WriteWorkspace(
            blog: original.blog, folders: renamedFolders))
        let old = WriteItemMapper.item(for: oldFolder, handle: "demo", readOnly: false)
        let local = WriteFileProviderItem(
            old.withFilename(WriteFilename.encodeComponent("Local Folder")))
        let exp = expectation(description: "stale-folder")
        var result: NSFileProviderItem?
        _ = ext(api).modifyItem(
            local, baseVersion: version(old), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { item, _, _, _ in result = item; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.renameFolderCalls.isEmpty)
        XCTAssertEqual(result?.filename, "Remote Folder")
    }

    func testStaleMountedWorkspaceNameDoesNotOverwriteRemoteRename() {
        let original = Fixtures.workspace()
        let remote = WriteWorkspace(
            blog: WriteWorkspaceBlog(
                handle: "demo", name: "Remote Workspace", username: "demo"),
            folders: original.folders)
        let api = FakeExtensionAPI(workspace: remote)
        let old = WriteItemMapper.workspaceItem(
            handle: "demo", name: "Demo", readOnly: false)
        let local = WriteFileProviderItem(
            old.withFilename(WriteFilename.encodeComponent("Local Workspace")))
        let descriptors = [FileProviderWorkspace(
            name: "Demo", handle: "demo", origin: "https://example.test", token: "token")]
        let exp = expectation(description: "stale-workspace")
        var result: NSFileProviderItem?
        _ = ext(api, descriptors: descriptors).modifyItem(
            local, baseVersion: version(old), changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { item, _, _, _ in result = item; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.renameWorkspaceCalls.isEmpty)
        XCTAssertEqual(result?.filename, "Remote Workspace")
    }

    func testBeforeFirstSyncMetadataSentinelCannotRenameFolder() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let folder = api.workspaceValue.folders.first { $0.id == "blog" }!
        let current = WriteItemMapper.item(for: folder, handle: "demo", readOnly: false)
        let local = WriteFileProviderItem(
            current.withFilename(WriteFilename.encodeComponent("Local Folder")))
        let beforeFirst = NSFileProviderItemVersion(
            contentVersion: Data("folder".utf8),
            metadataVersion: NSFileProviderItemVersion.beforeFirstSyncComponent)
        let exp = expectation(description: "folder-before-first")
        var result: NSFileProviderItem?
        _ = ext(api).modifyItem(
            local, baseVersion: beforeFirst, changedFields: [.filename],
            contents: nil, options: [], request: NSFileProviderRequest()
        ) { item, _, _, _ in result = item; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.renameFolderCalls.isEmpty)
        XCTAssertEqual(result?.filename, "Blog")
    }

    // MARK: delete

    func testDeleteFileCallsDelete() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let exp = expectation(description: "delete")
        _ = ext(api).deleteItem(
            identifier: NSFileProviderItemIdentifier(rawValue: "file:demo:p1"),
            baseVersion: version("h"), options: [], request: NSFileProviderRequest()
        ) { _ in exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(api.deleteCalls, ["p1"])
        // The base version's content hash rides along as If-Match for
        // stale-delete protection.
        XCTAssertEqual(api.deleteIfMatchCalls, ["h"])
    }

    func testStaleDeleteIsRejectedWithCurrentRemoteItem() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.deleteResult = .failure(.conflict)
        let currentEntry = Fixtures.item(
            id: "p1", file: "current.md", kind: "note", title: "Current")
        api.manifests["notes"] = [currentEntry]
        let current = WriteItemMapper.item(
            for: currentEntry, inFolder: "notes", handle: "demo", readOnly: false)!
        let exp = expectation(description: "stale-delete")
        var err: NSError?
        _ = ext(api).deleteItem(
            identifier: NSFileProviderItemIdentifier(rawValue: "file:demo:p1"),
            baseVersion: version(current), options: [], request: NSFileProviderRequest()
        ) { error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertEqual(api.deleteCalls, ["p1"])
        XCTAssertEqual(err?.domain, NSFileProviderErrorDomain)
        XCTAssertEqual(err?.code, NSFileProviderError.deletionRejected.rawValue)
    }

    func testDeleteWithoutProviderBaseIsRejectedWithoutRequest() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        api.manifests["notes"] = [
            Fixtures.item(id: "p1", file: "current.md", kind: "note", title: "Current")
        ]
        let beforeFirst = NSFileProviderItemVersion(
            contentVersion: NSFileProviderItemVersion.beforeFirstSyncComponent,
            metadataVersion: NSFileProviderItemVersion.beforeFirstSyncComponent)
        let exp = expectation(description: "delete-before-first")
        var err: NSError?
        _ = ext(api).deleteItem(
            identifier: NSFileProviderItemIdentifier(rawValue: "file:demo:p1"),
            baseVersion: beforeFirst, options: [], request: NSFileProviderRequest()
        ) { error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)

        XCTAssertTrue(api.deleteCalls.isEmpty)
        XCTAssertEqual(err?.code, NSFileProviderError.deletionRejected.rawValue)
    }

    func testDeleteFolderIsRejected() {
        let api = FakeExtensionAPI(workspace: Fixtures.workspace())
        let exp = expectation(description: "delete-folder")
        var err: NSError?
        _ = ext(api).deleteItem(
            identifier: NSFileProviderItemIdentifier(rawValue: "folder:demo:blog"),
            baseVersion: version("h"), options: [], request: NSFileProviderRequest()
        ) { error in err = error as NSError?; exp.fulfill() }
        wait(for: [exp], timeout: 5)
        XCTAssertEqual(err?.code, NSFeatureUnsupportedError)
        XCTAssertTrue(api.deleteCalls.isEmpty)
    }
}
