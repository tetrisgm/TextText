import FileProvider
import Foundation
import TextTextFileProviderKit
import TextTextWorkspaceCore

enum TextTextHealthStatus: String, Codable, Equatable {
    case pass
    case warning
    case fail
}

enum TextTextHealthTrigger: String, Codable, Equatable {
    case versionLaunch
    case periodic
    case manual
    case releaseVerification
}

struct TextTextHealthCheckResult: Codable, Equatable {
    let id: String
    let status: TextTextHealthStatus
    let durationMilliseconds: Int
    let metrics: [String: Double]
}

struct TextTextHealthReport: Codable, Equatable {
    var schemaVersion = 1
    let id: UUID
    let appIdentifier: String
    let appVersion: String
    let buildNumber: String
    let installationId: UUID
    let operatingSystemVersion: String
    let trigger: TextTextHealthTrigger
    let generatedAt: Date
    let status: TextTextHealthStatus
    let checks: [TextTextHealthCheckResult]
}

struct TextTextHealthState: Codable {
    var installationId: UUID
    var lastVersionBuild: String?
    var lastRunAt: Date?
}

private struct TextTextBuildAttestation: Decodable {
    struct Suite: Decodable {
        let id: String
        let status: String
        let durationMilliseconds: Int?
    }

    let schemaVersion: Int
    let appVersion: String
    let buildNumber: String
    let sourceCommit: String
    let workflowContractHash: String
    let releaseGateDurationMilliseconds: Int?
    let suites: [Suite]
}

/// The canonical list of health checks a release must report.
///
/// This is the ONE place the set is written down. The Swift test and
/// `mac/scripts/verify-app-health.sh` both read it from
/// `mac/health-checks.json`, which `scripts/sync-health-checks.ts` regenerates
/// from this file. Retiring a check used to mean editing three hardcoded lists
/// in three languages and discovering each omission through a separate failed
/// release; now it is one edit here plus a regenerate.
enum TextTextHealthChecks {
    /// Everything a passing release report must contain, in report order.
    static let required = [
        "bundle.release",
        "build.attestation",
        "bundle.extensions",
        "selftest.markdown_identity",
        "selftest.filename_codec",
        "selftest.document_assets",
        "selftest.document_projection",
        "selftest.public_link",
        TextTextWorkflowHealth.documentEngine,
        TextTextWorkflowHealth.collaboration,
        TextTextWorkflowHealth.folderTrashRestore,
        TextTextWorkflowHealth.sharingAccess,
        TextTextWorkflowHealth.comments,
        TextTextWorkflowHealth.bookmarkRecapture,
        TextTextWorkflowHealth.coverAssets,
        "state.persistence",
        "sync.index",
        "workspace.storage",
        "finder.provider",
    ]
}

enum TextTextWorkflowHealth {
    static let documentEngine = "workflow.document_engine"
    static let collaboration = "workflow.collaboration"
    static let folderTrashRestore = "workflow.folder_trash_restore"
    static let sharingAccess = "workflow.sharing_access"
    static let comments = "workflow.comments"
    static let bookmarkRecapture = "workflow.bookmark_recapture"
    static let coverAssets = "workflow.cover_assets"

    static let requiredCheckIDs = [
        documentEngine,
        collaboration,
        folderTrashRestore,
        sharingAccess,
        comments,
        bookmarkRecapture,
        coverAssets,
    ]
}

/// Local-first persistence for app-owned health reports. Reports contain only
/// stable check IDs and numeric measurements, never document text, filenames,
/// paths, URLs, credentials, or free-form errors.
final class TextTextHealthStore {
    let root: URL

    private let fileManager: FileManager
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(root: URL, fileManager: FileManager = .default) {
        self.root = root
        self.fileManager = fileManager
        encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        ensureDirectory(root)
        ensureDirectory(historyURL)
        ensureDirectory(pendingURL)
    }

    var latestURL: URL { root.appendingPathComponent("latest.json") }
    var historyURL: URL { root.appendingPathComponent("history", isDirectory: true) }
    var pendingURL: URL { root.appendingPathComponent("pending", isDirectory: true) }
    private var stateURL: URL { root.appendingPathComponent("state.json") }

    func state() -> TextTextHealthState {
        guard let data = try? Data(contentsOf: stateURL),
              let value = try? decoder.decode(TextTextHealthState.self, from: data) else {
            return TextTextHealthState(
                installationId: UUID(), lastVersionBuild: nil, lastRunAt: nil)
        }
        return value
    }

    func saveState(_ state: TextTextHealthState) {
        guard let data = try? encoder.encode(state) else { return }
        write(data, to: stateURL)
    }

    func record(_ report: TextTextHealthReport, historyLimit: Int = 30, pendingLimit: Int = 10) {
        guard let data = try? encoder.encode(report) else { return }
        write(data, to: latestURL)
        write(data, to: reportURL(report.id, in: historyURL))
        write(data, to: reportURL(report.id, in: pendingURL))
        trim(historyURL, limit: historyLimit)
        trim(pendingURL, limit: pendingLimit)
    }

    func pendingReports() -> [TextTextHealthReport] {
        reportFiles(in: pendingURL).compactMap { url in
            guard let data = try? Data(contentsOf: url) else { return nil }
            return try? decoder.decode(TextTextHealthReport.self, from: data)
        }
    }

    func markSubmitted(_ id: UUID) {
        try? fileManager.removeItem(at: reportURL(id, in: pendingURL))
    }

    private func ensureDirectory(_ url: URL) {
        try? fileManager.createDirectory(
            at: url, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        try? fileManager.setAttributes(
            [.posixPermissions: 0o700], ofItemAtPath: url.path)
    }

    private func reportURL(_ id: UUID, in directory: URL) -> URL {
        directory.appendingPathComponent(id.uuidString.lowercased())
            .appendingPathExtension("json")
    }

    private func reportFiles(in directory: URL) -> [URL] {
        let values = (try? fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles])) ?? []
        return values.filter { $0.pathExtension == "json" }.sorted {
            let lhs = (try? $0.resourceValues(
                forKeys: [.contentModificationDateKey]))?.contentModificationDate
                ?? .distantPast
            let rhs = (try? $1.resourceValues(
                forKeys: [.contentModificationDateKey]))?.contentModificationDate
                ?? .distantPast
            if lhs == rhs { return $0.lastPathComponent < $1.lastPathComponent }
            return lhs < rhs
        }
    }

    private func trim(_ directory: URL, limit: Int) {
        let files = reportFiles(in: directory)
        for file in files.prefix(max(0, files.count - max(1, limit))) {
            try? fileManager.removeItem(at: file)
        }
    }

    private func write(_ data: Data, to url: URL) {
        try? data.write(to: url, options: .atomic)
        try? fileManager.setAttributes(
            [.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}

private final class HealthSubmissionResult: @unchecked Sendable {
    private let lock = NSLock()
    private var accepted = false

    func set(_ value: Bool) {
        lock.lock()
        accepted = value
        lock.unlock()
    }

    func get() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return accepted
    }
}

/// Runs TextText's own reliability checks using the same implementation during a
/// release, on first launch of every version, and once per day. The runner is
/// deliberately independent from the web view and never reloads product UI.
final class AppHealthReporter {
    typealias FinderStatusProvider = () -> FileProviderStatusSnapshot
    typealias FileProviderDomainEnabledProvider = () -> Bool?

    private struct FinderMountProbe {
        let resolved: Bool
        let enumerated: Bool
        let workspaceVisible: Bool
        let entryCount: Int
    }

    private let stateStore: StateStore
    private let healthStore: TextTextHealthStore
    private let syncRootProvider: () -> URL?
    private let finderStatusProvider: FinderStatusProvider
    private let fileProviderDomainEnabledProvider: FileProviderDomainEnabledProvider
    private let finderReadinessProbe: FileProviderReadinessProbe
    private let bundle: Bundle
    private let clock: () -> Date
    private let queue = DispatchQueue(label: "app.texttext.health", qos: .utility)
    private let lock = NSLock()
    private let schedulingLock = NSLock()
    private var backgroundWorkScheduled = false
    private var backgroundRunRequested = false
    private var backgroundFlushRequested = false
    private var periodicTimer: DispatchSourceTimer?

    init(
        stateStore: StateStore,
        syncRootProvider: @escaping () -> URL?,
        finderStatusProvider: @escaping FinderStatusProvider,
        fileProviderDomainEnabledProvider: @escaping FileProviderDomainEnabledProvider = { nil },
        finderReadinessProbe: FileProviderReadinessProbe = FileProviderReadinessProbe(),
        bundle: Bundle = .main,
        clock: @escaping () -> Date = Date.init
    ) {
        self.stateStore = stateStore
        self.healthStore = TextTextHealthStore(
            root: stateStore.baseDir.appendingPathComponent("health", isDirectory: true))
        self.syncRootProvider = syncRootProvider
        self.finderStatusProvider = finderStatusProvider
        self.fileProviderDomainEnabledProvider = fileProviderDomainEnabledProvider
        self.finderReadinessProbe = finderReadinessProbe
        self.bundle = bundle
        self.clock = clock
    }

    func start() {
        runIfNeededAsync()
        guard periodicTimer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(
            deadline: .now() + .seconds(60 * 60),
            repeating: .seconds(60 * 60),
            leeway: .seconds(5 * 60))
        timer.setEventHandler { [weak self] in self?.runIfNeeded() }
        timer.resume()
        periodicTimer = timer
    }

    deinit {
        periodicTimer?.cancel()
    }

    func runIfNeededAsync() {
        scheduleBackgroundWork(runChecks: true)
    }

    func flushAsync() {
        scheduleBackgroundWork(runChecks: false)
    }

    private func scheduleBackgroundWork(runChecks: Bool) {
        schedulingLock.lock()
        if runChecks {
            backgroundRunRequested = true
        } else {
            backgroundFlushRequested = true
        }
        guard !backgroundWorkScheduled else {
            schedulingLock.unlock()
            return
        }
        backgroundWorkScheduled = true
        schedulingLock.unlock()
        queue.async { [weak self] in self?.drainBackgroundWork() }
    }

    private func drainBackgroundWork() {
        while true {
            schedulingLock.lock()
            let shouldRun = backgroundRunRequested
            let shouldFlush = backgroundFlushRequested
            backgroundRunRequested = false
            backgroundFlushRequested = false
            if !shouldRun && !shouldFlush {
                backgroundWorkScheduled = false
                schedulingLock.unlock()
                return
            }
            schedulingLock.unlock()

            if shouldRun {
                runIfNeeded()
            } else if shouldFlush {
                flushPending()
            }
        }
    }

    @discardableResult
    func run(trigger: TextTextHealthTrigger) -> TextTextHealthReport {
        lock.lock()
        defer { lock.unlock() }
        let prior = healthStore.state()
        let report = makeReport(trigger: trigger, installationId: prior.installationId)
        healthStore.record(report)
        healthStore.saveState(TextTextHealthState(
            installationId: prior.installationId,
            lastVersionBuild: versionBuild,
            lastRunAt: report.generatedAt))
        flushPendingLocked()
        return report
    }

    private var versionBuild: String {
        "\(bundleVersion):\(buildNumber)"
    }

    private var appIdentifier: String {
        bundle.bundleIdentifier ?? "app.texttext.mac"
    }

    private var bundleVersion: String {
        bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev"
    }

    private var buildNumber: String {
        bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
    }

    private func runIfNeeded() {
        lock.lock()
        defer { lock.unlock() }
        let prior = healthStore.state()
        let now = clock()
        let trigger: TextTextHealthTrigger?
        if prior.lastVersionBuild != versionBuild {
            trigger = .versionLaunch
        } else if prior.lastRunAt.map({ now.timeIntervalSince($0) >= 24 * 60 * 60 }) ?? true {
            trigger = .periodic
        } else {
            trigger = nil
        }
        guard let trigger else {
            flushPendingLocked()
            return
        }
        let report = makeReport(
            trigger: trigger, installationId: prior.installationId, generatedAt: now)
        healthStore.record(report)
        healthStore.saveState(TextTextHealthState(
            installationId: prior.installationId,
            lastVersionBuild: versionBuild,
            lastRunAt: now))
        flushPendingLocked()
    }

    private func makeReport(
        trigger: TextTextHealthTrigger,
        installationId: UUID,
        generatedAt: Date? = nil
    ) -> TextTextHealthReport {
        let checks = [
            timedCheck(id: "bundle.release", operation: checkBundleRelease),
            timedCheck(id: "build.attestation", operation: checkBuildAttestation),
            timedCheck(id: "bundle.extensions", operation: checkEmbeddedExtensions),
            timedCheck(id: "selftest.markdown_identity", operation: checkMarkdownIdentity),
            timedCheck(id: "selftest.filename_codec", operation: checkFilenameCodec),
            timedCheck(id: "selftest.document_assets", operation: checkDocumentAssets),
            timedCheck(
                id: "selftest.document_projection",
                operation: checkDocumentProjection),
            timedCheck(id: "selftest.public_link", operation: checkPublicLinkMapping),
            timedCheck(id: TextTextWorkflowHealth.documentEngine) {
                checkAttestedWorkflow(id: TextTextWorkflowHealth.documentEngine)
            },
            timedCheck(id: TextTextWorkflowHealth.collaboration) {
                checkAttestedWorkflow(id: TextTextWorkflowHealth.collaboration)
            },
            timedCheck(id: TextTextWorkflowHealth.folderTrashRestore) {
                checkAttestedWorkflow(id: TextTextWorkflowHealth.folderTrashRestore)
            },
            timedCheck(id: TextTextWorkflowHealth.sharingAccess) {
                checkAttestedWorkflow(id: TextTextWorkflowHealth.sharingAccess)
            },
            timedCheck(id: TextTextWorkflowHealth.comments) {
                checkAttestedWorkflow(id: TextTextWorkflowHealth.comments)
            },
            timedCheck(id: TextTextWorkflowHealth.bookmarkRecapture) {
                checkAttestedWorkflow(id: TextTextWorkflowHealth.bookmarkRecapture)
            },
            timedCheck(id: TextTextWorkflowHealth.coverAssets) {
                checkAttestedWorkflow(id: TextTextWorkflowHealth.coverAssets)
            },
            timedCheck(id: "state.persistence", operation: checkStatePersistence),
            timedCheck(id: "sync.index", operation: checkSyncIndex),
            timedCheck(id: "workspace.storage", operation: checkWorkspaceStorage),
            timedCheck(id: "finder.provider", operation: checkFinderProvider),
        ]
        let status: TextTextHealthStatus = checks.contains(where: { $0.status == .fail })
            ? .fail
            : (checks.contains(where: { $0.status == .warning }) ? .warning : .pass)
        return TextTextHealthReport(
            id: UUID(),
            appIdentifier: appIdentifier,
            appVersion: bundleVersion,
            buildNumber: buildNumber,
            installationId: installationId,
            operatingSystemVersion: ProcessInfo.processInfo.operatingSystemVersionString,
            trigger: trigger,
            generatedAt: generatedAt ?? clock(),
            status: status,
            checks: checks)
    }

    private func timedCheck(
        id: String,
        operation: () -> (TextTextHealthStatus, [String: Double])
    ) -> TextTextHealthCheckResult {
        let started = clock()
        let (status, rawMetrics) = operation()
        let safeMetrics = Array(rawMetrics.filter {
            Self.validIdentifier($0.key)
                && $0.value.isFinite
                && abs($0.value) <= 1_000_000_000_000
        }.sorted { $0.key < $1.key }.prefix(32))
        let metrics = Dictionary(uniqueKeysWithValues: safeMetrics)
        return TextTextHealthCheckResult(
            id: id,
            status: status,
            durationMilliseconds: max(
                0, Int(clock().timeIntervalSince(started) * 1_000)),
            metrics: metrics)
    }

    private func checkBundleRelease() -> (TextTextHealthStatus, [String: Double]) {
        let feed = bundle.object(forInfoDictionaryKey: "SUFeedURL") as? String
        let key = bundle.object(forInfoDictionaryKey: "SUPublicEDKey") as? String
        #if TEXTTEXT_STORE
        // TestFlight and App Store own updates for the sandboxed edition, and
        // the package gate rejects Sparkle metadata there. Its healthy update
        // configuration is therefore the deliberate absence of both values.
        let validFeed = feed == nil || feed?.isEmpty == true
        let validKey = key == nil || key?.isEmpty == true
        #else
        let validFeed = feed.flatMap(URL.init(string:))?.scheme == "https"
        let validKey = !(key?.isEmpty ?? true)
            && key != "REPLACE_WITH_SPARKLE_PUBLIC_KEY"
        #endif
        let validIdentity = bundle.bundleIdentifier != nil
            && bundleVersion != "dev" && buildNumber != "0"
        let valid = validFeed && validKey && validIdentity
        return (valid ? .pass : .fail, [
            "identity_valid": validIdentity ? 1 : 0,
            "feed_valid": validFeed ? 1 : 0,
            "signature_key_present": validKey ? 1 : 0,
        ])
    }

    private func checkBuildAttestation() -> (TextTextHealthStatus, [String: Double]) {
        guard let attestation = buildAttestation() else {
            let status: TextTextHealthStatus = bundle.bundleURL.pathExtension == "app"
                ? .fail : .warning
            return (status, [
                "present": 0,
                "valid": 0,
                "version_match": 0,
                "build_match": 0,
                "suite_count": 0,
                "passed_count": 0,
                "source_revision_present": 0,
                "workflow_contract_valid": 0,
                "suite_ids_unique": 0,
                "required_suites_present": 0,
            ])
        }

        let validSchema = attestation.schemaVersion == 1
        let versionMatches = attestation.appVersion == bundleVersion
        let buildMatches = attestation.buildNumber == buildNumber
        let passed = attestation.suites.filter { $0.status == "pass" }.count
        let suiteIDs = attestation.suites.map(\.id)
        let uniqueSuiteIDs = Set(suiteIDs).count == suiteIDs.count
        let durationReceiptsValid = attestation.suites.allSatisfy {
            ($0.durationMilliseconds ?? -1) >= 0
        }
        let releaseDurationValid =
            (attestation.releaseGateDurationMilliseconds ?? -1) >= 0
        let requiredSuitesPresent = Set(TextTextWorkflowHealth.requiredCheckIDs)
            .isSubset(of: Set(suiteIDs))
        let suitesValid = !attestation.suites.isEmpty
            && passed == attestation.suites.count
            && uniqueSuiteIDs
            && durationReceiptsValid
            && releaseDurationValid
            && requiredSuitesPresent
            && attestation.suites.allSatisfy {
                Self.validIdentifier($0.id) && $0.status == "pass"
            }
        let sourcePresent = !attestation.sourceCommit.isEmpty
        let workflowContractValid = Self.validSHA256(attestation.workflowContractHash)
        let valid = validSchema && versionMatches && buildMatches
            && suitesValid && sourcePresent && workflowContractValid
        return (valid ? .pass : .fail, [
            "present": 1,
            "valid": validSchema && suitesValid ? 1 : 0,
            "version_match": versionMatches ? 1 : 0,
            "build_match": buildMatches ? 1 : 0,
            "suite_count": Double(attestation.suites.count),
            "passed_count": Double(passed),
            "source_revision_present": sourcePresent ? 1 : 0,
            "workflow_contract_valid": workflowContractValid ? 1 : 0,
            "suite_ids_unique": uniqueSuiteIDs ? 1 : 0,
            "required_suites_present": requiredSuitesPresent ? 1 : 0,
            "duration_receipts_valid": durationReceiptsValid ? 1 : 0,
            "release_gate_duration_ms": Double(
                attestation.releaseGateDurationMilliseconds ?? 0),
        ])
    }

    private func checkAttestedWorkflow(
        id: String
    ) -> (TextTextHealthStatus, [String: Double]) {
        guard let attestation = buildAttestation() else {
            let status: TextTextHealthStatus = bundle.bundleURL.pathExtension == "app"
                ? .fail : .warning
            return (status, [
                "receipt_present": 0,
                "receipt_passed": 0,
                "receipt_unique": 0,
                "identity_match": 0,
            ])
        }
        let matching = attestation.suites.filter { $0.id == id }
        let receiptPresent = !matching.isEmpty
        let receiptUnique = matching.count == 1
        let receiptPassed = matching.first?.status == "pass"
        let identityMatches = attestation.schemaVersion == 1
            && attestation.appVersion == bundleVersion
            && attestation.buildNumber == buildNumber
            && Self.validSHA256(attestation.workflowContractHash)
        let valid = receiptPresent && receiptUnique && receiptPassed && identityMatches
        return (valid ? .pass : .fail, [
            "receipt_present": receiptPresent ? 1 : 0,
            "receipt_passed": receiptPassed ? 1 : 0,
            "receipt_unique": receiptUnique ? 1 : 0,
            "identity_match": identityMatches ? 1 : 0,
        ])
    }

    private func buildAttestation() -> TextTextBuildAttestation? {
        guard let url = bundle.url(
            forResource: "AppHealthBuildAttestation", withExtension: "json"),
              let data = try? Data(contentsOf: url)
        else { return nil }
        return try? JSONDecoder().decode(TextTextBuildAttestation.self, from: data)
    }

    private func checkMarkdownIdentity() -> (TextTextHealthStatus, [String: Double]) {
        let source = "---\ntitle: \"Why???\"\n---\n\nA/B: C\n"
        let injected = MarkdownIdentityCodec.inject(
            into: source, itemId: "health-item", folderId: "health-folder",
            kind: "note")
        let identity = MarkdownIdentityCodec.extract(from: injected)
        let roundTrips = MarkdownIdentityCodec.strip(from: injected) == source
        let identityMatches = identity == MarkdownIdentity(
            itemId: "health-item", folderId: "health-folder", kind: "note")
        let valid = roundTrips && identityMatches
        return (valid ? .pass : .fail, [
            "round_trip": roundTrips ? 1 : 0,
            "identity_match": identityMatches ? 1 : 0,
        ])
    }

    private func checkFilenameCodec() -> (TextTextHealthStatus, [String: Double]) {
        let title = "Why?? A/B: C"
        let filename = TextTextFilename.filename(
            title: title, slug: "health-item", representation: .textbundle)
        let decoded = TextTextFilename.titleFromFilename(
            filename, representation: .textbundle)
        let roundTrips = decoded == title
        let bounded = filename.utf8.count <= TextTextFilename.maximumComponentUTF8Length
        let portable = !filename.contains("/") && !filename.contains("?")
        let valid = roundTrips && bounded && portable
        return (valid ? .pass : .fail, [
            "round_trip": roundTrips ? 1 : 0,
            "bounded": bounded ? 1 : 0,
            "portable": portable ? 1 : 0,
            "filename_bytes": Double(filename.utf8.count),
        ])
    }

    private func checkDocumentAssets() -> (TextTextHealthStatus, [String: Double]) {
        let assetURL = "https://health.public.blob.vercel-storage.com/"
            + "documents/demo/health-item/assets/image.png"
        let manifest = TextTextArtifactManifest(
            postId: "health-item", slug: "health-item", fileHash: "health-hash",
            artifacts: [TextTextArtifact(
                filename: "image.png", role: "asset", url: assetURL,
                contentType: "image/png")])
        let canonical = "![diagram](\(assetURL))"
        let local = TextTextDocumentAssets.localMarkdown(
            canonical: canonical, manifest: manifest, handle: "demo")
        let restored = TextTextDocumentAssets.canonicalMarkdown(
            local: local, manifest: manifest, handle: "demo")
        let localized = local == "![diagram](assets/image.png)"
        let roundTrips = restored == canonical
        let valid = localized && roundTrips
        return (valid ? .pass : .fail, [
            "localized": localized ? 1 : 0,
            "round_trip": roundTrips ? 1 : 0,
            "asset_count": Double(
                TextTextDocumentAssets.validatedInlineAssets(
                    manifest, handle: "demo").count),
        ])
    }

    private func checkDocumentProjection() -> (TextTextHealthStatus, [String: Double]) {
        let fileManager = FileManager.default
        let root = fileManager.temporaryDirectory
            .appendingPathComponent("texttext-document-health-\(UUID().uuidString)")
        defer { try? fileManager.removeItem(at: root) }

        let remoteURL = "https://health.public.blob.vercel-storage.com/"
            + "documents/demo/health-item/assets/cover.png"
        let markdown = "# Health item\n\n![Cover](\(remoteURL))\n"
        let documentJSON = """
            {
              "content" : {
                "assets" : [
                  {
                    "id" : "cover",
                    "kind" : "image",
                    "src" : "\(remoteURL)"
                  }
                ],
                "body" : "![Cover](\(remoteURL))",
                "fields" : {
                  "cover" : "\(remoteURL)"
                },
                "tags" : [],
                "title" : "Health item"
              },
              "presentation" : {
                "template" : {
                  "id" : "texttext.article",
                  "version" : 1
                },
                "theme" : {}
              },
              "schemaVersion" : 1
            }
            """
        let assetData = Data("health-cover".utf8)

        do {
            try fileManager.createDirectory(
                at: root, withIntermediateDirectories: true)
            let materialized = try TextTextTextBundlePackage.materialize(
                canonicalMarkdown: markdown,
                documentJSON: documentJSON,
                assets: [.init(
                    filename: "cover.png", data: assetData,
                    remoteURL: remoteURL, contentType: "image/png")],
                sourceURL: nil,
                in: root)
            let textpack = try TextTextTextBundlePackage.zipToTextPack(
                packageURL: materialized.url, in: root)
            let read = try TextTextTextBundlePackage.read(from: textpack, in: root)
            let markdownRoundTrips = read.markdown == markdown
            let documentRoot = try read.documentJSON.map {
                try JSONSerialization.jsonObject(with: Data($0.utf8))
            } as? [String: Any]
            let content = documentRoot?["content"] as? [String: Any]
            let fields = content?["fields"] as? [String: Any]
            let assets = content?["assets"] as? [[String: Any]]
            let documentRoundTrips = fields?["cover"] as? String == remoteURL
                && assets?.first?["src"] as? String == remoteURL
                && (content?["body"] as? String)?.contains(remoteURL) == true
            let assetRoundTrips = read.assets.count == 1
                && read.assets.first?.data == assetData
                && read.assets.first?.remoteURL == remoteURL
            let valid = markdownRoundTrips && documentRoundTrips && assetRoundTrips
            return (valid ? .pass : .fail, [
                "markdown_round_trip": markdownRoundTrips ? 1 : 0,
                "document_round_trip": documentRoundTrips ? 1 : 0,
                "asset_round_trip": assetRoundTrips ? 1 : 0,
                "asset_count": Double(read.assets.count),
            ])
        } catch {
            return (.fail, [
                "markdown_round_trip": 0,
                "document_round_trip": 0,
                "asset_round_trip": 0,
                "asset_count": 0,
            ])
        }
    }

    private func checkPublicLinkMapping() -> (TextTextHealthStatus, [String: Double]) {
        let privateURL = "https://texttext.app/api/sync/v1/files/health-item"
        let publicURL = "https://demo.TextText.app/blog/health-item"
        let entry = TextTextManifestItem(
            file: "health-item.md", kind: "article", slug: "health-item",
            title: "Health item", status: "published", hash: "health-hash",
            id: "health-item", date: nil, createdAt: nil, updatedAt: nil,
            url: privateURL, canonicalUrl: publicURL)
        let item = TextTextItemMapper.item(
            for: entry, inFolder: "blog", handle: "demo", readOnly: false)
        let usesPublicURL = item?.manifestURL == publicURL
        let hidesPrivateURL = item?.manifestURL != privateURL
        let valid = usesPublicURL && hidesPrivateURL
        return (valid ? .pass : .fail, [
            "public_url": usesPublicURL ? 1 : 0,
            "private_url_hidden": hidesPrivateURL ? 1 : 0,
        ])
    }

    /// Exercise the real transport guard, not a proxy for it. Loopback binding
    /// is a routing property and authenticates nothing: every browser on this
    /// Mac can reach the port. What must hold is that the guard refuses
    /// browser-originated traffic and non-JSON bodies, which is what stops a
    /// web page driving the workspace.
    private func checkEmbeddedExtensions() -> (TextTextHealthStatus, [String: Double]) {
        guard bundle.bundleURL.pathExtension == "app" else {
            return (.warning, ["app_bundle": 0, "extension_count": 0])
        }
        let plugins = bundle.bundleURL.appendingPathComponent("Contents/PlugIns")
        let required = [
            "TextTextShareExtension.appex",
            "TextTextQuickLookPreview.appex",
            "TextTextFileProviderExtension.appex",
        ]
        let found = required.filter {
            FileManager.default.fileExists(atPath: plugins.appendingPathComponent($0).path)
        }.count
        return (found == required.count ? .pass : .fail, [
            "app_bundle": 1,
            "extension_count": Double(found),
            "extension_expected": Double(required.count),
        ])
    }

    private func checkStatePersistence() -> (TextTextHealthStatus, [String: Double]) {
        let fileManager = FileManager.default
        let probe = stateStore.baseDir
            .appendingPathComponent(".health-probe-\(UUID().uuidString)")
        var writable = false
        do {
            try Data("health".utf8).write(to: probe, options: .atomic)
            try fileManager.removeItem(at: probe)
            writable = true
        } catch {
            writable = false
        }
        let stateMode = Self.permissions(at: stateStore.baseDir)
        let credentialsPresent = fileManager.fileExists(atPath: stateStore.credentialsURL.path)
        let credentialsMode = credentialsPresent
            ? Self.permissions(at: stateStore.credentialsURL)
            : 0o600
        let permissionsValid = stateMode == 0o700 && credentialsMode == 0o600
        let status: TextTextHealthStatus = !writable
            ? .fail
            : (permissionsValid ? .pass : .warning)
        return (status, [
            "writable": writable ? 1 : 0,
            "private_permissions": permissionsValid ? 1 : 0,
            "credentials_present": credentialsPresent ? 1 : 0,
        ])
    }

    private func checkSyncIndex() -> (TextTextHealthStatus, [String: Double]) {
        // The GUI's sole sync owner is the File Provider extension. index.json
        // belongs only to the legacy headless mirror, so a normal installed app
        // does not create it. If an older index remains, still decode it to catch
        // corruption during the transition, but absence is the healthy state.
        guard FileManager.default.fileExists(atPath: stateStore.indexURL.path) else {
            return (.pass, ["present": 0, "decodable": 1, "entry_count": 0])
        }
        guard let data = try? Data(contentsOf: stateStore.indexURL),
              let index = try? JSONDecoder.textTextHealthDecoder.decode(SyncIndex.self, from: data)
        else {
            return (.fail, ["present": 1, "decodable": 0, "entry_count": 0])
        }
        return (.pass, [
            "present": 1,
            "decodable": 1,
            "entry_count": Double(index.entries.count),
        ])
    }

    private func checkWorkspaceStorage() -> (TextTextHealthStatus, [String: Double]) {
        // The workspace's on-disk home is the File Provider mount (the legacy
        // mirror is retired). A nil root means the mount is not resolved here
        // (signed out, domain still registering, or an isolated CI run): there
        // is nothing local to verify and finder.provider carries the live
        // signal, so report pass with mount_resolved = 0 instead of failing on
        // a path that no longer exists by design.
        let linked = stateStore.loadCredentials() != nil
        let domainEnabled = fileProviderDomainEnabledProvider()
        let userDisabled = linked && domainEnabled == false
        guard let root = syncRootProvider() else {
            return (.pass, [
                "mount_resolved": 0,
                "linked": linked ? 1 : 0,
                "domain_enabled_known": domainEnabled == nil ? 0 : 1,
                "domain_enabled": domainEnabled == true ? 1 : 0,
                "user_disabled": userDisabled ? 1 : 0,
            ])
        }
        let fileManager = FileManager.default
        var isDirectory: ObjCBool = false
        let exists = fileManager.fileExists(atPath: root.path, isDirectory: &isDirectory)
        let readable = exists && fileManager.isReadableFile(atPath: root.path)
        let writable = exists && fileManager.isWritableFile(atPath: root.path)
        let enumerated = (try? fileManager.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles])) != nil
        let valid = exists && isDirectory.boolValue && readable && writable && enumerated
        let status: TextTextHealthStatus
        if userDisabled {
            // Finder access is an optional user-controlled File Provider
            // feature. Its disabled mount can exist and remain writable while
            // enumeration is denied by macOS. That does not make the signed
            // app or its private workspace storage defective.
            status = .pass
        } else {
            status = valid ? .pass : .fail
        }
        return (status, [
            "mount_resolved": 1,
            "present": exists ? 1 : 0,
            "directory": isDirectory.boolValue ? 1 : 0,
            "readable": readable ? 1 : 0,
            "writable": writable ? 1 : 0,
            "enumerated": enumerated ? 1 : 0,
            "linked": linked ? 1 : 0,
            "domain_enabled_known": domainEnabled == nil ? 0 : 1,
            "domain_enabled": domainEnabled == true ? 1 : 0,
            "user_disabled": userDisabled ? 1 : 0,
        ])
    }

    private func checkFinderProvider() -> (TextTextHealthStatus, [String: Double]) {
        let readiness = finderReadinessProbe.run(
            statusProvider: finderStatusProvider)
        let snapshot = readiness.snapshot
        let linked = stateStore.loadCredentials() != nil
        let mount = finderMountProbe()
        let domainEnabled = fileProviderDomainEnabledProvider()
        let userDisabled = linked && domainEnabled == false
        let linkedMountUsable = !linked || (mount.enumerated && mount.workspaceVisible)
        let status: TextTextHealthStatus
        if userDisabled {
            // Disabling a File Provider domain is a user preference, not a
            // defective app binary. Record the state in metrics without
            // degrading an otherwise valid App Store-compatible update.
            status = .pass
        } else {
            switch snapshot.severity {
            case .healthy:
                // A provider can report no pending errors while its domain is
                // absent. For a linked account whose domain is enabled or
                // unknown, require a real Finder enumeration that exposes at
                // least one workspace before calling the provider usable.
                status = linkedMountUsable ? .pass : .fail
            case .working, .neutral:
                status = .warning
            case .warning:
                status = .fail
            }
        }
        return (status, [
            "healthy": snapshot.severity == .healthy ? 1 : 0,
            "working": snapshot.severity == .working ? 1 : 0,
            "warning": snapshot.severity == .warning ? 1 : 0,
            "readiness_samples": Double(readiness.sampleCount),
            "started_working": readiness.startedWorking ? 1 : 0,
            "became_healthy": readiness.becameHealthy ? 1 : 0,
            "working_exhausted": readiness.exhausted ? 1 : 0,
            "linked": linked ? 1 : 0,
            "domain_enabled_known": domainEnabled == nil ? 0 : 1,
            "domain_enabled": domainEnabled == true ? 1 : 0,
            "user_disabled": userDisabled ? 1 : 0,
            "mount_resolved": mount.resolved ? 1 : 0,
            "mount_enumerated": mount.enumerated ? 1 : 0,
            "workspace_visible": mount.workspaceVisible ? 1 : 0,
            "mount_entry_count": Double(mount.entryCount),
        ])
    }

    private func finderMountProbe() -> FinderMountProbe {
        guard let root = syncRootProvider() else {
            return FinderMountProbe(
                resolved: false, enumerated: false,
                workspaceVisible: false, entryCount: 0)
        }
        guard let entries = try? FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles])
        else {
            return FinderMountProbe(
                resolved: true, enumerated: false,
                workspaceVisible: false, entryCount: 0)
        }
        let workspaceVisible = entries.contains { url in
            url.lastPathComponent != "Data"
                && (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true
        }
        return FinderMountProbe(
            resolved: true, enumerated: true,
            workspaceVisible: workspaceVisible, entryCount: entries.count)
    }

    private func flushPending() {
        lock.lock()
        defer { lock.unlock() }
        flushPendingLocked()
    }

    private func flushPendingLocked() {
        guard let credentials = stateStore.loadCredentials() else { return }
        for report in healthStore.pendingReports() {
            guard submit(report, credentials: credentials) else { break }
            healthStore.markSubmitted(report.id)
        }
    }

    private func submit(_ report: TextTextHealthReport, credentials: Credentials) -> Bool {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let body = try? encoder.encode(report) else { return false }
        let origin = resolveServerOrigin(credentials: credentials)
        let url = origin.appendingPathComponent("api/app/health")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = body
        request.timeoutInterval = 15
        request.setValue("Bearer \(credentials.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let semaphore = DispatchSemaphore(value: 0)
        let result = HealthSubmissionResult()
        URLSession.shared.dataTask(with: request) { _, response, _ in
            if let response = response as? HTTPURLResponse {
                result.set((200..<300).contains(response.statusCode))
            }
            semaphore.signal()
        }.resume()
        guard semaphore.wait(timeout: .now() + 16) == .success else { return false }
        return result.get()
    }

    private static func validIdentifier(_ value: String) -> Bool {
        guard !value.isEmpty, value.count <= 80 else { return false }
        return value.unicodeScalars.allSatisfy {
            CharacterSet.alphanumerics.contains($0)
                || $0 == "." || $0 == "_" || $0 == "-"
        }
    }

    private static func validSHA256(_ value: String) -> Bool {
        value.count == 64 && value.unicodeScalars.allSatisfy {
            (48...57).contains(Int($0.value)) || (97...102).contains(Int($0.value))
        }
    }

    private static func permissions(at url: URL) -> Int {
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        return (attributes?[.posixPermissions] as? NSNumber)?.intValue ?? 0
    }
}

enum AppHealthCLI {
    static func run() -> Int32 {
        let stateStore = StateStore()
        // Release verification runs in a fresh, isolated workspace with no
        // registered File Provider domain. The GUI has no sync index to seed:
        // the extension owns sync and sync.index treats an absent legacy index
        // as healthy. Extension embedding and the real Finder lifecycle are
        // verified independently by this report and the release test suite.
        // The workspace's on-disk home is the File Provider mount; resolve the
        // registered domain's user-visible root (blocking is fine in the CLI).
        // nil on a machine with no domain (signed out / isolated CI), which
        // workspace.storage reports as mount_resolved = 0 rather than failing.
        let providerState = Self.resolveFileProviderState()
        let reporter = AppHealthReporter(
            stateStore: stateStore,
            syncRootProvider: { providerState.mountRoot },
            finderStatusProvider: { .make(pendingCount: 0) },
            fileProviderDomainEnabledProvider: { providerState.userEnabled })
        let report = reporter.run(trigger: .releaseVerification)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(report) else { return 1 }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
        return report.status == .pass ? 0 : 1
    }

    private static func resolveFileProviderState() -> (
        mountRoot: URL?, userEnabled: Bool?
    ) {
        let semaphore = DispatchSemaphore(value: 0)
        var resolved: URL?
        var userEnabled: Bool?
        NSFileProviderManager.getDomainsWithCompletionHandler { domains, _ in
            guard let domain = domains.first(where: { $0.identifier.rawValue == "texttext" })
            else {
                semaphore.signal()
                return
            }
            userEnabled = domain.userEnabled
            guard let manager = NSFileProviderManager(for: domain) else {
                semaphore.signal()
                return
            }
            manager.getUserVisibleURL(for: .rootContainer) { url, _ in
                resolved = url
                semaphore.signal()
            }
        }
        _ = semaphore.wait(timeout: .now() + 10)
        return (resolved, userEnabled)
    }
}

private extension JSONDecoder {
    static var textTextHealthDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
