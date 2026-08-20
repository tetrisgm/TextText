import Foundation
import XCTest
@testable import TextTextApp

final class AppHealthReporterTests: XCTestCase {
    func testReleaseCheckUsesRuntimeChecksAndStoresOnlyContentBlindData() throws {
        let root = try temporaryDirectory(name: "workspace")
        let state = try temporaryDirectory(name: "state")
        let bundle = try releaseBundle()
        let previous = ProcessInfo.processInfo.environment["TEXTTEXT_STATE_DIR"]
        setenv("TEXTTEXT_STATE_DIR", state.path, 1)
        defer {
            if let previous {
                setenv("TEXTTEXT_STATE_DIR", previous, 1)
            } else {
                unsetenv("TEXTTEXT_STATE_DIR")
            }
        }

        let store = StateStore()
        store.clearIndex()
        let reporter = AppHealthReporter(
            stateStore: store,
            syncRootProvider: { root },
            finderStatusProvider: { .healthyFixture },
            bundle: bundle)
        let report = reporter.run(trigger: .releaseVerification)

        XCTAssertEqual(report.appIdentifier, "app.texttext.test")
        XCTAssertEqual(report.appVersion, "9.8")
        XCTAssertEqual(report.buildNumber, "76")
        XCTAssertEqual(
            report.status, .pass,
            "Failed checks: \(report.checks.filter { $0.status != .pass })")
        // The canonical list lives in TextTextHealthChecks.required, so retiring a
        // check is one edit there rather than three hardcoded lists that fail
        // one release at a time.
        XCTAssertEqual(report.checks.map(\.id), TextTextHealthChecks.required)
        XCTAssertFalse(report.checks.contains { check in
            check.metrics.keys.contains { $0.contains(" ") || $0.contains("/") }
        })

        let latest = state.appendingPathComponent("health/latest.json")
        let encoded = try String(contentsOf: latest, encoding: .utf8)
        XCTAssertFalse(encoded.contains(root.path))
        XCTAssertFalse(encoded.contains(state.path))
        XCTAssertFalse(encoded.contains("token"))
    }

    func testMissingWorkflowReceiptFailsBuildAndNamedWorkflowCheck() throws {
        let root = try temporaryDirectory(name: "workspace-missing-receipt")
        let state = try temporaryDirectory(name: "state-missing-receipt")
        let retained = TextTextWorkflowHealth.requiredCheckIDs.filter {
            $0 != TextTextWorkflowHealth.comments
        }
        let bundle = try releaseBundle(workflowSuites: retained)
        let previous = ProcessInfo.processInfo.environment["TEXTTEXT_STATE_DIR"]
        setenv("TEXTTEXT_STATE_DIR", state.path, 1)
        defer {
            if let previous {
                setenv("TEXTTEXT_STATE_DIR", previous, 1)
            } else {
                unsetenv("TEXTTEXT_STATE_DIR")
            }
        }

        let report = AppHealthReporter(
            stateStore: StateStore(),
            syncRootProvider: { root },
            finderStatusProvider: { .healthyFixture },
            bundle: bundle
        ).run(trigger: .releaseVerification)

        XCTAssertEqual(report.status, .fail)
        XCTAssertEqual(
            report.checks.first(where: { $0.id == "build.attestation" })?.status,
            .fail)
        let comments = try XCTUnwrap(
            report.checks.first(where: { $0.id == TextTextWorkflowHealth.comments }))
        XCTAssertEqual(comments.status, .fail)
        XCTAssertEqual(comments.metrics["receipt_present"], 0)
        XCTAssertEqual(comments.metrics["receipt_passed"], 0)
        XCTAssertEqual(
            report.checks.first(where: {
                $0.id == TextTextWorkflowHealth.folderTrashRestore
            })?.status,
            .pass)
    }

    func testCorruptIndexIsAHealthFailure() throws {
        let root = try temporaryDirectory(name: "workspace")
        let state = try temporaryDirectory(name: "state")
        let bundle = try releaseBundle()
        let previous = ProcessInfo.processInfo.environment["TEXTTEXT_STATE_DIR"]
        setenv("TEXTTEXT_STATE_DIR", state.path, 1)
        defer {
            if let previous {
                setenv("TEXTTEXT_STATE_DIR", previous, 1)
            } else {
                unsetenv("TEXTTEXT_STATE_DIR")
            }
        }
        let store = StateStore()
        try Data("not-json".utf8).write(to: store.indexURL)
        let report = AppHealthReporter(
            stateStore: store,
            syncRootProvider: { root },
            finderStatusProvider: { .healthyFixture },
            bundle: bundle
        ).run(trigger: .manual)

        XCTAssertEqual(report.status, .fail)
        XCTAssertEqual(
            report.checks.first(where: { $0.id == "sync.index" })?.status,
            .fail)
    }

    func testMissingLegacyIndexPassesForFileProviderOnlyApp() throws {
        let root = try temporaryDirectory(name: "workspace-no-index")
        let state = try temporaryDirectory(name: "state-no-index")
        let bundle = try releaseBundle()
        let previous = ProcessInfo.processInfo.environment["TEXTTEXT_STATE_DIR"]
        setenv("TEXTTEXT_STATE_DIR", state.path, 1)
        defer {
            if let previous {
                setenv("TEXTTEXT_STATE_DIR", previous, 1)
            } else {
                unsetenv("TEXTTEXT_STATE_DIR")
            }
        }

        let report = AppHealthReporter(
            stateStore: StateStore(),
            syncRootProvider: { root },
            finderStatusProvider: { .healthyFixture },
            bundle: bundle
        ).run(trigger: .manual)
        let check = try XCTUnwrap(
            report.checks.first(where: { $0.id == "sync.index" }))

        XCTAssertEqual(check.status, .pass)
        XCTAssertEqual(check.metrics["present"], 0)
        XCTAssertEqual(check.metrics["decodable"], 1)
    }

    func testFinderHealthPassesAfterBoundedWorkingStateSettles() throws {
        let root = try temporaryDirectory(name: "workspace-settle")
        let state = try temporaryDirectory(name: "state-settle")
        let bundle = try releaseBundle()
        let previous = ProcessInfo.processInfo.environment["TEXTTEXT_STATE_DIR"]
        setenv("TEXTTEXT_STATE_DIR", state.path, 1)
        defer {
            if let previous {
                setenv("TEXTTEXT_STATE_DIR", previous, 1)
            } else {
                unsetenv("TEXTTEXT_STATE_DIR")
            }
        }
        var snapshots: [FileProviderStatusSnapshot] = [
            .checking,
            .workingFixture,
            .healthyFixture,
        ]
        let reporter = AppHealthReporter(
            stateStore: StateStore(),
            syncRootProvider: { root },
            finderStatusProvider: { snapshots.removeFirst() },
            finderReadinessProbe: FileProviderReadinessProbe(
                maximumSamples: 4, interval: 0, wait: { _ in }),
            bundle: bundle)

        let report = reporter.run(trigger: .manual)
        let check = try XCTUnwrap(
            report.checks.first(where: { $0.id == "finder.provider" }))

        XCTAssertEqual(check.status, .pass)
        XCTAssertEqual(check.metrics["healthy"], 1)
        XCTAssertEqual(check.metrics["readiness_samples"], 3)
        XCTAssertEqual(check.metrics["started_working"], 1)
        XCTAssertEqual(check.metrics["became_healthy"], 1)
        XCTAssertEqual(check.metrics["working_exhausted"], 0)
    }

    func testFinderHealthPreservesPendingWarningAndProviderFailure() throws {
        let root = try temporaryDirectory(name: "workspace-pending")
        let state = try temporaryDirectory(name: "state-pending")
        let bundle = try releaseBundle()
        let previous = ProcessInfo.processInfo.environment["TEXTTEXT_STATE_DIR"]
        setenv("TEXTTEXT_STATE_DIR", state.path, 1)
        defer {
            if let previous {
                setenv("TEXTTEXT_STATE_DIR", previous, 1)
            } else {
                unsetenv("TEXTTEXT_STATE_DIR")
            }
        }
        let store = StateStore()
        let probe = FileProviderReadinessProbe(
            maximumSamples: 3, interval: 0, wait: { _ in })
        let pending = AppHealthReporter(
            stateStore: store,
            syncRootProvider: { root },
            finderStatusProvider: { .workingFixture },
            finderReadinessProbe: probe,
            bundle: bundle
        ).run(trigger: .manual)
        let pendingCheck = try XCTUnwrap(
            pending.checks.first(where: { $0.id == "finder.provider" }))

        XCTAssertEqual(pendingCheck.status, .warning)
        XCTAssertEqual(pendingCheck.metrics["readiness_samples"], 3)
        XCTAssertEqual(pendingCheck.metrics["working_exhausted"], 1)

        let failed = AppHealthReporter(
            stateStore: store,
            syncRootProvider: { root },
            finderStatusProvider: { .warningFixture },
            finderReadinessProbe: probe,
            bundle: bundle
        ).run(trigger: .manual)
        let failedCheck = try XCTUnwrap(
            failed.checks.first(where: { $0.id == "finder.provider" }))

        XCTAssertEqual(failedCheck.status, .fail)
        XCTAssertEqual(failedCheck.metrics["warning"], 1)
        XCTAssertEqual(failedCheck.metrics["readiness_samples"], 1)
    }

    func testFinderHealthDoesNotTrustIdleProviderWithoutAVisibleWorkspace() throws {
        let root = try temporaryDirectory(name: "workspace-no-visible-folder")
        let state = try temporaryDirectory(name: "state-no-visible-folder")
        let bundle = try releaseBundle()
        let previous = ProcessInfo.processInfo.environment["TEXTTEXT_STATE_DIR"]
        setenv("TEXTTEXT_STATE_DIR", state.path, 1)
        defer {
            if let previous {
                setenv("TEXTTEXT_STATE_DIR", previous, 1)
            } else {
                unsetenv("TEXTTEXT_STATE_DIR")
            }
        }
        let store = StateStore()
        store.saveCredentials(Credentials(
            token: "wsk_health_fixture",
            serverOrigin: "https://texttext.example",
            tokenName: "Health fixture",
            linkedAt: Date(timeIntervalSince1970: 0)))
        let reporter = AppHealthReporter(
            stateStore: store,
            syncRootProvider: { root },
            finderStatusProvider: { .healthyFixture },
            bundle: bundle)

        // File Provider owns a root-level Data directory for attachments. Its
        // presence proves the mount exists, but not that a workspace can be
        // opened in Finder.
        try FileManager.default.createDirectory(
            at: root.appendingPathComponent("Data", isDirectory: true),
            withIntermediateDirectories: true)

        let missing = reporter.run(trigger: .manual)
        let missingCheck = try XCTUnwrap(
            missing.checks.first(where: { $0.id == "finder.provider" }))
        XCTAssertEqual(missingCheck.status, .fail)
        XCTAssertEqual(missingCheck.metrics["healthy"], 1)
        XCTAssertEqual(missingCheck.metrics["mount_enumerated"], 1)
        XCTAssertEqual(missingCheck.metrics["workspace_visible"], 0)

        try FileManager.default.createDirectory(
            at: root.appendingPathComponent("Health workspace", isDirectory: true),
            withIntermediateDirectories: true)
        let visible = reporter.run(trigger: .manual)
        let visibleCheck = try XCTUnwrap(
            visible.checks.first(where: { $0.id == "finder.provider" }))
        XCTAssertEqual(visibleCheck.status, .pass)
        XCTAssertEqual(visibleCheck.metrics["mount_enumerated"], 1)
        XCTAssertEqual(visibleCheck.metrics["workspace_visible"], 1)
        XCTAssertEqual(visibleCheck.metrics["mount_entry_count"], 2)
    }

    func testUserDisabledFinderDomainDoesNotInvalidateARelease() throws {
        let root = try temporaryDirectory(name: "workspace-user-disabled")
        let state = try temporaryDirectory(name: "state-user-disabled")
        let bundle = try releaseBundle()
        let previous = ProcessInfo.processInfo.environment["TEXTTEXT_STATE_DIR"]
        setenv("TEXTTEXT_STATE_DIR", state.path, 1)
        defer {
            if let previous {
                setenv("TEXTTEXT_STATE_DIR", previous, 1)
            } else {
                unsetenv("TEXTTEXT_STATE_DIR")
            }
        }
        let store = StateStore()
        store.saveCredentials(Credentials(
            token: "wsk_health_fixture",
            serverOrigin: "https://texttext.example",
            tokenName: "Health fixture",
            linkedAt: Date(timeIntervalSince1970: 0)))
        let reporter = AppHealthReporter(
            stateStore: store,
            syncRootProvider: { root },
            finderStatusProvider: { .healthyFixture },
            fileProviderDomainEnabledProvider: { false },
            bundle: bundle)

        let manual = reporter.run(trigger: .manual)
        let manualStorageCheck = try XCTUnwrap(
            manual.checks.first(where: { $0.id == "workspace.storage" }))
        let manualCheck = try XCTUnwrap(
            manual.checks.first(where: { $0.id == "finder.provider" }))
        XCTAssertEqual(manualStorageCheck.status, .warning)
        XCTAssertEqual(manualStorageCheck.metrics["domain_enabled_known"], 1)
        XCTAssertEqual(manualStorageCheck.metrics["domain_enabled"], 0)
        XCTAssertEqual(manualStorageCheck.metrics["user_disabled"], 1)
        XCTAssertEqual(manualCheck.status, .warning)
        XCTAssertEqual(manualCheck.metrics["domain_enabled_known"], 1)
        XCTAssertEqual(manualCheck.metrics["domain_enabled"], 0)
        XCTAssertEqual(manualCheck.metrics["user_disabled"], 1)

        let release = reporter.run(trigger: .releaseVerification)
        let releaseStorageCheck = try XCTUnwrap(
            release.checks.first(where: { $0.id == "workspace.storage" }))
        let releaseCheck = try XCTUnwrap(
            release.checks.first(where: { $0.id == "finder.provider" }))
        XCTAssertEqual(releaseStorageCheck.status, .pass)
        XCTAssertEqual(releaseCheck.status, .pass)
        XCTAssertEqual(release.status, .pass)
    }

    private func temporaryDirectory(name: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("texttext-health-\(name)-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700], ofItemAtPath: url.path)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    private func releaseBundle(
        workflowSuites: [String] = TextTextWorkflowHealth.requiredCheckIDs
    ) throws -> Bundle {
        let parent = try temporaryDirectory(name: "release-bundle")
        let app = parent.appendingPathComponent("Release.app", isDirectory: true)
        let contents = app.appendingPathComponent("Contents", isDirectory: true)
        let plugins = contents.appendingPathComponent("PlugIns", isDirectory: true)
        let resources = contents.appendingPathComponent("Resources", isDirectory: true)
        try FileManager.default.createDirectory(at: plugins, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true)
        for name in [
            "TextTextShareExtension.appex",
            "TextTextQuickLookPreview.appex",
            "TextTextFileProviderExtension.appex",
        ] {
            try FileManager.default.createDirectory(
                at: plugins.appendingPathComponent(name), withIntermediateDirectories: true)
        }
        let info: [String: Any] = [
            "CFBundleIdentifier": "app.texttext.test",
            "CFBundleName": "TextText",
            "CFBundlePackageType": "APPL",
            "CFBundleShortVersionString": "9.8",
            "CFBundleVersion": "76",
            "SUFeedURL": "https://texttext.example/appcast.xml",
            "SUPublicEDKey": "a-real-shaped-test-key",
        ]
        let data = try PropertyListSerialization.data(
            fromPropertyList: info, format: .xml, options: 0)
        try data.write(to: contents.appendingPathComponent("Info.plist"))
        let suites: [[String: Any]] = [
            ["id": "web.unit", "status": "pass", "durationMilliseconds": 100],
            ["id": "native.unit", "status": "pass", "durationMilliseconds": 200],
        ] + workflowSuites.map {
            ["id": $0, "status": "pass", "durationMilliseconds": 0]
        }
        let attestation: [String: Any] = [
            "schemaVersion": 1,
            "appVersion": "9.8",
            "buildNumber": "76",
            "sourceCommit": "health-test-revision",
            "workflowContractHash": String(repeating: "a", count: 64),
            "releaseGateDurationMilliseconds": 300,
            "generatedAt": "2026-07-14T00:00:00Z",
            "suites": suites,
        ]
        let attestationData = try JSONSerialization.data(
            withJSONObject: attestation, options: [.prettyPrinted, .sortedKeys])
        try attestationData.write(to: resources.appendingPathComponent(
            "AppHealthBuildAttestation.json"))
        return try XCTUnwrap(Bundle(url: app))
    }
}

private extension FileProviderStatusSnapshot {
    static let healthyFixture = FileProviderStatusSnapshot(
        symbolName: "checkmark.icloud",
        title: "Ready",
        detail: "Ready",
        severity: .healthy)

    static let workingFixture = FileProviderStatusSnapshot(
        symbolName: "arrow.triangle.2.circlepath.icloud",
        title: "Working",
        detail: "Working",
        severity: .working)

    static let warningFixture = FileProviderStatusSnapshot(
        symbolName: "exclamationmark.icloud",
        title: "Failed",
        detail: "Failed",
        severity: .warning)
}
