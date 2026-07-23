import FileProvider
import XCTest
@testable import Write

final class FileProviderStatusMonitorTests: XCTestCase {
    func testFileProviderSchemaRepairOnlyRunsForOlderSchemas() {
        XCTAssertTrue(AppDelegate.needsFileProviderSchemaRepair(storedVersion: 0))
        XCTAssertTrue(AppDelegate.needsFileProviderSchemaRepair(storedVersion: 1))
        XCTAssertTrue(AppDelegate.needsFileProviderSchemaRepair(storedVersion: 6))
        XCTAssertTrue(AppDelegate.needsFileProviderSchemaRepair(storedVersion: 7))
        XCTAssertTrue(AppDelegate.needsFileProviderSchemaRepair(storedVersion: 8))
        XCTAssertTrue(AppDelegate.needsFileProviderSchemaRepair(storedVersion: 9))
        // Schema 11 (posts as .textpack): 10 is now an older schema and must rebuild.
        XCTAssertTrue(AppDelegate.needsFileProviderSchemaRepair(storedVersion: 10))
        // v12 rebuilds so the post-.textpack mount recreates fresh placeholders
        // that materialize with a non-nil documentSize (v11 left them 0-byte).
        XCTAssertTrue(AppDelegate.needsFileProviderSchemaRepair(storedVersion: 11))
        // v13 rebuilds the disposable provider cache after canonical documents
        // became mandatory, removing stale live projections without touching Trash.
        XCTAssertTrue(AppDelegate.needsFileProviderSchemaRepair(storedVersion: 12))
        XCTAssertFalse(AppDelegate.needsFileProviderSchemaRepair(storedVersion: 13))
    }

    func testFileProviderSchemaRepairRequiresASettledPendingSet() {
        XCTAssertEqual(
            AppDelegate.fileProviderSchemaRepairDecision(
                pendingCount: 0, error: nil),
            .rebuildCache)
        XCTAssertEqual(
            AppDelegate.fileProviderSchemaRepairDecision(
                pendingCount: 2, error: nil),
            .waitForPendingItems)
        XCTAssertEqual(
            AppDelegate.fileProviderSchemaRepairDecision(
                pendingCount: 0,
                error: NSError(domain: "test", code: 1)),
            .retry)
    }

    func testWakeAndFocusNotificationsCoalesceIntoOneRecovery() {
        XCTAssertTrue(AppDelegate.shouldRunBackgroundRecovery(
            lastRunUptime: nil, nowUptime: 10))
        XCTAssertFalse(AppDelegate.shouldRunBackgroundRecovery(
            lastRunUptime: 10, nowUptime: 10.5))
        XCTAssertTrue(AppDelegate.shouldRunBackgroundRecovery(
            lastRunUptime: 10, nowUptime: 11))
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

    func testActiveTransferWithoutPendingEnumerationIsStillSyncing() {
        let snapshot = FileProviderStatusSnapshot.make(
            pendingCount: 0,
            uploadingFraction: 0.25)

        XCTAssertEqual(snapshot.title, "Finder is syncing")
        XCTAssertEqual(snapshot.severity, .working)
        XCTAssertTrue(snapshot.detail.contains("Uploading 25%"))
    }

    func testReadinessProbeAllowsTransientWorkingStateToSettle() {
        var snapshots: [FileProviderStatusSnapshot] = [
            .checking,
            .make(pendingCount: 1),
            .make(pendingCount: 0),
        ]
        var waits: [TimeInterval] = []
        let probe = FileProviderReadinessProbe(
            maximumSamples: 5,
            interval: 0.25,
            wait: { waits.append($0) })

        let result = probe.run { snapshots.removeFirst() }

        XCTAssertEqual(result.snapshot.severity, .healthy)
        XCTAssertEqual(result.sampleCount, 3)
        XCTAssertTrue(result.startedWorking)
        XCTAssertTrue(result.becameHealthy)
        XCTAssertFalse(result.exhausted)
        XCTAssertEqual(waits, [0.25, 0.25])
    }

    func testReadinessProbeBoundsPersistentPendingWork() {
        var sampleCount = 0
        let probe = FileProviderReadinessProbe(
            maximumSamples: 3, interval: 10, wait: { _ in })

        let result = probe.run {
            sampleCount += 1
            return .make(pendingCount: 2)
        }

        XCTAssertEqual(sampleCount, 3)
        XCTAssertEqual(result.sampleCount, 3)
        XCTAssertEqual(result.snapshot.severity, .working)
        XCTAssertFalse(result.becameHealthy)
        XCTAssertTrue(result.exhausted)
    }

    func testReadinessProbeStopsImmediatelyOnProviderError() {
        var snapshots: [FileProviderStatusSnapshot] = [
            .checking,
            .warning(TestStatusError.failed),
            .make(pendingCount: 0),
        ]
        var waitCount = 0
        let probe = FileProviderReadinessProbe(
            maximumSamples: 5,
            interval: 0,
            wait: { _ in waitCount += 1 })

        let result = probe.run { snapshots.removeFirst() }

        XCTAssertEqual(result.snapshot.severity, .warning)
        XCTAssertEqual(result.sampleCount, 2)
        XCTAssertEqual(waitCount, 1)
        XCTAssertFalse(result.exhausted)
        XCTAssertEqual(snapshots.count, 1)
    }

    func testRefreshesCoalesceWithoutPublishingAStaleIdleReset() {
        let provider = FakeFileProviderStatusProvider()
        let monitor = FileProviderStatusMonitor(
            notificationCenter: NotificationCenter(),
            providerFactory: { _ in provider })
        let domain = NSFileProviderDomain(
            identifier: NSFileProviderDomainIdentifier(rawValue: "status-test"),
            displayName: "Status Test")
        var snapshots: [FileProviderStatusSnapshot] = []
        monitor.onChange = { snapshots.append($0) }

        monitor.bind(to: domain)
        XCTAssertEqual(provider.enumerationCount, 1)
        XCTAssertEqual(snapshots, [.checking])

        monitor.refresh()
        monitor.refresh()
        XCTAssertEqual(provider.enumerationCount, 1)
        XCTAssertEqual(provider.cancelCount, 0)

        let coalescedRefresh = expectation(description: "coalesced refresh started")
        provider.onEnumerationStarted = { count in
            if count == 2 { coalescedRefresh.fulfill() }
        }
        provider.completeNext(pendingCount: 0)
        wait(for: [coalescedRefresh], timeout: 10)

        XCTAssertEqual(snapshots, [.checking],
                       "the stale first result must not flash an idle state")
        provider.completeNext(pendingCount: 1)
        let working = expectation(description: "working state published")
        DispatchQueue.main.async {
            if monitor.snapshot.title == "Syncing 1 file" {
                working.fulfill()
            }
        }
        wait(for: [working], timeout: 10)
        XCTAssertEqual(monitor.snapshot.severity, .working)

        let callbackCount = snapshots.count
        monitor.bind(to: domain)
        XCTAssertEqual(provider.enumerationCount, 3)
        XCTAssertEqual(snapshots.count, callbackCount,
                       "rebinding the same domain must not reset to checking")
        XCTAssertEqual(monitor.snapshot.title, "Syncing 1 file")
    }

    func testEnumerationErrorPersistsUntilASuccessfulRefresh() {
        let provider = FakeFileProviderStatusProvider()
        let monitor = FileProviderStatusMonitor(
            notificationCenter: NotificationCenter(),
            providerFactory: { _ in provider })
        let domain = NSFileProviderDomain(
            identifier: NSFileProviderDomainIdentifier(rawValue: "error-test"),
            displayName: "Error Test")
        monitor.bind(to: domain)

        let warning = expectation(description: "warning published")
        monitor.onChange = { snapshot in
            if snapshot.severity == .warning { warning.fulfill() }
        }
        provider.completeNext(error: TestStatusError.failed)
        wait(for: [warning], timeout: 10)
        XCTAssertEqual(monitor.snapshot.severity, .warning)

        monitor.refresh()
        XCTAssertEqual(monitor.snapshot.severity, .warning,
                       "starting a refresh must not erase the last known error")
        let healthy = expectation(description: "healthy published")
        monitor.onChange = { snapshot in
            if snapshot.severity == .healthy { healthy.fulfill() }
        }
        provider.completeNext(pendingCount: 0)
        wait(for: [healthy], timeout: 10)
        XCTAssertEqual(monitor.snapshot.title, "Finder is up to date")
    }
}

private enum TestStatusError: LocalizedError {
    case failed

    var errorDescription: String? { "status failed" }
}

private final class FakePendingEnumeration: FileProviderPendingEnumeration {
    private let onCancel: () -> Void
    private(set) var isCancelled = false

    init(onCancel: @escaping () -> Void) {
        self.onCancel = onCancel
    }

    func cancel() {
        guard !isCancelled else { return }
        isCancelled = true
        onCancel()
    }
}

private final class FakeFileProviderStatusProvider: FileProviderStatusProviding {
    private struct Request {
        let token: FakePendingEnumeration
        let completion: (Int, Error?) -> Void
    }

    var onEnumerationStarted: ((Int) -> Void)?
    private(set) var enumerationCount = 0
    private(set) var cancelCount = 0
    private var requests: [Request] = []

    var uploadingProgress = Progress(totalUnitCount: 0)
    var downloadingProgress = Progress(totalUnitCount: 0)

    func enumeratePendingItems(
        completion: @escaping (Int, Error?) -> Void
    ) -> any FileProviderPendingEnumeration {
        enumerationCount += 1
        let token = FakePendingEnumeration { [weak self] in
            self?.cancelCount += 1
        }
        requests.append(Request(token: token, completion: completion))
        onEnumerationStarted?(enumerationCount)
        return token
    }

    func completeNext(pendingCount: Int = 0, error: Error? = nil) {
        let request = requests.removeFirst()
        guard !request.token.isCancelled else { return }
        request.completion(pendingCount, error)
    }
}
