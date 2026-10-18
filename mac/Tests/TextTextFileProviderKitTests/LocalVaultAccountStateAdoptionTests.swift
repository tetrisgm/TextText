import TextTextSyncTestSupport
import XCTest
import Darwin
import TextTextWorkspaceCore
@testable import TextTextFileProviderKit

final class LocalVaultAccountStateAdoptionTests: XCTestCase {
    private struct Interrupted: Error {}
    private var base: URL!
    private let binding = try! LocalVaultSyncBinding(origin: URL(string: "https://texttext.test")!, workspaceId: "workspace")
    private struct Fixture {
        let root: URL; let directory: URL; let remote: FakeVaultTransport
        let state: Data; let checkpoint: Data; let projection: Data; let pending: Data; let operation: String
        let checkpointPath = "shared-editing/adoption-shared/checkpoint.json"
    }
    override func setUpWithError() throws {
        base = FileManager.default.temporaryDirectory.appendingPathComponent("texttext-adoption-test-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try? FileManager.default.removeItem(at: base) }
    private func pack(_ id: String, _ body: String) throws -> Data {
        let scratch = base.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: scratch, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: scratch) }
        let document = try BuiltinTextPackDocument.create(title: "Note", body: body)
        let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: "---\ntextTextId: \"\(id)\"\ntitle: Note\n---\n\n\(body)",
            documentJSON: document.documentJSON, templateJSON: document.templateJSON,
            assets: [.init(filename: "exact.bin", data: Data([0, 7, 255, 3]), remoteURL: "assets/exact.bin")], sourceURL: nil, in: scratch)
        return try Data(contentsOf: TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: scratch))
    }
    private func create(_ name: String) async throws -> Fixture {
        let root = base.appendingPathComponent(name), note = root.appendingPathComponent("Notes/Queued.textpack")
        try FileManager.default.createDirectory(at: note.deletingLastPathComponent(), withIntermediateDirectories: true)
        try pack("adoption-note", "Original").write(to: note)
        let remote = FakeVaultTransport(), sync = try makeTestSync(root: root, binding: binding, transport: remote)
        _ = try await sync.sync()
        let pending = try pack("adoption-note", "Retained offline edit"); try pending.write(to: note, options: .atomic)
        await remote.failNextUploadBeforeCommit(); let failed = try await sync.sync(); XCTAssertFalse(failed.errors.isEmpty)
        let sharedPath = "Notes/Shared.textpack"; try pack("adoption-shared", "Original shared content").write(to: root.appendingPathComponent(sharedPath))
        let original = try LocalVaultDocumentStore(root: root).read(path: sharedPath)
        let journal: [String: Any] = ["version": 1, "epoch": 1, "seq": 0, "journalGeneration": 1, "revision": original.hash, "relativePath": sharedPath, "update": "AQ==", "pending": ["AQ=="], "batch": NSNull()]
        let cp = LocalVaultSharedCheckpoint(itemId: "adoption-shared", path: sharedPath, projectedHash: original.hash, acknowledgedRevision: original.hash,
            epoch: 1, seq: 0, journalGeneration: 1, journal: String(decoding: try JSONSerialization.data(withJSONObject: journal), as: UTF8.self), pending: true, retiredReason: nil)
        var snapshot = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(original.contents.documentJSON!.utf8)) as? [String: Any])
        var content = try XCTUnwrap(snapshot["content"] as? [String: Any]); content["body"] = "Retained shared content"; snapshot["content"] = content
        let saved = try LocalVaultSharedEditingStore(root: root).materialize(checkpoint: cp, expectedHash: original.hash,
            markdown: original.contents.markdown.replacingOccurrences(of: "Original shared content", with: "Retained shared content"),
            documentJSON: String(decoding: try JSONSerialization.data(withJSONObject: snapshot), as: UTF8.self))
        let directory = LocalVaultDeviceState.directory(root: root), state = try Data(contentsOf: directory.appendingPathComponent("sync/state.json"))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: state) as? [String: Any])
        let outbox = try XCTUnwrap(object["outbox"] as? [String: [String: Any]]), operation = try XCTUnwrap(outbox["adoption-note"]?["operationId"] as? String)
        return Fixture(root: root, directory: directory, remote: remote, state: state,
            checkpoint: try Data(contentsOf: directory.appendingPathComponent("shared-editing/adoption-shared/checkpoint.json")),
            projection: try Data(contentsOf: root.appendingPathComponent(saved.document.path)), pending: pending, operation: operation)
    }
    private func adopt(_ fixture: Fixture, account: String = "account-a", barrier: ((String) throws -> Void)? = nil) throws -> LocalVaultAccountStateAdoption.Result {
        try LocalVaultAccountStateAdoption.adoptAfterExplicitReview(root: fixture.root, binding: binding, accountId: account, barrier: barrier)
    }
    func testDiskFullAdoptionRetainsOriginalsAndResumes() async throws {
        guard let location = ProcessInfo.processInfo.environment["TEXTTEXT_ADOPTION_NOSPACE_VOLUME"] else {
            throw XCTSkip("Requires an explicitly prepared isolated test volume")
        }
        let volume = URL(fileURLWithPath: location).standardizedFileURL.resolvingSymlinksInPath()
        let marker = try String(contentsOf: volume.appendingPathComponent(".texttext-checkpoint-test-volume"), encoding: .utf8)
        let size = try XCTUnwrap(try FileManager.default.attributesOfFileSystem(forPath: volume.path)[.systemSize] as? NSNumber).uint64Value
        guard marker == "texttext checkpoint ENOSPC fixture v1\n", size >= 16 * 1024 * 1024, size <= 64 * 1024 * 1024 else {
            return XCTFail("Refusing to fill anything except the explicitly marked tiny test volume")
        }
        let originalBase = base!
        addTeardownBlock { try? FileManager.default.removeItem(at: originalBase) }
        base = volume.appendingPathComponent("texttext-adoption-test-" + UUID().uuidString)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        let f = try await create("disk-full")
        guard f.directory.path.hasPrefix(volume.path + "/") else { return XCTFail("Adoption state must be on the isolated volume") }
        let fill = base.appendingPathComponent("fill")
        XCTAssertTrue(FileManager.default.createFile(atPath: fill.path, contents: nil))
        let handle = try FileHandle(forWritingTo: fill)
        defer { try? handle.truncate(atOffset: 0); try? handle.close() }
        func isNoSpace(_ error: Error) -> Bool {
            let e = error as NSError
            return (e.domain == NSCocoaErrorDomain && e.code == NSFileWriteOutOfSpaceError) ||
                (e.domain == NSPOSIXErrorDomain && e.code == Int(ENOSPC)) ||
                ((e.userInfo[NSUnderlyingErrorKey] as? NSError).map { isNoSpace($0) } ?? false)
        }
        XCTAssertThrowsError(try adopt(f) { phase in
            guard phase == "intent" else { return }
            for length in [1024 * 1024, 4096] {
                let block = Data(repeating: 0x5a, count: length)
                while true { do { try handle.write(contentsOf: block) } catch { guard isNoSpace(error) else { throw error }; break } }
            }
            try? handle.synchronize()
        }) { XCTAssertTrue(isNoSpace($0), "Adoption must report actual disk full: \($0)") }
        XCTAssertEqual(try Data(contentsOf: f.directory.appendingPathComponent("sync/state.json")), f.state)
        XCTAssertEqual(try Data(contentsOf: f.directory.appendingPathComponent(f.checkpointPath)), f.checkpoint)
        XCTAssertEqual(try Data(contentsOf: f.root.appendingPathComponent("Notes/Shared.textpack")), f.projection)
        XCTAssertTrue(FileManager.default.fileExists(atPath: f.directory.appendingPathComponent(LocalVaultAccountRootOwnership.pendingAdoption).path))
        XCTAssertThrowsError(try makeTestSync(root: f.root, binding: binding, transport: f.remote, accountId: "account-a"))
        try handle.truncate(atOffset: 0); try handle.synchronize(); try handle.close()
        let result = try adopt(f), recovery = try XCTUnwrap(result.recoveryDirectory)
        XCTAssertEqual(try Data(contentsOf: recovery.appendingPathComponent("before/sync/state.json")), f.state)
        _ = try await makeTestSync(root: f.root, binding: binding, transport: f.remote, accountId: "account-a").sync()
        let uploads = await f.remote.uploads(); XCTAssertEqual(uploads.last?.operationId, f.operation)
        XCTAssertEqual(try Data(contentsOf: f.root.appendingPathComponent("Notes/Queued.textpack")), f.pending)
    }
    func testLiveWriterExcludesAdoptionUntilItsActorIsReleased() async throws {
        let f = try await create("writer-fence")
        var writer: LocalVaultSync? = try makeTestSync(root: f.root, binding: binding, transport: f.remote)
        weak var observed = writer
        try withExtendedLifetime(writer) {
            XCTAssertThrowsError(try adopt(f)) { error in
                guard case LocalVaultSyncFailure.busy = error else { return XCTFail("Expected the live-writer fence") }
            }
            XCTAssertEqual(try Data(contentsOf: f.directory.appendingPathComponent("sync/state.json")), f.state)
            XCTAssertFalse(FileManager.default.fileExists(atPath: f.directory.appendingPathComponent(LocalVaultAccountRootOwnership.pendingAdoption).path))
        }
        writer = nil
        XCTAssertNil(observed)
        XCTAssertFalse(try adopt(f).alreadyBound)
        XCTAssertThrowsError(try makeTestSync(root: f.root, binding: binding, transport: f.remote))
        _ = try makeTestSync(root: f.root, binding: binding, transport: f.remote, accountId: "account-a")
    }
    func testResumeInSeparateProcess() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let path = environment["TEXTTEXT_ADOPTION_FIXTURE_ROOT"], let nonce = environment["TEXTTEXT_ADOPTION_FIXTURE_NONCE"] else {
            throw XCTSkip("Invoked by the owned separate-process adoption test")
        }
        let root = URL(fileURLWithPath: path).standardizedFileURL
        guard root.lastPathComponent == "process-restart", root.deletingLastPathComponent().lastPathComponent.hasPrefix("texttext-adoption-test-"),
              try String(contentsOf: root.appendingPathComponent(".adoption-fixture"), encoding: .utf8) == nonce else { throw Interrupted() }
        let result = try LocalVaultAccountStateAdoption.adoptAfterExplicitReview(root: root, binding: binding, accountId: "account-a")
        XCTAssertFalse(result.alreadyBound); XCTAssertNotNil(result.recoveryDirectory)
        print("PASS owned child resumes recorded adoption")
    }
    func testSeparateProcessResumesFrozenTransaction() async throws {
        let f = try await create("process-restart"), nonce = UUID().uuidString
        try nonce.write(to: f.root.appendingPathComponent(".adoption-fixture"), atomically: true, encoding: .utf8)
        XCTAssertThrowsError(try adopt(f) { if $0 == "applied:" + f.checkpointPath { throw Interrupted() } })
        let child = Process(), output = Pipe(), errors = Pipe()
        child.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        child.arguments = ["xctest", "-XCTest", "TextTextFileProviderKitTests.LocalVaultAccountStateAdoptionTests/testResumeInSeparateProcess", Bundle(for: Self.self).bundleURL.path]
        // xctest can print its environment for a malformed invocation. Pass only
        // paths and owned fixture context, never the parent's credential env.
        var environment = ["PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "TEXTTEXT_STORE": "1", "TEXTTEXT_ADOPTION_FIXTURE_ROOT": f.root.path, "TEXTTEXT_ADOPTION_FIXTURE_NONCE": nonce]
        for key in ["DEVELOPER_DIR", "DYLD_FRAMEWORK_PATH", "DYLD_LIBRARY_PATH", "SDKROOT"] {
            if let value = ProcessInfo.processInfo.environment[key] { environment[key] = value }
        }
        child.environment = environment; child.standardOutput = output; child.standardError = errors
        try child.run()
        let deadline = Date().addingTimeInterval(20)
        while child.isRunning && Date() < deadline { try await Task.sleep(nanoseconds: 20_000_000) }
        if child.isRunning { _ = kill(child.processIdentifier, SIGKILL); child.waitUntilExit(); XCTFail("Owned adoption child exceeded its deadline"); return }
        let stdout = output.fileHandleForReading.readDataToEndOfFile(), stderr = errors.fileHandleForReading.readDataToEndOfFile()
        guard child.terminationStatus == 0, stdout.count < 8192, stderr.count < 8192,
              String(decoding: stdout, as: UTF8.self).contains("PASS owned child resumes recorded adoption") else {
            XCTFail("Owned adoption child failed: " + String(decoding: (stdout + stderr).prefix(2048), as: UTF8.self)); return
        }
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: f.directory.appendingPathComponent("sync/state.json"))) as? [String: Any])
        XCTAssertEqual(object["accountId"] as? String, "account-a")
        let outbox = try XCTUnwrap(object["outbox"] as? [String: [String: Any]])
        XCTAssertEqual(outbox["adoption-note"]?["operationId"] as? String, f.operation)
        XCTAssertEqual(try Data(contentsOf: f.root.appendingPathComponent("Notes/Queued.textpack")), f.pending)
    }
    func testInterruptedAdoptionPreservesOriginalsAndResumesOnlyForReviewedAccount() async throws {
        let phases = ["prepared:shared-editing/adoption-shared/checkpoint.json", "prepared:sync/state.json", "intent",
            "applied:shared-editing/adoption-shared/checkpoint.json", "applied:sync/state.json", "owner"]
        for (index, phase) in phases.enumerated() {
            let f = try await create("interrupted-\(index)")
            XCTAssertThrowsError(try adopt(f) { if $0 == phase { throw Interrupted() } })
            let pending = f.directory.appendingPathComponent(LocalVaultAccountRootOwnership.pendingAdoption)
            if phase.hasPrefix("prepared:") {
                XCTAssertFalse(FileManager.default.fileExists(atPath: pending.path))
                XCTAssertEqual(try Data(contentsOf: f.directory.appendingPathComponent("sync/state.json")), f.state)
                XCTAssertEqual(try Data(contentsOf: f.directory.appendingPathComponent(f.checkpointPath)), f.checkpoint)
            } else {
                let state = try Data(contentsOf: f.directory.appendingPathComponent("sync/state.json")), checkpoint = try Data(contentsOf: f.directory.appendingPathComponent(f.checkpointPath))
                XCTAssertThrowsError(try adopt(f, account: "account-b"))
                XCTAssertEqual(try Data(contentsOf: f.directory.appendingPathComponent("sync/state.json")), state)
                XCTAssertEqual(try Data(contentsOf: f.directory.appendingPathComponent(f.checkpointPath)), checkpoint)
                XCTAssertThrowsError(try makeTestSync(root: f.root, binding: binding, transport: f.remote, accountId: "account-a"))
            }
            let result = try adopt(f), recovery = try XCTUnwrap(result.recoveryDirectory)
            XCTAssertFalse(result.alreadyBound); XCTAssertFalse(FileManager.default.fileExists(atPath: pending.path))
            XCTAssertEqual(try Data(contentsOf: recovery.appendingPathComponent("before/sync/state.json")), f.state)
            XCTAssertEqual(try Data(contentsOf: recovery.appendingPathComponent("before/" + f.checkpointPath)), f.checkpoint)
            XCTAssertEqual(try Data(contentsOf: f.root.appendingPathComponent("Notes/Queued.textpack")), f.pending)
            XCTAssertEqual(try Data(contentsOf: f.root.appendingPathComponent("Notes/Shared.textpack")), f.projection)
            let cp = try XCTUnwrap(LocalVaultSharedEditingStore(root: f.root, accountId: "account-a").checkpoint(itemId: "adoption-shared"))
            XCTAssertEqual((try JSONSerialization.jsonObject(with: Data(cp.journal.utf8)) as? [String: Any])?["accountId"] as? String, "account-a")
            XCTAssertTrue(cp.pending)
            let archives = try FileManager.default.contentsOfDirectory(atPath: f.directory.path).filter { $0.hasPrefix(".account-adoption-") }
            XCTAssertTrue(try adopt(f).alreadyBound)
            XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: f.directory.path).filter { $0.hasPrefix(".account-adoption-") }.count, archives.count)
            let resumed = try makeTestSync(root: f.root, binding: binding, transport: f.remote, accountId: "account-a")
            _ = try await resumed.sync()
            let uploaded = await f.remote.uploads(); XCTAssertEqual(uploaded.last?.operationId, f.operation)
            let remote = try await f.remote.download(itemId: "adoption-note"); XCTAssertEqual(remote.data, f.pending)
            _ = try await makeTestSync(root: f.root, binding: binding, transport: f.remote, accountId: "account-a").sync()
            let unchanged = await f.remote.uploads(); XCTAssertEqual(unchanged.count, uploaded.count)
        }
    }
    func testFutureForeignCorruptAndUnsafeStateStayProtected() async throws {
        for failure in ["future-state", "foreign-state", "future-intent", "unsafe-path", "corrupt-before", "corrupt-after"] {
            let f = try await create(failure), stateURL = f.directory.appendingPathComponent("sync/state.json")
            let pending = f.directory.appendingPathComponent(LocalVaultAccountRootOwnership.pendingAdoption)
            if ["future-state", "foreign-state"].contains(failure) {
                var state = try XCTUnwrap(JSONSerialization.jsonObject(with: f.state) as? [String: Any])
                if failure == "future-state" { state["version"] = 999 } else { state["accountId"] = "account-b" }
                try JSONSerialization.data(withJSONObject: state).write(to: stateURL, options: .atomic)
            } else {
                XCTAssertThrowsError(try adopt(f) { if $0 == "intent" { throw Interrupted() } })
                var intent = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: pending)) as? [String: Any])
                if failure == "future-intent" { intent["version"] = 999; try JSONSerialization.data(withJSONObject: intent).write(to: pending, options: .atomic) }
                else if failure == "unsafe-path" {
                    var entries = try XCTUnwrap(intent["entries"] as? [[String: Any]]); entries[0]["path"] = "../outside.json"; intent["entries"] = entries
                    try JSONSerialization.data(withJSONObject: intent).write(to: pending, options: .atomic)
                } else {
                    let folder = try XCTUnwrap(intent["directory"] as? String), copy = f.directory.appendingPathComponent(folder + "/" + (failure == "corrupt-before" ? "before/" : "after/") + "sync/state.json")
                    var bytes = try Data(contentsOf: copy); bytes.append(32); try bytes.write(to: copy, options: .atomic)
                }
            }
            let retained = try Data(contentsOf: stateURL), intentBytes = try? Data(contentsOf: pending)
            XCTAssertThrowsError(try adopt(f))
            XCTAssertEqual(try Data(contentsOf: stateURL), retained)
            XCTAssertEqual(try Data(contentsOf: f.directory.appendingPathComponent(f.checkpointPath)), f.checkpoint)
            XCTAssertEqual(try? Data(contentsOf: pending), intentBytes)
        }
    }
    func testCapabilityAdoptionPreservesRawCacheAndRevokesUnverifiedWriteGrants() async throws {
        let f = try await create("capabilities"), cache = f.directory.appendingPathComponent("workspace-capabilities.json")
        let object: [String: Any] = ["binding": try JSONSerialization.jsonObject(with: JSONEncoder().encode(binding)),
            "capabilities": ["fullAccess": true, "canCreateContent": true, "writableFolders": [], "writableItems": [], "knownPaths": [], "writablePaths": []]]
        let original = try JSONSerialization.data(withJSONObject: object); try original.write(to: cache, options: .atomic)
        XCTAssertThrowsError(try adopt(f) { if $0 == "applied:workspace-capabilities.json" { throw Interrupted() } })
        let result = try adopt(f), recovery = try XCTUnwrap(result.recoveryDirectory)
        XCTAssertEqual(try Data(contentsOf: recovery.appendingPathComponent("before/workspace-capabilities.json")), original)
        let adopted = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: cache)) as? [String: Any])
        XCTAssertEqual(adopted["accountId"] as? String, "account-a")
        let denied = try XCTUnwrap(adopted["capabilities"] as? [String: Any])
        XCTAssertEqual(denied["fullAccess"] as? Bool, false); XCTAssertEqual(denied["canCreateContent"] as? Bool, false)
    }
    func testForeignCachedOwnerCannotBeSilentlyAdoptedWithAnUnboundQueue() async throws {
        let f = try await create("foreign-capabilities"), cache = f.directory.appendingPathComponent("workspace-capabilities.json")
        let object: [String: Any] = ["accountId": "account-b", "binding": try JSONSerialization.jsonObject(with: JSONEncoder().encode(binding)),
            "capabilities": ["fullAccess": true, "canCreateContent": true, "writableFolders": [], "writableItems": [], "knownPaths": [], "writablePaths": []]]
        let original = try JSONSerialization.data(withJSONObject: object); try original.write(to: cache, options: .atomic)
        XCTAssertThrowsError(try adopt(f))
        XCTAssertEqual(try Data(contentsOf: cache), original)
        XCTAssertEqual(try Data(contentsOf: f.directory.appendingPathComponent("sync/state.json")), f.state)
        XCTAssertFalse(FileManager.default.fileExists(atPath: f.directory.appendingPathComponent(LocalVaultAccountRootOwnership.pendingAdoption).path))
    }
    func testARecordChangedBetweenReplacementStepsIsNotOverwritten() async throws {
        let f = try await create("racing-target"), target = f.directory.appendingPathComponent("sync/state.json")
        var changed = f.state; changed.append(32)
        XCTAssertThrowsError(try adopt(f) { phase in if phase == "applied:" + f.checkpointPath { try changed.write(to: target, options: .atomic) } })
        XCTAssertEqual(try Data(contentsOf: target), changed)
        XCTAssertTrue(FileManager.default.fileExists(atPath: f.directory.appendingPathComponent(LocalVaultAccountRootOwnership.pendingAdoption).path))
    }
    private func addRetainedReplacement(_ fixture: Fixture) throws -> (index: URL, operation: UUID, prepared: Data, displaced: Data) {
        let target = fixture.root.appendingPathComponent("Notes/Replacement.textpack")
        let original = try pack("replacement-adoption", "original"), prepared = try pack("replacement-adoption", "prepared"), external = try pack("replacement-adoption", "external")
        try original.write(to: target)
        let operation = UUID(), registry = ReplacementRecoveryRegistry(root: fixture.root)
        XCTAssertThrowsError(try RetainedFileReplacement.replace(target, expectedHash: TextTextStableDigest.sha256Hex(original), prepared: prepared, operation: operation) { phase in
            if phase == "prepared" { try registry.register(operation: operation, itemId: "replacement-adoption", path: "Notes/Replacement.textpack", expectedHash: TextTextStableDigest.sha256Hex(original), preparedHash: TextTextStableDigest.sha256Hex(prepared)) }
            if phase == "beforeSwap" { try external.write(to: target, options: .atomic) }
        })
        return (fixture.directory.appendingPathComponent("replacement-index/" + operation.uuidString + ".json"), operation, prepared, external)
    }
    func testExplicitAdoptionMigratesUnownedRegistryTransactionAndPreservesBothVersions() async throws {
        for stop in ["intent", "applied"] {
            let f = try await create("replacement-" + stop), retained = try addRetainedReplacement(f)
            let staging = retained.index.deletingLastPathComponent().appendingPathComponent("." + UUID().uuidString)
            let unfinished = Data("uncommitted staging bytes".utf8)
            try unfinished.write(to: staging)
            let before = try Data(contentsOf: retained.index)
            let relative = "replacement-index/" + retained.operation.uuidString + ".json"
            XCTAssertThrowsError(try adopt(f) { phase in if phase == (stop == "intent" ? "intent" : "applied:" + relative) { throw Interrupted() } })
            let result = try adopt(f)
            let backup = try XCTUnwrap(result.recoveryDirectory).appendingPathComponent("before/" + relative)
            XCTAssertEqual(try Data(contentsOf: backup), before)
            XCTAssertEqual(try Data(contentsOf: staging), unfinished)
            let registry = ReplacementRecoveryRegistry(root: f.root), entry = try XCTUnwrap(registry.entries().first)
            let inspection = try registry.inspect(entry)
            XCTAssertEqual(inspection.prepared, retained.prepared)
            XCTAssertEqual(inspection.displaced, retained.displaced)
            XCTAssertThrowsError(try LocalVaultDocumentStore(root: f.root).read(path: "Notes/Replacement.textpack"), "Adoption never resolves the retained content conflict.")
            let store = LocalVaultDocumentStore(root: f.root), shown = try XCTUnwrap(store.replacementRecoveryList().first)
            try store.resolveReplacement(id: shown.id, path: shown.path, itemId: shown.itemId, currentHash: shown.currentHash, preparedHash: shown.preparedHash, displacedHash: shown.displacedHash)
            XCTAssertEqual(try store.read(path: shown.path).hash, TextTextStableDigest.sha256Hex(retained.prepared))
        }
    }
    func testAdoptionRefusesFutureForeignAndUnknownReplacementFieldsWithoutChangingIndex() async throws {
        for mutation in ["future", "foreign", "unknown", "unknown-resolution"] {
            let f = try await create("replacement-refusal-" + mutation), retained = try addRetainedReplacement(f)
            var value = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: retained.index)) as? [String: Any])
            if mutation == "future" { value["version"] = 999 }
            if mutation == "foreign" { value["ownerHash"] = String(repeating: "f", count: 64) }
            if mutation == "unknown" { value["futureRequiredPolicy"] = true }
            if mutation == "unknown-resolution" { value["resolution"] = ["visibleHash": String(repeating: "a", count: 64), "preparedHash": String(repeating: "a", count: 64), "displacedHash": String(repeating: "a", count: 64), "futureRequiredPolicy": true] }
            let bytes = try JSONSerialization.data(withJSONObject: value)
            try bytes.write(to: retained.index)
            XCTAssertThrowsError(try adopt(f))
            XCTAssertEqual(try Data(contentsOf: retained.index), bytes)
            XCTAssertEqual(try Data(contentsOf: f.directory.appendingPathComponent("sync/state.json")), f.state)
            XCTAssertFalse(FileManager.default.fileExists(atPath: f.directory.appendingPathComponent(LocalVaultAccountRootOwnership.pendingAdoption).path))
        }
    }
}
