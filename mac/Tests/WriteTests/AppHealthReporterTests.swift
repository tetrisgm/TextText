import Foundation
import XCTest
@testable import Write

final class AppHealthReporterTests: XCTestCase {
    func testReleaseCheckUsesRuntimeChecksAndStoresOnlyContentBlindData() throws {
        let root = try temporaryDirectory(name: "workspace")
        let state = try temporaryDirectory(name: "state")
        let bundle = try releaseBundle()
        let previous = ProcessInfo.processInfo.environment["WRITE_STATE_DIR"]
        setenv("WRITE_STATE_DIR", state.path, 1)
        defer {
            if let previous {
                setenv("WRITE_STATE_DIR", previous, 1)
            } else {
                unsetenv("WRITE_STATE_DIR")
            }
        }

        let store = StateStore()
        let reporter = AppHealthReporter(
            stateStore: store,
            syncRootProvider: { root },
            finderStatusProvider: { .unavailable },
            bundle: bundle)
        let report = reporter.run(trigger: .releaseVerification)

        XCTAssertEqual(report.appIdentifier, "net.writeapp.write.test")
        XCTAssertEqual(report.appVersion, "9.8")
        XCTAssertEqual(report.buildNumber, "76")
        XCTAssertEqual(report.status, .warning)
        XCTAssertEqual(report.checks.map(\.id), [
            "bundle.release",
            "build.attestation",
            "bundle.extensions",
            "selftest.markdown_identity",
            "selftest.filename_codec",
            "selftest.document_assets",
            "selftest.public_link",
            "state.persistence",
            "sync.index",
            "workspace.storage",
            "finder.provider",
        ])
        XCTAssertFalse(report.checks.contains { check in
            check.metrics.keys.contains { $0.contains(" ") || $0.contains("/") }
        })

        let latest = state.appendingPathComponent("health/latest.json")
        let encoded = try String(contentsOf: latest, encoding: .utf8)
        XCTAssertFalse(encoded.contains(root.path))
        XCTAssertFalse(encoded.contains(state.path))
        XCTAssertFalse(encoded.contains("token"))
    }

    func testCorruptIndexIsAHealthFailure() throws {
        let root = try temporaryDirectory(name: "workspace")
        let state = try temporaryDirectory(name: "state")
        let bundle = try releaseBundle()
        let previous = ProcessInfo.processInfo.environment["WRITE_STATE_DIR"]
        setenv("WRITE_STATE_DIR", state.path, 1)
        defer {
            if let previous {
                setenv("WRITE_STATE_DIR", previous, 1)
            } else {
                unsetenv("WRITE_STATE_DIR")
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

    private func temporaryDirectory(name: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("write-health-\(name)-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700], ofItemAtPath: url.path)
        addTeardownBlock { try? FileManager.default.removeItem(at: url) }
        return url
    }

    private func releaseBundle() throws -> Bundle {
        let parent = try temporaryDirectory(name: "release-bundle")
        let app = parent.appendingPathComponent("Release.app", isDirectory: true)
        let contents = app.appendingPathComponent("Contents", isDirectory: true)
        let plugins = contents.appendingPathComponent("PlugIns", isDirectory: true)
        let resources = contents.appendingPathComponent("Resources", isDirectory: true)
        try FileManager.default.createDirectory(at: plugins, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true)
        for name in [
            "WriteShareExtension.appex",
            "WriteQuickLookPreview.appex",
            "WriteFileProviderExtension.appex",
        ] {
            try FileManager.default.createDirectory(
                at: plugins.appendingPathComponent(name), withIntermediateDirectories: true)
        }
        let info: [String: Any] = [
            "CFBundleIdentifier": "net.writeapp.write.test",
            "CFBundleName": "Write",
            "CFBundlePackageType": "APPL",
            "CFBundleShortVersionString": "9.8",
            "CFBundleVersion": "76",
            "SUFeedURL": "https://write.example/appcast.xml",
            "SUPublicEDKey": "a-real-shaped-test-key",
        ]
        let data = try PropertyListSerialization.data(
            fromPropertyList: info, format: .xml, options: 0)
        try data.write(to: contents.appendingPathComponent("Info.plist"))
        let attestation: [String: Any] = [
            "schemaVersion": 1,
            "appVersion": "9.8",
            "buildNumber": "76",
            "sourceCommit": "health-test-revision",
            "generatedAt": "2026-07-14T00:00:00Z",
            "suites": [
                ["id": "web.unit", "status": "pass"],
                ["id": "native.unit", "status": "pass"],
            ],
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
}
