import XCTest
@testable import WriteFileProviderKit

final class WorkspaceEnumeratorTests: XCTestCase {

    // MARK: Root enumeration

    func testRootListsOnlyTopLevelFolders() async {
        let api = Fixtures.standardWorkspace()
        let e = WorkspaceEnumerator(api: api)
        guard case .success(let items) = await e.children(of: .rootContainer) else {
            return XCTFail("root enumeration failed")
        }
        let ids = items.map(\.identifier)
        XCTAssertEqual(Set(ids), [.folder("blog"), .folder("notes"), .folder("bookmarks")])
        // The subfolder "drafts" is NOT a child of root; it belongs to blog.
        XCTAssertFalse(ids.contains(.folder("drafts")))
        XCTAssertTrue(items.allSatisfy(\.isFolder))
        XCTAssertTrue(items.allSatisfy { $0.parentIdentifier == .rootContainer })
    }

    // MARK: Folder enumeration

    func testFolderListsSubfoldersThenFiles() async {
        let api = Fixtures.standardWorkspace()
        let e = WorkspaceEnumerator(api: api)
        guard case .success(let items) = await e.children(of: .folder("blog")) else {
            return XCTFail("blog enumeration failed")
        }
        // Subfolder + two articles.
        XCTAssertEqual(items.count, 3)
        XCTAssertEqual(items.first?.identifier, .folder("drafts"))
        let files = items.filter { !$0.isFolder }
        XCTAssertEqual(Set(files.map(\.identifier)), [.file("p1"), .file("p2")])
        XCTAssertTrue(files.allSatisfy { $0.parentIdentifier == .folder("blog") })
    }

    func testEnumerationDoesNotFetchBodies() async {
        // Listing a folder must not materialize file contents.
        let api = Fixtures.standardWorkspace()
        let e = WorkspaceEnumerator(api: api)
        _ = await e.children(of: .folder("blog"))
        XCTAssertEqual(api.fileTextCalls, 0)
    }

    func testUnknownFolderIsNotFound() async {
        let api = Fixtures.standardWorkspace()
        let e = WorkspaceEnumerator(api: api)
        guard case .failure(let err) = await e.children(of: .folder("nope")) else {
            return XCTFail("expected notFound")
        }
        XCTAssertEqual(err, .notFound)
    }

    func testFileIdentifierEnumeratesEmpty() async {
        let api = Fixtures.standardWorkspace()
        let e = WorkspaceEnumerator(api: api)
        guard case .success(let items) = await e.children(of: .file("p1")) else {
            return XCTFail()
        }
        XCTAssertTrue(items.isEmpty)
    }

    // MARK: Working set / trash

    func testWorkingSetIncludesEveryFolderAndFile() async {
        let api = Fixtures.standardWorkspace()
        let e = WorkspaceEnumerator(api: api)
        guard case .success(let items) = await e.children(of: .workingSet) else {
            return XCTFail()
        }
        let ids = Set(items.map(\.identifier))
        XCTAssertTrue(ids.isSuperset(of: [
            .folder("blog"), .folder("notes"), .folder("bookmarks"), .folder("drafts"),
            .file("p1"), .file("p2"), .file("p3"), .file("n1"), .file("b1"),
        ]))
    }

    func testTrashIsEmpty() async {
        let api = Fixtures.standardWorkspace()
        let e = WorkspaceEnumerator(api: api)
        guard case .success(let items) = await e.children(of: .trashContainer) else {
            return XCTFail()
        }
        XCTAssertTrue(items.isEmpty)
    }

    // MARK: Single item lookup

    func testItemForFolder() async {
        let api = Fixtures.standardWorkspace()
        let e = WorkspaceEnumerator(api: api)
        guard case .success(let item) = await e.item(for: .folder("notes")) else {
            return XCTFail()
        }
        XCTAssertEqual(item.filename, "Notes")
        XCTAssertTrue(item.isFolder)
        XCTAssertEqual(item.kind, .folder)
    }

    func testItemForFileScansManifests() async {
        let api = Fixtures.standardWorkspace()
        let e = WorkspaceEnumerator(api: api)
        guard case .success(let item) = await e.item(for: .file("p3")) else {
            return XCTFail("p3 lives in the drafts subfolder and must be found")
        }
        XCTAssertEqual(item.filename, "wip.md")
        XCTAssertEqual(item.parentIdentifier, .folder("drafts"))
        XCTAssertEqual(item.kind, .article)
    }

    func testDuplicatedIdAcrossManifestsDedupesToCurrentParent() async {
        // A post that moved between the sequential fetches of its old and new
        // folder can land in BOTH manifests. The working set must list it once,
        // and single-item lookup must report the CURRENT parent (the folder
        // fetched later, since the move happened after the earlier fetch).
        let api = Fixtures.standardWorkspace()
        // p1 is already listed under "blog" (fetched before "notes"); also list
        // it under "notes" as the newer, current parent.
        api.manifests["notes"] = (api.manifests["notes"] ?? []) + [
            Fixtures.entry(id: "p1", file: "hello.md", kind: "note", title: "Hello")
        ]
        let e = WorkspaceEnumerator(api: api)

        guard case .success(let items) = await e.children(of: .workingSet) else {
            return XCTFail("working set enumeration failed")
        }
        XCTAssertEqual(items.filter { $0.identifier == .file("p1") }.count, 1,
                       "a duplicated id must appear only once")
        XCTAssertEqual(items.first(where: { $0.identifier == .file("p1") })?.parentIdentifier,
                       .folder("notes"), "the current (later-fetched) folder wins")

        guard case .success(let item) = await e.item(for: .file("p1")) else {
            return XCTFail("single-item lookup failed")
        }
        XCTAssertEqual(item.parentIdentifier, .folder("notes"),
                       "findFile must prefer the current parent, not the first match")
    }

    func testItemForMissingFileIsNotFound() async {
        let api = Fixtures.standardWorkspace()
        let e = WorkspaceEnumerator(api: api)
        guard case .failure(let err) = await e.item(for: .file("does-not-exist")) else {
            return XCTFail()
        }
        XCTAssertEqual(err, .notFound)
    }

    func testItemForRootReturnsDomainRoot() async {
        let api = Fixtures.standardWorkspace()
        let e = WorkspaceEnumerator(api: api, readOnly: true, domainName: "Write")
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
        let e = WorkspaceEnumerator(api: api, readOnly: true)
        guard case .success(let items) = await e.children(of: .folder("blog")),
              let file = items.first(where: { $0.identifier == .file("p1") }) else {
            return XCTFail()
        }
        XCTAssertEqual(file.capabilities, .readOnlyFile)
        XCTAssertFalse(file.capabilities.contains(.writing))
    }

    func testWritablePostureGrantsMutation() async {
        let api = Fixtures.standardWorkspace()
        let e = WorkspaceEnumerator(api: api, readOnly: false)
        guard case .success(let items) = await e.children(of: .folder("blog")),
              let file = items.first(where: { $0.identifier == .file("p1") }) else {
            return XCTFail()
        }
        XCTAssertTrue(file.capabilities.contains(.writing))
        XCTAssertTrue(file.capabilities.contains(.deleting))
    }

    // MARK: Change cursor

    func testCurrentCursor() async {
        let api = Fixtures.standardWorkspace()
        api.cursor = "c42"
        let e = WorkspaceEnumerator(api: api)
        guard case .success(let cursor) = await e.currentCursor() else { return XCTFail() }
        XCTAssertEqual(cursor, "c42")
    }

    func testAwaitChangeReportsMovement() async {
        let api = Fixtures.standardWorkspace()
        api.cursor = "c1"
        let e = WorkspaceEnumerator(api: api)
        // Same cursor -> no change.
        if case .success(let same) = await e.awaitChange(since: "c1", wait: 0) {
            XCTAssertFalse(same.changed)
        } else { XCTFail() }
        // Server moved on -> change, with the new cursor.
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
        let e = WorkspaceEnumerator(api: api)
        guard case .failure(let err) = await e.children(of: .rootContainer) else {
            return XCTFail()
        }
        XCTAssertEqual(err, .http(401, "unauthorized"))
    }

    func testManifestFailurePropagatesFromFolder() async {
        let api = Fixtures.standardWorkspace()
        api.failManifest = .network("offline")
        let e = WorkspaceEnumerator(api: api)
        guard case .failure(let err) = await e.children(of: .folder("blog")) else {
            return XCTFail()
        }
        XCTAssertEqual(err, .network("offline"))
    }
}
