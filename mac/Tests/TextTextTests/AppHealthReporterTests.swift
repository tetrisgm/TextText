import Foundation
import TextTextWorkspaceCore
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
        let reporter = AppHealthReporter(
            stateStore: store,
            syncRootProvider: { root },
            finderStatusProvider: { .healthyFixture },
            vaultSelectionProvider: { .none },
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
            vaultSelectionProvider: { .none },
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

    func testMissingAttestationWarnsOnlyForExplicitLocalBuild() throws {
        let root = try temporaryDirectory(name: "workspace-local-build")
        let state = try temporaryDirectory(name: "state-local-build")
        let previous = ProcessInfo.processInfo.environment["TEXTTEXT_STATE_DIR"]
        setenv("TEXTTEXT_STATE_DIR", state.path, 1)
        defer {
            if let previous {
                setenv("TEXTTEXT_STATE_DIR", previous, 1)
            } else {
                unsetenv("TEXTTEXT_STATE_DIR")
            }
        }

        let release = try releaseBundle(includeAttestation: false)
        let local = try releaseBundle(
            localDevelopment: true, includeAttestation: false)
        let reportForBundle: (Bundle) -> TextTextHealthReport = { bundle in
            AppHealthReporter(
                stateStore: StateStore(),
                syncRootProvider: { root },
                finderStatusProvider: { .healthyFixture },
                vaultSelectionProvider: { .none },
                bundle: bundle
            ).run(trigger: .releaseVerification)
        }
        let releaseReport = reportForBundle(release)
        let localReport = reportForBundle(local)

        XCTAssertEqual(releaseReport.status, .fail)
        XCTAssertEqual(localReport.status, .warning)
        XCTAssertEqual(releaseReport.checks.first {
            $0.id == "build.attestation"
        }?.status, .fail)
        XCTAssertEqual(localReport.checks.first {
            $0.id == "build.attestation"
        }?.status, .warning)
        XCTAssertTrue(localReport.checks.filter {
            TextTextWorkflowHealth.requiredCheckIDs.contains($0.id)
        }.allSatisfy { $0.status == .warning })

        let malformed = try releaseBundle(
            localDevelopment: true, malformedAttestation: true)
        XCTAssertEqual(reportForBundle(malformed).status, .fail)
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
            vaultSelectionProvider: { .none },
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
            vaultSelectionProvider: { .none },
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
            vaultSelectionProvider: { .none },
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
            vaultSelectionProvider: { .none },
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

    func testUnlinkedStaleMountDoesNotInvalidateARelease() throws {
        let workspace = try temporaryDirectory(name: "workspace-unlinked-stale")
            .appendingPathComponent("stale-file-provider-mount", isDirectory: true)
        let state = try temporaryDirectory(name: "state-unlinked-stale")
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
            syncRootProvider: { workspace },
            finderStatusProvider: { .healthyFixture },
            fileProviderDomainEnabledProvider: { true },
            vaultSelectionProvider: { .none },
            bundle: bundle
        ).run(trigger: .releaseVerification)
        let storage = try XCTUnwrap(
            report.checks.first(where: { $0.id == "workspace.storage" }))
        let finder = try XCTUnwrap(
            report.checks.first(where: { $0.id == "finder.provider" }))

        XCTAssertEqual(storage.status, .pass)
        XCTAssertEqual(storage.metrics["linked"], 0)
        XCTAssertEqual(storage.metrics["mount_resolved"], 1)
        XCTAssertEqual(storage.metrics["present"], 0)
        XCTAssertEqual(storage.metrics["enumerated"], 0)
        XCTAssertEqual(finder.status, .pass)
        XCTAssertEqual(report.status, .pass)
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
            vaultSelectionProvider: { .none },
            bundle: bundle)

        let manual = reporter.run(trigger: .manual)
        let manualStorageCheck = try XCTUnwrap(
            manual.checks.first(where: { $0.id == "workspace.storage" }))
        let manualCheck = try XCTUnwrap(
            manual.checks.first(where: { $0.id == "finder.provider" }))
        XCTAssertEqual(manualStorageCheck.status, .pass)
        XCTAssertEqual(manualStorageCheck.metrics["domain_enabled_known"], 1)
        XCTAssertEqual(manualStorageCheck.metrics["domain_enabled"], 0)
        XCTAssertEqual(manualStorageCheck.metrics["user_disabled"], 1)
        XCTAssertEqual(manualCheck.status, .pass)
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

    // MARK: Selected ordinary folder (iCloud or local) as the workspace home

    func testSelectedVaultWithBookmarkPassesStorageAndIgnoresBrokenOptionalMount() throws {
        let vault = try temporaryDirectory(name: "vault-selected")
        try FileManager.default.createDirectory(
            at: vault.appendingPathComponent("Shoku's Space", isDirectory: true),
            withIntermediateDirectories: true)
        // A resolved File Provider URL whose directory macOS refuses to
        // enumerate: the live state of the preexisting CloudStorage mount.
        let mount = try temporaryDirectory(name: "mount-broken")
            .appendingPathComponent("TextText-TextText", isDirectory: true)
        let state = try temporaryDirectory(name: "state-vault-selected")
        let bundle = try releaseBundle()
        try withStateDirectory(state) {
            let store = StateStore()
            store.saveCredentials(.healthFixture)
            let bookmark = try vault.bookmarkData(
                options: [.withSecurityScope], includingResourceValuesForKeys: nil,
                relativeTo: nil)
            let configuration = LocalVaultConfiguration(
                rootPath: vault.path, bookmarkData: bookmark)

            let report = AppHealthReporter(
                stateStore: store,
                syncRootProvider: { mount },
                finderStatusProvider: { .healthyFixture },
                fileProviderDomainEnabledProvider: { true },
                vaultSelectionProvider: { .selected(configuration) },
                bundle: bundle
            ).run(trigger: .releaseVerification)
            let storage = try XCTUnwrap(
                report.checks.first(where: { $0.id == "workspace.storage" }))
            let finder = try XCTUnwrap(
                report.checks.first(where: { $0.id == "finder.provider" }))

            XCTAssertEqual(storage.status, .pass)
            XCTAssertEqual(storage.metrics["vault_selected"], 1)
            XCTAssertEqual(storage.metrics["bookmark_present"], 1)
            XCTAssertEqual(storage.metrics["bookmark_resolved"], 1)
            XCTAssertEqual(storage.metrics["enumerated"], 1)
            XCTAssertEqual(storage.metrics["entry_count"], 1)
            XCTAssertEqual(storage.metrics["mount_resolved"], 0)
            // The mount is optional with a selected folder: it does not block
            // the release, and it is not reported healthy either.
            XCTAssertEqual(finder.status, .warning)
            XCTAssertEqual(finder.metrics["mount_optional"], 1)
            XCTAssertEqual(finder.metrics["mount_resolved"], 1)
            XCTAssertEqual(finder.metrics["mount_enumerated"], 0)
            XCTAssertEqual(report.status, .warning)
        }
    }

    func testSelectedVaultPassesWhenOptionalMountIsAbsentOrUsable() throws {
        let vault = try temporaryDirectory(name: "vault-plain")
        let state = try temporaryDirectory(name: "state-vault-plain")
        let bundle = try releaseBundle()
        try withStateDirectory(state) {
            let store = StateStore()
            store.saveCredentials(.healthFixture)
            let configuration = LocalVaultConfiguration(
                rootPath: vault.path, bookmarkData: nil)

            let absent = AppHealthReporter(
                stateStore: store,
                syncRootProvider: { nil },
                finderStatusProvider: { .healthyFixture },
                vaultSelectionProvider: { .selected(configuration) },
                bundle: bundle
            ).run(trigger: .releaseVerification)
            XCTAssertEqual(absent.status, .pass, "\(absent.checks.filter { $0.status != .pass })")
            let absentStorage = try XCTUnwrap(
                absent.checks.first(where: { $0.id == "workspace.storage" }))
            XCTAssertEqual(absentStorage.metrics["bookmark_present"], 0)
            XCTAssertEqual(absentStorage.metrics["vault_accessible"], 1)
            let absentFinder = try XCTUnwrap(
                absent.checks.first(where: { $0.id == "finder.provider" }))
            XCTAssertEqual(absentFinder.status, .pass)
            XCTAssertEqual(absentFinder.metrics["mount_resolved"], 0)

            let mount = try temporaryDirectory(name: "mount-usable")
            try FileManager.default.createDirectory(
                at: mount.appendingPathComponent("Health workspace", isDirectory: true),
                withIntermediateDirectories: true)
            let usable = AppHealthReporter(
                stateStore: store,
                syncRootProvider: { mount },
                finderStatusProvider: { .healthyFixture },
                fileProviderDomainEnabledProvider: { true },
                vaultSelectionProvider: { .selected(configuration) },
                bundle: bundle
            ).run(trigger: .releaseVerification)
            let usableFinder = try XCTUnwrap(
                usable.checks.first(where: { $0.id == "finder.provider" }))
            XCTAssertEqual(usableFinder.status, .pass)
            XCTAssertEqual(usableFinder.metrics["mount_optional"], 1)
            XCTAssertEqual(usableFinder.metrics["workspace_visible"], 1)
            XCTAssertEqual(usable.status, .pass)
        }
    }

    func testInaccessibleSelectedVaultFailsEvenWhenMountIsHealthy() throws {
        let missing = try temporaryDirectory(name: "vault-missing")
            .appendingPathComponent("Workspace", isDirectory: true)
        let mount = try temporaryDirectory(name: "mount-healthy")
        try FileManager.default.createDirectory(
            at: mount.appendingPathComponent("Health workspace", isDirectory: true),
            withIntermediateDirectories: true)
        let state = try temporaryDirectory(name: "state-vault-missing")
        let bundle = try releaseBundle()
        try withStateDirectory(state) {
            let store = StateStore()
            store.saveCredentials(.healthFixture)
            let reportFor: (TextTextHealthVaultSelection) -> TextTextHealthReport = { selection in
                AppHealthReporter(
                    stateStore: store,
                    syncRootProvider: { mount },
                    finderStatusProvider: { .healthyFixture },
                    fileProviderDomainEnabledProvider: { true },
                    vaultSelectionProvider: { selection },
                    bundle: bundle
                ).run(trigger: .releaseVerification)
            }

            let gone = reportFor(.selected(LocalVaultConfiguration(
                rootPath: missing.path, bookmarkData: nil)))
            let goneStorage = try XCTUnwrap(
                gone.checks.first(where: { $0.id == "workspace.storage" }))
            XCTAssertEqual(goneStorage.status, .fail)
            XCTAssertEqual(goneStorage.metrics["vault_selected"], 1)
            XCTAssertEqual(goneStorage.metrics["present"], 0)
            XCTAssertEqual(goneStorage.metrics["vault_accessible"], 0)
            XCTAssertEqual(gone.status, .fail)

            // A bookmark that no longer resolves is an inaccessible folder too.
            let unresolvable = reportFor(.selected(LocalVaultConfiguration(
                rootPath: mount.path, bookmarkData: Data("not a bookmark".utf8))))
            let unresolvableStorage = try XCTUnwrap(
                unresolvable.checks.first(where: { $0.id == "workspace.storage" }))
            XCTAssertEqual(unresolvableStorage.status, .fail)
            XCTAssertEqual(unresolvableStorage.metrics["bookmark_present"], 1)
            XCTAssertEqual(unresolvableStorage.metrics["bookmark_resolved"], 0)

            let unreadable = reportFor(.unreadable)
            let unreadableStorage = try XCTUnwrap(
                unreadable.checks.first(where: { $0.id == "workspace.storage" }))
            XCTAssertEqual(unreadableStorage.status, .fail)
            XCTAssertEqual(unreadableStorage.metrics["vault_config_readable"], 0)
            XCTAssertEqual(unreadable.status, .fail)
        }
    }

    func testNoSelectedVaultKeepsMountAsTheOnlyHome() throws {
        let mount = try temporaryDirectory(name: "mount-only-home")
            .appendingPathComponent("not-enumerable", isDirectory: true)
        let state = try temporaryDirectory(name: "state-mount-only")
        let bundle = try releaseBundle()
        try withStateDirectory(state) {
            let store = StateStore()
            store.saveCredentials(.healthFixture)
            let report = AppHealthReporter(
                stateStore: store,
                syncRootProvider: { mount },
                finderStatusProvider: { .healthyFixture },
                fileProviderDomainEnabledProvider: { true },
                vaultSelectionProvider: { .none },
                bundle: bundle
            ).run(trigger: .releaseVerification)
            XCTAssertEqual(
                report.checks.first(where: { $0.id == "workspace.storage" })?.status, .fail)
            XCTAssertEqual(
                report.checks.first(where: { $0.id == "finder.provider" })?.status, .fail)
            XCTAssertEqual(
                report.checks.first(where: { $0.id == "finder.provider" })?
                    .metrics["mount_optional"], 0)
        }
    }

    func testVaultSelectionReadsSavedConfigurationWithoutRewritingIt() throws {
        let directory = try temporaryDirectory(name: "vault-config")
        let configURL = directory.appendingPathComponent("vault.json")
        let environment = ["TEXTTEXT_VAULT_CONFIG": configURL.path]

        XCTAssertEqual(TextTextHealthVaultSelection.current(environment: environment), .none)

        let configuration = LocalVaultConfiguration(rootPath: directory.path, bookmarkData: nil)
        let data = try JSONEncoder().encode(configuration)
        try data.write(to: configURL)
        XCTAssertEqual(
            TextTextHealthVaultSelection.current(environment: environment),
            .selected(configuration))
        XCTAssertEqual(try Data(contentsOf: configURL), data)

        try Data("{".utf8).write(to: configURL)
        XCTAssertEqual(
            TextTextHealthVaultSelection.current(environment: environment), .unreadable)
    }

    // MARK: Release-verification isolation owned by the app

    func testHealthIsolationCreatesAndCleansAppOwnedRunDirectory() throws {
        let support = try temporaryDirectory(name: "app-support")
        var environment: [String: String] = [:]
        let root = AppHealthCLI.prepareIsolation(
            environment: [AppHealthCLI.isolationEnvironmentKey: "1240-123"],
            applicationSupportDirectory: support,
            setEnvironment: { environment[$0] = $1 })
        let expected = support.appendingPathComponent(
            "TextText/AppHealth/1240-123", isDirectory: true)
        XCTAssertEqual(try XCTUnwrap(root).standardizedFileURL, expected.standardizedFileURL)
        var isDirectory: ObjCBool = false
        XCTAssertTrue(FileManager.default.fileExists(atPath: expected.path, isDirectory: &isDirectory))
        XCTAssertTrue(isDirectory.boolValue)
        XCTAssertEqual(
            environment["TEXTTEXT_STATE_DIR"],
            expected.appendingPathComponent("state", isDirectory: true).path)
        XCTAssertEqual(
            environment["TEXTTEXT_VAULT_CONFIG"],
            expected.appendingPathComponent("vault.json").path)

        // An earlier interrupted run is swept once it is older than a day; a
        // concurrent recent run and anything outside AppHealth are left alone.
        let parent = expected.deletingLastPathComponent()
        let stale = parent.appendingPathComponent("1239-7", isDirectory: true)
        let recent = parent.appendingPathComponent("1240-999", isDirectory: true)
        let unrelated = support.appendingPathComponent("TextText/vault.json")
        try FileManager.default.createDirectory(at: stale, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: recent, withIntermediateDirectories: true)
        try Data("keep".utf8).write(to: unrelated)
        try FileManager.default.setAttributes(
            [.modificationDate: Date(timeIntervalSinceNow: -3 * 24 * 60 * 60)],
            ofItemAtPath: stale.path)

        AppHealthCLI.cleanUpIsolation(try XCTUnwrap(root))
        XCTAssertFalse(FileManager.default.fileExists(atPath: expected.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: stale.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: recent.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: unrelated.path))
    }

    func testHealthIsolationRejectsPathLikeTokensAndKeepsExplicitOverrides() throws {
        let support = try temporaryDirectory(name: "app-support-reject")
        for token in ["", "../escape", "a/b", ".hidden", "with space", String(repeating: "x", count: 81)] {
            XCTAssertNil(
                AppHealthCLI.isolationRoot(token: token, applicationSupportDirectory: support),
                "token \(token.debugDescription) must not produce a run directory")
        }
        XCTAssertNil(AppHealthCLI.prepareIsolation(
            environment: [:], applicationSupportDirectory: support,
            setEnvironment: { _, _ in XCTFail("no token must not touch the environment") }))

        var environment: [String: String] = [:]
        _ = AppHealthCLI.prepareIsolation(
            environment: [
                AppHealthCLI.isolationEnvironmentKey: "explicit",
                "TEXTTEXT_STATE_DIR": "/explicit/state",
            ],
            applicationSupportDirectory: support,
            setEnvironment: { environment[$0] = $1 })
        XCTAssertNil(environment["TEXTTEXT_STATE_DIR"])
        XCTAssertNotNil(environment["TEXTTEXT_VAULT_CONFIG"])

        // Cleanup refuses a directory that is not inside AppHealth.
        let foreign = support.appendingPathComponent("Documents/not-health", isDirectory: true)
        try FileManager.default.createDirectory(at: foreign, withIntermediateDirectories: true)
        AppHealthCLI.cleanUpIsolation(foreign)
        XCTAssertTrue(FileManager.default.fileExists(atPath: foreign.path))
    }

    private func withStateDirectory(_ state: URL, _ body: () throws -> Void) throws {
        let previous = ProcessInfo.processInfo.environment["TEXTTEXT_STATE_DIR"]
        setenv("TEXTTEXT_STATE_DIR", state.path, 1)
        defer {
            if let previous {
                setenv("TEXTTEXT_STATE_DIR", previous, 1)
            } else {
                unsetenv("TEXTTEXT_STATE_DIR")
            }
        }
        try body()
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
        workflowSuites: [String] = TextTextWorkflowHealth.requiredCheckIDs,
        localDevelopment: Bool = false,
        includeAttestation: Bool = true,
        malformedAttestation: Bool = false
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
        var info: [String: Any] = [
            "CFBundleIdentifier": "app.texttext.test",
            "CFBundleName": "TextText",
            "CFBundlePackageType": "APPL",
            "CFBundleShortVersionString": "9.8",
            "CFBundleVersion": "76",
        ]
        if localDevelopment {
            info["TextTextLocalDevelopmentBuild"] = true
        }
        #if !TEXTTEXT_STORE
        info["SUFeedURL"] = "https://texttext.example/appcast.xml"
        info["SUPublicEDKey"] = "a-real-shaped-test-key"
        #endif
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
        if includeAttestation {
            let data = malformedAttestation ? Data("{".utf8) : attestationData
            try data.write(to: resources.appendingPathComponent(
                "AppHealthBuildAttestation.json"))
        }
        return try XCTUnwrap(Bundle(url: app))
    }
}

private extension Credentials {
    static let healthFixture = Credentials(
        token: "wsk_health_fixture",
        serverOrigin: "https://texttext.example",
        tokenName: "Health fixture",
        linkedAt: Date(timeIntervalSince1970: 0))
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
