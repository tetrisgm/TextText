import XCTest
@testable import TextTextApp

/// A mount that can be told to fail, because the case the retry exists for is a
/// folder that did not list, and a real mount will not stage that on demand.
private final class FakeMount: MaterializationFilesystem {
    struct Failure: Error {}

    /// Directory path -> its entries. A directory absent from this map fails to
    /// list, which is how a cold enumeration behaves.
    var directories: [String: [MaterializationEntry]] = [:]
    var datalessPaths: Set<String> = []
    /// Paths whose download does not actually materialize them.
    var stubbornPaths: Set<String> = []

    private(set) var listed: [String] = []
    private(set) var downloaded: [String] = []
    /// Called after every listing, so a test can advance a clock or cancel.
    var afterListing: (() -> Void)?
    /// The same, after every download.
    var afterDownload: (() -> Void)?

    func listDirectory(_ url: URL) -> Result<[MaterializationEntry], any Error> {
        listed.append(url.path)
        defer { afterListing?() }
        guard let entries = directories[url.path] else { return .failure(Failure()) }
        return .success(entries)
    }

    func isDataless(_ url: URL) -> Bool { datalessPaths.contains(url.path) }

    func download(_ url: URL, isPackage: Bool) {
        downloaded.append(url.path)
        if !stubbornPaths.contains(url.path) { datalessPaths.remove(url.path) }
        afterDownload?()
    }
}

private func directory(_ path: String) -> MaterializationEntry {
    MaterializationEntry(
        url: URL(fileURLWithPath: path), isDirectory: true,
        isPackage: false, isRegularFile: false)
}

private func file(_ path: String) -> MaterializationEntry {
    MaterializationEntry(
        url: URL(fileURLWithPath: path), isDirectory: false,
        isPackage: false, isRegularFile: true)
}

/// Neither a file nor a directory: what an entry looks like when its attributes
/// did not read.
private func unreadable(_ path: String) -> MaterializationEntry {
    MaterializationEntry(
        url: URL(fileURLWithPath: path), isDirectory: false,
        isPackage: false, isRegularFile: false)
}

private func package(_ path: String) -> MaterializationEntry {
    MaterializationEntry(
        url: URL(fileURLWithPath: path), isDirectory: true,
        isPackage: true, isRegularFile: false)
}

/// A clock the test moves by hand, so a deadline can be exhausted without one.
private final class TestClock {
    private var current = Date(timeIntervalSince1970: 0)
    func now() -> Date { current }
    func advance(_ seconds: TimeInterval) { current.addTimeInterval(seconds) }
}

private let generous = MaterializationBudget(
    duration: 3600, listings: 10_000, downloads: 10_000)

final class WorkspaceMaterializationTests: XCTestCase {
    private func run(
        _ mount: FakeMount,
        cursor: MaterializationCursor,
        budget: MaterializationBudget = generous,
        clock: TestClock = TestClock(),
        isCancelled: @escaping () -> Bool = { false }
    ) -> MaterializationOutcome {
        WorkspaceMaterialization.runPass(
            cursor: cursor, budget: budget, filesystem: mount,
            now: clock.now, isCancelled: isCancelled)
    }

    // MARK: A tree that lists fully

    func testWalksTheWholeTreeAndReportsNothingLeftToDo() {
        let mount = FakeMount()
        mount.directories = [
            "/root": [directory("/root/workspace")],
            "/root/workspace": [directory("/root/workspace/notes"), file("/root/workspace/a.md")],
            "/root/workspace/notes": [file("/root/workspace/notes/b.md")],
        ]
        mount.datalessPaths = ["/root/workspace/a.md", "/root/workspace/notes/b.md"]

        let outcome = run(mount, cursor: .starting(at: URL(fileURLWithPath: "/root")))

        XCTAssertEqual(outcome.listed, 3)
        XCTAssertEqual(outcome.downloaded, 2)
        XCTAssertEqual(
            mount.downloaded.sorted(),
            ["/root/workspace/a.md", "/root/workspace/notes/b.md"])
        XCTAssertTrue(outcome.cursor.isFinished)
        XCTAssertFalse(outcome.incomplete)
    }

    func testAlreadyDownloadedWorkspaceCostsNoDownloads() {
        let mount = FakeMount()
        mount.directories = [
            "/root": [file("/root/a.md"), file("/root/b.md")],
        ]

        let outcome = run(mount, cursor: .starting(at: URL(fileURLWithPath: "/root")))

        XCTAssertEqual(outcome.downloaded, 0)
        XCTAssertTrue(mount.downloaded.isEmpty)
        XCTAssertFalse(outcome.incomplete)
    }

    // MARK: The property the old walk lost

    func testAFolderThatFailsToListKeepsTheWalkIncomplete() {
        let mount = FakeMount()
        // The workspace lists and hands over a file, so the old walk's
        // files.isEmpty test would have called this complete. The notes folder
        // is missing from the map, so listing it fails the way a cold
        // enumeration does.
        mount.directories = [
            "/root": [directory("/root/notes"), file("/root/a.md")],
        ]
        mount.datalessPaths = ["/root/a.md"]

        let outcome = run(mount, cursor: .starting(at: URL(fileURLWithPath: "/root")))

        XCTAssertEqual(outcome.downloaded, 1, "the file it could reach still downloads")
        XCTAssertEqual(outcome.failedListings, 1)
        XCTAssertTrue(outcome.incomplete)
        XCTAssertEqual(
            outcome.cursor.pending.map(\.path), ["/root/notes"],
            "the folder that failed is what the next pass owes")
    }

    func testAFolderThatKeepsFailingIsNotRelistedWithinOnePass() {
        let mount = FakeMount()
        mount.directories = ["/root": [directory("/root/cold")]]

        let outcome = run(mount, cursor: .starting(at: URL(fileURLWithPath: "/root")))

        XCTAssertEqual(mount.listed, ["/root", "/root/cold"])
        XCTAssertEqual(outcome.failedListings, 1)
        XCTAssertTrue(outcome.incomplete)
    }

    func testAFileThatStaysDatalessAfterDownloadKeepsTheWalkIncomplete() {
        let mount = FakeMount()
        mount.directories = ["/root": [file("/root/a.md")]]
        mount.datalessPaths = ["/root/a.md"]
        mount.stubbornPaths = ["/root/a.md"]

        let outcome = run(mount, cursor: .starting(at: URL(fileURLWithPath: "/root")))

        XCTAssertEqual(outcome.stillDataless, 1)
        XCTAssertTrue(outcome.incomplete)
    }

    func testALegacySidecarKeepsTheWalkIncomplete() {
        let mount = FakeMount()
        mount.directories = ["/root": [directory("/root/a.assets")]]
        mount.directories["/root/a.assets"] = []

        let outcome = run(mount, cursor: .starting(at: URL(fileURLWithPath: "/root")))

        XCTAssertTrue(outcome.cursor.sawLegacySidecar)
        XCTAssertTrue(outcome.incomplete)
    }

    // MARK: The budget

    func testADeadlineStopsThePassBetweenListings() {
        let mount = FakeMount()
        mount.directories = [
            "/root": [directory("/root/one"), directory("/root/two")],
            "/root/one": [],
            "/root/two": [],
        ]
        let clock = TestClock()
        mount.afterListing = { clock.advance(10) }

        let outcome = run(
            mount, cursor: .starting(at: URL(fileURLWithPath: "/root")),
            budget: MaterializationBudget(duration: 15, listings: 500, downloads: 500),
            clock: clock)

        XCTAssertEqual(mount.listed, ["/root", "/root/one"], "the third listing is past the deadline")
        XCTAssertTrue(outcome.stoppedOnBudget)
        XCTAssertEqual(outcome.cursor.pending.map(\.path), ["/root/two"])
        XCTAssertTrue(outcome.incomplete)
    }

    func testADownloadCapStopsThePassAndOwesTheRestOfTheFolder() {
        let mount = FakeMount()
        mount.directories = ["/root": [file("/root/a.md"), file("/root/b.md")]]
        mount.datalessPaths = ["/root/a.md", "/root/b.md"]

        let outcome = run(
            mount, cursor: .starting(at: URL(fileURLWithPath: "/root")),
            budget: MaterializationBudget(duration: 3600, listings: 500, downloads: 1))

        XCTAssertEqual(outcome.downloaded, 1)
        XCTAssertTrue(outcome.stoppedOnBudget)
        XCTAssertEqual(
            outcome.cursor.pending.map(\.path), ["/root"],
            "a folder abandoned part way through is owed in full")
    }

    func testAListingCapStopsThePass() {
        let mount = FakeMount()
        mount.directories = [
            "/root": [directory("/root/one"), directory("/root/two")],
            "/root/one": [], "/root/two": [],
        ]

        let outcome = run(
            mount, cursor: .starting(at: URL(fileURLWithPath: "/root")),
            budget: MaterializationBudget(duration: 3600, listings: 2, downloads: 500))

        XCTAssertEqual(outcome.listed, 2)
        XCTAssertTrue(outcome.stoppedOnBudget)
        XCTAssertEqual(outcome.cursor.pending.map(\.path), ["/root/two"])
    }

    // MARK: Resuming

    func testASecondPassResumesInsteadOfRestarting() {
        let mount = FakeMount()
        mount.directories = [
            "/root": [directory("/root/one"), directory("/root/two")],
            "/root/one": [file("/root/one/a.md")],
            "/root/two": [file("/root/two/b.md")],
        ]
        mount.datalessPaths = ["/root/one/a.md", "/root/two/b.md"]

        let first = run(
            mount, cursor: .starting(at: URL(fileURLWithPath: "/root")),
            budget: MaterializationBudget(duration: 3600, listings: 2, downloads: 500))
        XCTAssertEqual(mount.listed, ["/root", "/root/one"])

        let second = run(mount, cursor: first.cursor)

        XCTAssertEqual(
            mount.listed, ["/root", "/root/one", "/root/two"],
            "the resumed pass lists only what was still owed")
        XCTAssertEqual(mount.downloaded.sorted(), ["/root/one/a.md", "/root/two/b.md"])
        XCTAssertTrue(second.cursor.isFinished)
        XCTAssertFalse(second.incomplete)
    }

    func testAnAbandonedFolderIsFinishedByTheNextPassWithoutRedownloading() {
        let mount = FakeMount()
        mount.directories = ["/root": [file("/root/a.md"), file("/root/b.md")]]
        mount.datalessPaths = ["/root/a.md", "/root/b.md"]

        let first = run(
            mount, cursor: .starting(at: URL(fileURLWithPath: "/root")),
            budget: MaterializationBudget(duration: 3600, listings: 500, downloads: 1))
        let second = run(mount, cursor: first.cursor)

        XCTAssertEqual(
            mount.downloaded.sorted(), ["/root/a.md", "/root/b.md"],
            "the file the first pass got is no longer dataless, so it is not fetched twice")
        XCTAssertTrue(second.cursor.isFinished)
        XCTAssertFalse(second.incomplete)
    }

    // MARK: Cancellation

    func testCancellationStopsThePassAndReportsNothing() {
        let mount = FakeMount()
        mount.directories = [
            "/root": [directory("/root/one"), directory("/root/two")],
            "/root/one": [], "/root/two": [],
        ]
        var cancelled = false
        mount.afterListing = { cancelled = true }

        let outcome = run(
            mount, cursor: .starting(at: URL(fileURLWithPath: "/root")),
            isCancelled: { cancelled })

        XCTAssertEqual(mount.listed, ["/root"])
        XCTAssertTrue(outcome.wasCancelled)
        XCTAssertFalse(
            outcome.incomplete,
            "a cancelled pass describes a tree the app has stopped believing in")
    }

    func testCancellationIsCheckedBeforeEveryDownload() {
        let mount = FakeMount()
        mount.directories = ["/root": [file("/root/a.md"), file("/root/b.md")]]
        mount.datalessPaths = ["/root/a.md", "/root/b.md"]
        var cancelled = false
        mount.afterListing = { cancelled = true }

        let outcome = run(
            mount, cursor: .starting(at: URL(fileURLWithPath: "/root")),
            isCancelled: { cancelled })

        XCTAssertTrue(mount.downloaded.isEmpty)
        XCTAssertTrue(outcome.wasCancelled)
    }

    func testTheCancellationTokenIsReadableFromAnotherThread() {
        let token = MaterializationCancellation()
        XCTAssertFalse(token.isCancelled)

        let cancelled = expectation(description: "cancelled")
        DispatchQueue.global().async {
            token.cancel()
            cancelled.fulfill()
        }
        wait(for: [cancelled], timeout: 5)

        XCTAssertTrue(token.isCancelled)
    }


    // MARK: The cold-start cases the old walk signalled and this must keep

    func testAWholeTreeThatYieldsNoFilesIsTreatedAsCold() {
        // The documented cold failure: a folder lists, successfully, as empty,
        // because the enumeration timed out and the empty result was cached.
        // The old walk caught this as files.isEmpty and retried.
        let mount = FakeMount()
        mount.directories = ["/root": []]

        let outcome = run(mount, cursor: .starting(at: URL(fileURLWithPath: "/root")))

        XCTAssertEqual(outcome.failedListings, 0, "the listing itself succeeded")
        XCTAssertTrue(outcome.cursor.isFinished)
        XCTAssertEqual(outcome.cursor.filesSeen, 0)
        XCTAssertTrue(outcome.incomplete, "a tree with no files at all has not listed yet")
    }

    func testAFolderThatListsEmptyBesideOneThatHasFilesIsNotCold() {
        let mount = FakeMount()
        mount.directories = [
            "/root": [directory("/root/empty"), file("/root/a.md")],
            "/root/empty": [],
        ]

        let outcome = run(mount, cursor: .starting(at: URL(fileURLWithPath: "/root")))

        XCTAssertEqual(outcome.cursor.filesSeen, 1)
        XCTAssertFalse(outcome.incomplete, "a genuinely empty folder is not a failure")
    }

    func testAPermanentlyUnlistableFolderStaysOwedAcrossPasses() {
        let mount = FakeMount()
        mount.directories = ["/root": [directory("/root/cold"), file("/root/a.md")]]

        var cursor = MaterializationCursor.starting(at: URL(fileURLWithPath: "/root"))
        for pass in 1...3 {
            let outcome = run(mount, cursor: cursor)
            XCTAssertEqual(outcome.failedListings, 1, "pass \(pass) still cannot list it")
            XCTAssertTrue(outcome.incomplete, "pass \(pass) still owes it")
            XCTAssertEqual(outcome.cursor.pending.map(\.path), ["/root/cold"])
            cursor = outcome.cursor
        }
        XCTAssertEqual(
            cursor.pending.count, 1,
            "the queue does not grow each time the folder fails")
    }

    // MARK: Files that never arrive must not starve the rest

    func testFilesThatNeverMaterializeAreNotAskedForAgainInTheSameCampaign() {
        let mount = FakeMount()
        mount.directories = ["/root": [file("/root/a.md"), file("/root/b.md")]]
        mount.datalessPaths = ["/root/a.md", "/root/b.md"]
        mount.stubbornPaths = ["/root/a.md", "/root/b.md"]

        let first = run(mount, cursor: .starting(at: URL(fileURLWithPath: "/root")))
        XCTAssertEqual(first.downloaded, 2)
        XCTAssertEqual(first.stillDataless, 2)

        let second = run(mount, cursor: first.cursor)

        XCTAssertEqual(
            second.downloaded, 0,
            "the campaign already learned these do not arrive")
        XCTAssertTrue(second.incomplete, "but it still has not finished the job")
    }

    func testAStubbornFolderDoesNotConsumeTheBudgetOwedToTheRest() {
        let mount = FakeMount()
        mount.directories = [
            "/root": [directory("/root/broken"), directory("/root/good")],
            "/root/broken": [file("/root/broken/x.md"), file("/root/broken/y.md")],
            "/root/good": [file("/root/good/z.md")],
        ]
        mount.datalessPaths = [
            "/root/broken/x.md", "/root/broken/y.md", "/root/good/z.md",
        ]
        mount.stubbornPaths = ["/root/broken/x.md", "/root/broken/y.md"]

        // Two downloads a pass: without the stubborn set, the broken folder
        // would take both every pass and z.md would never be reached.
        let tight = MaterializationBudget(duration: 3600, listings: 500, downloads: 2)
        var cursor = MaterializationCursor.starting(at: URL(fileURLWithPath: "/root"))
        for _ in 1...4 { cursor = run(mount, cursor: cursor, budget: tight).cursor }

        XCTAssertTrue(
            mount.downloaded.contains("/root/good/z.md"),
            "the healthy file is reached despite the two that never arrive")
    }

    // MARK: The queue

    func testADeferredDirectoryIsOwedAfterTheOnesStillPending() {
        let mount = FakeMount()
        mount.directories = [
            "/root": [directory("/root/a"), directory("/root/b")],
            "/root/a": [file("/root/a/one.md"), file("/root/a/two.md")],
            "/root/b": [],
        ]
        mount.datalessPaths = ["/root/a/one.md", "/root/a/two.md"]

        // One download: /root/a is abandoned part way and deferred while /root/b
        // is still pending.
        let outcome = run(
            mount, cursor: .starting(at: URL(fileURLWithPath: "/root")),
            budget: MaterializationBudget(duration: 3600, listings: 500, downloads: 1))

        XCTAssertEqual(
            outcome.cursor.pending.map(\.path), ["/root/b", "/root/a"],
            "what is still pending comes before what was abandoned")
    }

    func testARelistedDirectoryDoesNotQueueItsSubdirectoriesTwice() {
        let mount = FakeMount()
        mount.directories = [
            "/root": [directory("/root/sub"), file("/root/a.md"), file("/root/b.md")],
            "/root/sub": [],
        ]
        mount.datalessPaths = ["/root/a.md", "/root/b.md"]

        let first = run(
            mount, cursor: .starting(at: URL(fileURLWithPath: "/root")),
            budget: MaterializationBudget(duration: 3600, listings: 500, downloads: 1))

        XCTAssertEqual(
            first.cursor.pending.map(\.path).filter { $0 == "/root/sub" }.count, 1,
            "the subdirectory the abandoned listing already queued is owed once")

        let second = run(mount, cursor: first.cursor)
        XCTAssertEqual(
            mount.listed.filter { $0 == "/root/sub" }.count, 1,
            "and it is listed once")
        XCTAssertTrue(second.cursor.isFinished)
    }

    // MARK: The budget, mid directory

    func testTheDeadlineStopsAPassInTheMiddleOfADirectory() {
        let mount = FakeMount()
        mount.directories = ["/root": [file("/root/a.md"), file("/root/b.md")]]
        mount.datalessPaths = ["/root/a.md", "/root/b.md"]
        let clock = TestClock()
        mount.afterDownload = { clock.advance(10) }

        let outcome = run(
            mount, cursor: .starting(at: URL(fileURLWithPath: "/root")),
            budget: MaterializationBudget(duration: 8, listings: 500, downloads: 500),
            clock: clock)

        XCTAssertEqual(mount.downloaded, ["/root/a.md"], "the second is past the deadline")
        XCTAssertTrue(outcome.stoppedOnBudget)
        XCTAssertEqual(outcome.cursor.pending.map(\.path), ["/root"])
    }

    func testCancellationIsCheckedBetweenEntriesNotOnlyBeforeTheFirst() {
        let mount = FakeMount()
        mount.directories = ["/root": [file("/root/a.md"), file("/root/b.md")]]
        mount.datalessPaths = ["/root/a.md", "/root/b.md"]
        var cancelled = false
        mount.afterDownload = { cancelled = true }

        let outcome = run(
            mount, cursor: .starting(at: URL(fileURLWithPath: "/root")),
            isCancelled: { cancelled })

        XCTAssertEqual(
            mount.downloaded, ["/root/a.md"],
            "the cancellation that arrived during the first download stops the second")
        XCTAssertTrue(outcome.wasCancelled)
    }

    func testAFailedListingCountsAgainstTheListingCap() {
        let mount = FakeMount()
        mount.directories = ["/root": [directory("/root/x"), directory("/root/y")]]

        let outcome = run(
            mount, cursor: .starting(at: URL(fileURLWithPath: "/root")),
            budget: MaterializationBudget(duration: 3600, listings: 2, downloads: 500))

        XCTAssertEqual(mount.listed, ["/root", "/root/x"])
        XCTAssertEqual(outcome.listed, 2)
    }

    // MARK: Discovery does not depend on the download budget

    func testSubdirectoriesAreQueuedEvenWhenTheBudgetRunsOutOnTheFilesAheadOfThem() {
        let mount = FakeMount()
        // The subdirectory is listed AFTER the file, so a walk that handled
        // entries in order and stopped on the budget would never queue it.
        mount.directories = [
            "/root": [file("/root/a.md"), directory("/root/late")],
            "/root/late": [file("/root/late/b.md")],
        ]
        mount.datalessPaths = ["/root/a.md", "/root/late/b.md"]

        let outcome = run(
            mount, cursor: .starting(at: URL(fileURLWithPath: "/root")),
            budget: MaterializationBudget(duration: 3600, listings: 500, downloads: 1))

        XCTAssertTrue(
            outcome.cursor.pending.contains(URL(fileURLWithPath: "/root/late")),
            "the subtree is known even though the budget went on the file before it")
    }

    func testAnEntryThatIsNeitherFileNorDirectoryIsCountedNotDropped() {
        let mount = FakeMount()
        mount.directories = ["/root": [file("/root/a.md"), unreadable("/root/odd")]]

        let outcome = run(mount, cursor: .starting(at: URL(fileURLWithPath: "/root")))

        XCTAssertEqual(outcome.unclassified, 1)
        XCTAssertTrue(mount.downloaded.isEmpty)
    }

    // MARK: The root the cursor belongs to

    func testARootThatDiffersOnlyByATrailingSlashResumes() {
        let cursor = MaterializationCursor(
            root: URL(fileURLWithPath: "/root/"),
            pending: [URL(fileURLWithPath: "/root/notes")])

        let resumed = cursor.resumed(at: URL(fileURLWithPath: "/root"))

        XCTAssertEqual(
            resumed.pending.map(\.path), ["/root/notes"],
            "the same mount spelled differently is still the same mount")
    }

    func testACursorFromAnotherMountIsNotResumed() {
        let old = MaterializationCursor(
            root: URL(fileURLWithPath: "/old"),
            pending: [URL(fileURLWithPath: "/old/notes")])

        let resumed = old.resumed(at: URL(fileURLWithPath: "/new"))

        XCTAssertEqual(resumed.root.path, "/new")
        XCTAssertEqual(resumed.pending.map(\.path), ["/new"])
    }

    func testACursorForTheSameMountIsResumed() {
        let root = URL(fileURLWithPath: "/root")
        let cursor = MaterializationCursor(
            root: root, pending: [URL(fileURLWithPath: "/root/notes")])

        XCTAssertEqual(cursor.resumed(at: root).pending.map(\.path), ["/root/notes"])
    }

    func testTheCursorAPassReturnsKeepsItsRoot() {
        let mount = FakeMount()
        mount.directories = ["/root": [directory("/root/one")]]

        let outcome = run(mount, cursor: .starting(at: URL(fileURLWithPath: "/root")))

        XCTAssertEqual(outcome.cursor.root.path, "/root")
    }

    // MARK: Packages

    func testAPackageIsMaterializedAsAUnitAndNotDescendedInto() {
        let mount = FakeMount()
        mount.directories = [
            "/root": [package("/root/note.textbundle")],
            "/root/note.textbundle": [file("/root/note.textbundle/text.md")],
        ]
        mount.datalessPaths = ["/root/note.textbundle"]

        let outcome = run(mount, cursor: .starting(at: URL(fileURLWithPath: "/root")))

        XCTAssertEqual(mount.downloaded, ["/root/note.textbundle"])
        XCTAssertEqual(mount.listed, ["/root"], "a package is content, not a folder to walk")
        XCTAssertTrue(outcome.cursor.isFinished)
    }
}
