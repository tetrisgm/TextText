import XCTest
@testable import TextTextFileProviderKit

/// The shared concurrent manifest fetch, which both the file lookup and the
/// attachments view now depend on for their round trip count.
final class SyncAPIManifestsTests: XCTestCase {
    func testEveryFolderIsFetchedAtOnce() async {
        let api = Fixtures.standardWorkspace()

        guard case .success(let entries) = await api.manifests(
            forFolders: ["blog", "drafts", "notes", "bookmarks"]) else {
            return XCTFail("the manifests did not come back")
        }

        XCTAssertEqual(Set(entries.keys), ["blog", "drafts", "notes", "bookmarks"])
        XCTAssertEqual(api.manifestCalls, 4, "one per folder, no more")
        XCTAssertGreaterThan(
            api.peakConcurrentManifests, 1,
            "a serial loop never has two in flight, and that loop was a round "
                + "trip per folder before anything could be answered")
    }

    func testOneFailureFailsTheWholeFetch() async {
        let api = Fixtures.standardWorkspace()
        api.failManifest = .network("offline")

        guard case .failure = await api.manifests(
            forFolders: ["blog", "drafts", "notes", "bookmarks"]) else {
            return XCTFail("a partial view of the workspace must not be answered with")
        }
    }

    func testNoFoldersIsNoRequests() async {
        let api = Fixtures.standardWorkspace()

        guard case .success(let entries) = await api.manifests(forFolders: []) else {
            return XCTFail("an empty workspace is not a failure")
        }

        XCTAssertTrue(entries.isEmpty)
        XCTAssertEqual(api.manifestCalls, 0)
    }

    func testAFolderWithNoEntriesIsStillReported() async {
        let api = Fixtures.standardWorkspace()

        guard case .success(let entries) = await api.manifests(
            forFolders: ["blog", "empty"]) else {
            return XCTFail("the manifests did not come back")
        }

        XCTAssertEqual(
            entries["empty"], [],
            "a folder that listed and is empty is not the same as one that did not list")
    }
}
