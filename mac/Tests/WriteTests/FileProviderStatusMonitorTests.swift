import XCTest
@testable import Write

final class FileProviderStatusMonitorTests: XCTestCase {
    func testFileProviderSchemaReimportOnlyRunsForOlderSchemas() {
        XCTAssertTrue(AppDelegate.needsFileProviderSchemaReimport(storedVersion: 0))
        XCTAssertTrue(AppDelegate.needsFileProviderSchemaReimport(storedVersion: 1))
        XCTAssertTrue(AppDelegate.needsFileProviderSchemaReimport(storedVersion: 5))
        XCTAssertFalse(AppDelegate.needsFileProviderSchemaReimport(storedVersion: 6))
        XCTAssertFalse(AppDelegate.needsFileProviderSchemaReimport(storedVersion: 7))
    }

    func testUnavailableStateExplainsHowToReconnectFinder() {
        XCTAssertEqual(FileProviderStatusSnapshot.unavailable.symbolName, "icloud.slash")
        XCTAssertEqual(FileProviderStatusSnapshot.unavailable.severity, .neutral)
        XCTAssertTrue(FileProviderStatusSnapshot.unavailable.detail.contains("Finder"))
    }

    func testNoPendingItemsReportsLocalHealthyState() {
        let snapshot = FileProviderStatusSnapshot.make(pendingCount: 0)

        XCTAssertEqual(snapshot.symbolName, "checkmark.icloud")
        XCTAssertEqual(snapshot.title, "Finder is up to date")
        XCTAssertEqual(snapshot.severity, .healthy)
        XCTAssertTrue(snapshot.detail.contains("downloaded"))
    }

    func testPendingItemsReportCountProgressAndLocalRetention() {
        let snapshot = FileProviderStatusSnapshot.make(
            pendingCount: 2,
            uploadingFraction: 0.426,
            downloadingFraction: 0.1)

        XCTAssertEqual(snapshot.symbolName, "arrow.triangle.2.circlepath.icloud")
        XCTAssertEqual(snapshot.title, "Syncing 2 files")
        XCTAssertEqual(snapshot.severity, .working)
        XCTAssertEqual(
            snapshot.detail,
            "Uploading 43% · Downloading 10%. All Markdown remains available locally.")
    }

    func testCompletedAndInvalidProgressAreNotPresentedAsActiveTransfers() {
        let snapshot = FileProviderStatusSnapshot.make(
            pendingCount: 1,
            uploadingFraction: 1,
            downloadingFraction: .nan)

        XCTAssertEqual(snapshot.title, "Syncing 1 file")
        XCTAssertEqual(snapshot.detail, "All Markdown remains available locally.")
    }
}
