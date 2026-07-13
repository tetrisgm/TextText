import XCTest
@testable import WriteFileProviderKit

final class WorkspaceEnumeratorTests: XCTestCase {

    private func F(_ id: String) -> WriteItemIdentifier { .folder(handle: "demo", id: id) }
    private func FI(_ id: String) -> WriteItemIdentifier { .file(handle: "demo", id: id) }
    private func enumr(_ api: WriteSyncAPI, readOnly: Bool = true) -> WorkspaceEnumerator {
        WorkspaceEnumerator(api: api, handle: "demo", workspaceName: "Demo", readOnly: readOnly)
    }

    // MARK: Root / workspace enumeration

    func testRootListsTheWorkspaceContainer() async {
        let api = Fixtures.standardWorkspace()
        let e = enumr(api)
        guard case .success(let items) = await e.children(of: .rootContainer) else {
            return XCTFail("root enumeration failed")
        }
        XCTAssertEqual(items.map(\.identifier), [.workspace("demo")])
        XCTAssertEqual(items.first?.parentIdentifier, .rootContainer)
        XCTAssertEqual(items.first?.filename, "Demo")
    }

    func testWorkspaceListsOnlyTopLevelFolders() async {
        let api = Fixtures.standardWorkspace()
        let e = enumr(api)
        guard case .success(let items) = await e.children(of: .workspace("demo")) else {
            return XCTFail("workspace enumeration failed")
        }
        let ids = items.map(\.identifier)
        XCTAssertEqual(Set(ids), [F("blog"), F("notes"), F("bookmarks")])
        // The subfolder "drafts" is NOT a child of the workspace; it belongs to blog.
        XCTAssertFalse(ids.contains(F("drafts")))
        XCTAssertTrue(items.allSatisfy(\.isFolder))
        XCTAssertTrue(items.allSatisfy { $0.parentIdentifier == .workspace("demo") })
    }

    // MARK: Folder enumeration

    func testFolderListsSubfoldersThenFiles() async {
        let api = Fixtures.standardWorkspace()
        let e = enumr(api)
        guard case .success(let items) = await e.children(of: F("blog")) else {
            return XCTFail("blog enumeration failed")
        }
        // Subfolder + two articles.
        XCTAssertEqual(items.count, 3)
        XCTAssertEqual(items.first?.identifier, F("drafts"))
        let files = items.filter { !$0.isFolder }
        XCTAssertEqual(Set(files.map(\.identifier)), [FI("p1"), FI("p2")])
        XCTAssertTrue(files.allSatisfy { $0.parentIdentifier == F("blog") })
    }

    func testEnumerationDoesNotFetchBodies() async {
        let api = Fixtures.standardWorkspace()
        let e = enumr(api)
        _ = await e.children(of: F("blog"))
        XCTAssertEqual(api.fileTextCalls, 0)
    }

    func testUnknownFolderIsNotFound() async {
        let api = Fixtures.standardWorkspace()
        let e = enumr(api)
        guard case .failure(let err) = await e.children(of: F("nope")) else {
            return XCTFail("expected notFound")
        }
        XCTAssertEqual(err, .notFound)
    }

    func testFileIdentifierEnumeratesEmpty() async {
        let api = Fixtures.standardWorkspace()
        let e = enumr(api)
        guard case .success(let items) = await e.children(of: FI("p1")) else {
            return XCTFail()
        }
        XCTAssertTrue(items.isEmpty)
    }

    // MARK: Working set / trash

    func testWorkingSetIncludesEveryFolderAndFile() async {
        let api = Fixtures.standardWorkspace()
        let e = enumr(api)
        guard case .success(let items) = await e.children(of: .workingSet) else {
            return XCTFail()
        }
        let ids = Set(items.map(\.identifier))
        XCTAssertTrue(ids.isSuperset(of: [
            F("blog"), F("notes"), F("bookmarks"), F("drafts"),
            FI("p1"), FI("p2"), FI("p3"), FI("n1"), FI("b1"),
        ]))
    }

    func testTrashIsEmpty() async {
        let api = Fixtures.standardWorkspace()
        let e = enumr(api)
        guard case .success(let items) = await e.children(of: .trashContainer) else {
            return XCTFail()
        }
        XCTAssertTrue(items.isEmpty)
    }

    // MARK: Single item lookup

    func testItemForFolder() async {
        let api = Fixtures.standardWorkspace()
        let e = enumr(api)
        guard case .success(let item) = await e.item(for: F("notes")) else {
            return XCTFail()
        }
        XCTAssertEqual(item.filename, "Notes")
        XCTAssertTrue(item.isFolder)
        XCTAssertEqual(item.kind, .folder)
    }

    func testItemForFileScansManifests() async {
        let api = Fixtures.standardWorkspace()
        let e = enumr(api)
        guard case .success(let item) = await e.item(for: FI("p3")) else {
            return XCTFail("p3 lives in the drafts subfolder and must be found")
        }
        XCTAssertEqual(item.filename, "WIP.md") // the TITLE, not the slug
        XCTAssertEqual(item.parentIdentifier, F("drafts"))
        XCTAssertEqual(item.kind, .article)
    }

    func testDuplicatedIdAcrossManifestsDedupesToCurrentParent() async {
        let api = Fixtures.standardWorkspace()
        api.manifests["notes"] = (api.manifests["notes"] ?? []) + [
            Fixtures.entry(id: "p1", file: "hello.md", kind: "note", title: "Hello")
        ]
        let e = enumr(api)

        guard case .success(let items) = await e.children(of: .workingSet) else {
            return XCTFail("working set enumeration failed")
        }
        XCTAssertEqual(items.filter { $0.identifier == FI("p1") }.count, 1,
                       "a duplicated id must appear only once")
        XCTAssertEqual(items.first(where: { $0.identifier == FI("p1") })?.parentIdentifier,
                       F("notes"), "the current (later-fetched) folder wins")

        guard case .success(let item) = await e.item(for: FI("p1")) else {
            return XCTFail("single-item lookup failed")
        }
        XCTAssertEqual(item.parentIdentifier, F("notes"),
                       "findFile must prefer the current parent, not the first match")
    }

    func testItemForMissingFileIsNotFound() async {
        let api = Fixtures.standardWorkspace()
        let e = enumr(api)
        guard case .failure(let err) = await e.item(for: FI("does-not-exist")) else {
            return XCTFail()
        }
        XCTAssertEqual(err, .notFound)
    }

    func testItemForRootReturnsDomainRoot() async {
        let api = Fixtures.standardWorkspace()
        let e = WorkspaceEnumerator(
            api: api, handle: "demo", workspaceName: "Demo", readOnly: true, domainName: "Write")
        guard case .success(let item) = await e.item(for: .rootContainer) else {
            return XCTFail()
        }
        XCTAssertEqual(item.identifier, .rootContainer)
        XCTAssertEqual(item.parentIdentifier, .rootContainer)
        XCTAssertEqual(item.filename, "Write")
    }

    // MARK: Capabilities posture

    func testReadOnlyPostureLimitsCapabilities() async {
        let api = Fixtures.standardWorkspace()
        let e = enumr(api, readOnly: true)
        guard case .success(let items) = await e.children(of: F("blog")),
              let file = items.first(where: { $0.identifier == FI("p1") }) else {
            return XCTFail()
        }
        XCTAssertEqual(file.capabilities, .readOnlyFile)
        XCTAssertFalse(file.capabilities.contains(.writing))
    }

    func testWritablePostureGrantsMutation() async {
        let api = Fixtures.standardWorkspace()
        let e = enumr(api, readOnly: false)
        guard case .success(let items) = await e.children(of: F("blog")),
              let file = items.first(where: { $0.identifier == FI("p1") }) else {
            return XCTFail()
        }
        XCTAssertTrue(file.capabilities.contains(.writing))
        XCTAssertTrue(file.capabilities.contains(.deleting))
    }

    // MARK: Change cursor

    func testCurrentCursor() async {
        let api = Fixtures.standardWorkspace()
        api.cursor = "c42"
        let e = enumr(api)
        guard case .success(let cursor) = await e.currentCursor() else { return XCTFail() }
        XCTAssertEqual(cursor, "c42")
    }

    func testAwaitChangeReportsMovement() async {
        let api = Fixtures.standardWorkspace()
        api.cursor = "c1"
        let e = enumr(api)
        if case .success(let same) = await e.awaitChange(since: "c1", wait: 0) {
            XCTAssertFalse(same.changed)
        } else { XCTFail() }
        api.cursor = "c2"
        if case .success(let moved) = await e.awaitChange(since: "c1", wait: 0) {
            XCTAssertTrue(moved.changed)
            XCTAssertEqual(moved.cursor, "c2")
        } else { XCTFail() }
    }

    // MARK: Error propagation

    func testWorkspaceFailurePropagates() async {
        let api = Fixtures.standardWorkspace()
        api.failWorkspace = .http(401, "unauthorized")
        let e = enumr(api)
        guard case .failure(let err) = await e.children(of: .workspace("demo")) else {
            return XCTFail()
        }
        XCTAssertEqual(err, .http(401, "unauthorized"))
    }

    func testManifestFailurePropagatesFromFolder() async {
        let api = Fixtures.standardWorkspace()
        api.failManifest = .network("offline")
        let e = enumr(api)
        guard case .failure(let err) = await e.children(of: F("blog")) else {
            return XCTFail()
        }
        XCTAssertEqual(err, .network("offline"))
    }
}
