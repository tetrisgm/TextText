import Foundation
import XCTest
import TextTextWorkspaceCore
@testable import TextTextFileProviderKit

final class LocalVaultSharedRenameTests: XCTestCase {
    private typealias Model = LocalVaultSharedRename
    private let root = String(repeating: "a", count: 64), revision = String(repeating: "b", count: 64), localHash = String(repeating: "c", count: 64)
    private var scope: LocalVaultProtectedRenameScope { .init(origin: "https://fixture.test", workspaceId: "workspace", accountId: "account") }
    private func pending(destination: String = "Notes/B.textpack", operation: String = "11111111-1111-4111-8111-111111111111") -> Model.Record {
        .init(rootHash: root, request: .init(operationId: operation, itemId: "item", source: "Notes/A.textpack", destination: destination, baseRevision: revision), scope: scope, baselineHash: localHash, lifecycle: "generation")
    }
    private func receipt(_ record: Model.Record, status: String = "conflict", path: String? = nil, revision: String? = nil, deleted: Bool = false) -> LocalVaultProtectedRenameReceipt {
        .init(request: record.request, scope: record.scope, status: status, relativePath: path ?? record.request.source, revision: revision, deleted: deleted)
    }
    private func rejected() throws -> Model.Record {
        guard case .rejected(let value) = try Model.consume(receipt(pending(), revision: revision), for: pending()) else { throw Model.Failure.invalid }; return value
    }
    private func observation(destination: String = "Notes/C.textpack", remote: String = "Notes/A.textpack", lifecycle: String? = "generation", permitted: Bool = true) -> Model.ReplacementObservation {
        .init(rootHash: root, scope: scope, localPath: destination, remotePath: remote, localLifecycle: lifecycle, remoteLifecycle: lifecycle, remoteRevision: revision, checkpointPath: destination, checkpointReady: true, localUnique: true, organizePermitted: permitted)
    }
    private func stopped() throws -> Model.Record {
        try Model.stopped(rejected(), resolution: .init(localPath: "Notes/B.textpack", remotePath: "Notes/A.textpack", localLifecycle: "generation", remoteLifecycle: "generation"))
    }
    func testCommonCodecVectors() throws {
        let rootURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let fixture = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: rootURL.appendingPathComponent("sync/fixtures/protected-rename-state.json"))) as? [String: Any])
        let context = fixture["context"] as! [String: Any]
        let expectedScope = try JSONDecoder().decode(LocalVaultProtectedRenameScope.self, from: JSONSerialization.data(withJSONObject: context["scope"]!))
        let cases = fixture["cases"] as! [[String: Any]]
        XCTAssertEqual(cases.count, 32)
        for vector in cases {
            let bytes = try JSONSerialization.data(withJSONObject: vector["record"]!)
            func read() throws {
                _ = try Model.decodeRecord(bytes, context: .init(rootHash: context["rootHash"] as! String, scope: expectedScope))
            }
            if vector["valid"] as! Bool { XCTAssertNoThrow(try read(), vector["name"] as! String) }
            else { XCTAssertThrowsError(try read(), vector["name"] as! String) }
        }
    }
    func testCommonRawDuplicateAndMapVectors() throws {
        let rootURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let fixture = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: rootURL.appendingPathComponent("sync/fixtures/protected-rename-state.json"))) as? [String: Any])
        for group in ["rawRecords", "rawMaps"] {
            for vector in fixture[group] as! [[String: Any]] {
                let data = Data((vector["json"] as! String).utf8)
                func read() throws {
                    if group == "rawRecords" { _ = try Model.decodeRecord(data, context: .init(rootHash: root, scope: scope)) }
                    else { _ = try Model.decodeMap(data, context: .init(rootHash: root, scope: scope)) }
                }
                if vector["valid"] as! Bool { XCTAssertNoThrow(try read(), vector["name"] as! String) }
                else { XCTAssertThrowsError(try read(), vector["name"] as! String) }
            }
        }
    }
    func testRawStateBoundaryRejectsDuplicatesBeforeTypedStateDecode() throws {
        let record = String(decoding: try Model.archiveBytes(pending()), as: UTF8.self)
        XCTAssertNoThrow(try Model.validateStateBytes(Data(("{\"version\":1,\"sharedRenames\":{\"item\":" + record + "}}").utf8)))
        for text in ["{\"version\":1,\"version\":1}", "{\"sharedRenames\":{},\"\\u0073haredRenames\":{}}", "{\"sharedRenames\":{\"item\":" + record + ",\"item\":" + record + "}}", "{\"nested\":{\"a\":1,\"a\":2}}", "{\"nested\":[1,]}", "{\"a\":true,}", "{\"a\":01}"] {
            XCTAssertThrowsError(try Model.validateStateBytes(Data(text.utf8)), text)
        }
        XCTAssertThrowsError(try Model.validateStateBytes(Data([123, 34, 97, 34, 58, 34, 255, 34, 125])))
        XCTAssertThrowsError(try Model.validateStateBytes(Data(("{\"a\":" + String(repeating: "[", count: 33) + "0" + String(repeating: "]", count: 33) + "}").utf8)))
        XCTAssertThrowsError(try Model.decodeRecord(Data(repeating: 32, count: 32769), context: .init(rootHash: root, scope: scope)))
    }
    func testMapCountBoundAndExplicitOwnerContext() throws {
        var map: [String: Model.Record] = [:]
        for index in 0..<1000 {
            let base = pending(), item = "item\(index)"
            let request = LocalVaultProtectedRenameRequest(operationId: String(format: "11111111-1111-4111-8111-%012d", index), itemId: item, source: base.request.source, destination: base.request.destination, baseRevision: base.request.baseRevision)
            map[item] = .init(rootHash: root, request: request, scope: scope, baselineHash: localHash, lifecycle: "generation")
        }
        XCTAssertNoThrow(try Model.decodeMap(JSONEncoder().encode(map), context: .init(rootHash: root, scope: scope)))
        let extra = pending(operation: "22222222-2222-4222-8222-222222222222"); map["item"] = extra
        XCTAssertThrowsError(try Model.decodeMap(JSONEncoder().encode(map), context: .init(rootHash: root, scope: scope)))
        XCTAssertThrowsError(try Model.decodeRecord(Model.archiveBytes(pending()), context: .init(rootHash: revision, scope: scope)))
    }
    func testEqualStateDoesNotWriteOrAllocateAnotherIntent() throws {
        let record = pending(), current = ["item": record]
        let result = try Model.commit(context: .init(rootHash: root, scope: scope), current: current, itemId: "item", expected: record, replacement: record) { _ in XCTFail("Unchanged record must not write") }
        XCTAssertEqual(result, current)
    }
    func testStrictRoundTripPreservesImmutableRequestAndTerminalReceipt() throws {
        for record in [pending(), try rejected(), try stopped()] {
            let bytes = try Model.archiveBytes(record), restored = try JSONDecoder().decode(Model.Record.self, from: bytes)
            XCTAssertEqual(restored, record)
            let fields = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
            XCTAssertNotNil(fields["receipt"]); XCTAssertNotNil(fields["resolution"])
            XCTAssertEqual(restored.request.operationId, pending().request.operationId)
        }
    }
    func testFutureKeysAndMissingRequiredFieldsRefuseAtEveryStoredLevel() throws {
        let data = try Model.archiveBytes(stopped())
        for level in ["record", "request", "scope", "receipt", "resolution"] {
            var object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            if level == "record" { object["future"] = true }
            else { var child = object[level] as! [String: Any]; child["future"] = true; object[level] = child }
            XCTAssertThrowsError(try JSONDecoder().decode(Model.Record.self, from: JSONSerialization.data(withJSONObject: object)), level)
        }
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any]); object.removeValue(forKey: "receipt")
        XCTAssertThrowsError(try JSONDecoder().decode(Model.Record.self, from: JSONSerialization.data(withJSONObject: object)))
        object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any]); object["phase"] = "future"
        XCTAssertThrowsError(try JSONDecoder().decode(Model.Record.self, from: JSONSerialization.data(withJSONObject: object)))
    }
    func testScopeHashPathGenerationAndMapIdentityValidation() throws {
        let valid = pending()
        XCTAssertNoThrow(try Model.validate(valid, rootHash: root, scope: scope))
        XCTAssertThrowsError(try Model.validate(valid, rootHash: revision, scope: scope))
        XCTAssertThrowsError(try Model.validate(valid, rootHash: root, scope: .init(origin: scope.origin, workspaceId: "other", accountId: "account")))
        for path in ["../B.textpack", "/B.textpack", "Notes//B.textpack", "C:\\B.textpack", "Notes/B.txt", "Notes/\u{0}B.textpack"] {
            XCTAssertThrowsError(try Model.validate(pending(destination: path), rootHash: root, scope: scope))
        }
        XCTAssertThrowsError(try Model.validate(pending(operation: "not-an-operation"), rootHash: root, scope: scope))
        XCTAssertThrowsError(try Model.validateMap(["wrong-item": valid], rootHash: root, scope: scope))
        let noAccount = Model.Record(rootHash: root, request: valid.request, scope: .init(origin: scope.origin, workspaceId: scope.workspaceId, accountId: nil), baselineHash: localHash, lifecycle: "generation")
        XCTAssertThrowsError(try Model.validate(noAccount, rootHash: root, scope: noAccount.scope))
    }
    func testMovedReceiptRequiresExactOriginalRequestDestinationRevisionAndScope() throws {
        let record = pending()
        XCTAssertEqual(try Model.consume(receipt(record, status: "moved", path: record.request.destination, revision: record.request.baseRevision), for: record), .moved(revision))
        for response in [receipt(record, status: "moved", path: record.request.destination, revision: localHash), receipt(record, status: "moved", path: record.request.source, revision: revision), receipt(record, status: "moved", path: record.request.destination, revision: revision, deleted: true), receipt(record, status: "generic409")] {
            XCTAssertThrowsError(try Model.consume(response, for: record))
        }
        let foreign = LocalVaultProtectedRenameReceipt(request: record.request, scope: .init(origin: scope.origin, workspaceId: scope.workspaceId, accountId: "foreign"), status: "conflict", relativePath: record.request.source, revision: revision, deleted: false)
        XCTAssertThrowsError(try Model.consume(foreign, for: record))
        XCTAssertThrowsError(try Model.consume(receipt(pending(operation: "22222222-2222-4222-8222-222222222222")), for: record))
    }
    func testOnlyTerminalRejectedReceiptMayBecomeStopped() throws {
        let resolution = Model.Resolution(localPath: "Notes/B.textpack", remotePath: "Notes/A.textpack", localLifecycle: "generation", remoteLifecycle: "generation")
        XCTAssertThrowsError(try Model.stopped(pending(), resolution: resolution))
        XCTAssertThrowsError(try Model.stopped(rejected(), resolution: .init(localPath: resolution.localPath, remotePath: resolution.remotePath, localLifecycle: "generation", remoteLifecycle: "other")))
        guard case .rejected(let deleted) = try Model.consume(receipt(pending(), revision: revision, deleted: true), for: pending()) else { return XCTFail() }
        XCTAssertThrowsError(try Model.stopped(deleted, resolution: resolution))
    }
    func testStoppedSuppressionSurvivesRestartAndIgnoresPeerTextRevision() throws {
        let record = try JSONDecoder().decode(Model.Record.self, from: Model.archiveBytes(stopped()))
        // Content revisions/hashes are intentionally not suppression inputs.
        for _ in [revision, localHash, root] { XCTAssertTrue(Model.matchesStoppedFacts(record, localPath: "Notes/B.textpack", remotePath: "Notes/A.textpack", localLifecycle: "generation", remoteLifecycle: "generation", unique: true)) }
        XCTAssertFalse(Model.matchesStoppedFacts(record, localPath: "Notes/C.textpack", remotePath: "Notes/A.textpack", localLifecycle: "generation", remoteLifecycle: "generation", unique: true))
        XCTAssertFalse(Model.matchesStoppedFacts(record, localPath: "Notes/B.textpack", remotePath: "Notes/C.textpack", localLifecycle: "generation", remoteLifecycle: "generation", unique: true))
        XCTAssertFalse(Model.matchesStoppedFacts(record, localPath: "Notes/B.textpack", remotePath: "Notes/A.textpack", localLifecycle: "generation", remoteLifecycle: nil, unique: true))
        XCTAssertFalse(Model.matchesStoppedFacts(record, localPath: "Notes/B.textpack", remotePath: "Notes/A.textpack", localLifecycle: "generation", remoteLifecycle: "generation", unique: false))
    }
    func testStateCommitIsOneExistingWriterCallAndFailureRetainsOriginalMap() throws {
        let record = pending(); var committed: [String: Model.Record] = [:], writes = 0
        let next = try Model.commit(context: .init(rootHash: root, scope: scope), current: [:], itemId: "item", expected: nil, replacement: record) { value in writes += 1; committed = value }
        XCTAssertEqual(writes, 1); XCTAssertEqual(next, committed)
        XCTAssertThrowsError(try Model.commit(context: .init(rootHash: root, scope: scope), current: next, itemId: "item", expected: record, replacement: rejected()) { _ in throw Model.Failure.changed })
        XCTAssertEqual(committed["item"], record)
        XCTAssertThrowsError(try Model.commit(context: .init(rootHash: root, scope: scope), current: next, itemId: "item", expected: record, replacement: nil) { _ in XCTFail("Ambiguous intent must not be removed") })
        let completed = try Model.commit(context: .init(rootHash: root, scope: scope), current: next, itemId: "item", expected: record, replacement: nil, completion: receipt(record, status: "moved", path: record.request.destination, revision: revision)) { committed = $0 }
        XCTAssertTrue(completed.isEmpty)
    }
    func testStoppedReplacementRequiresDurableExactArchiveBeforeWholeStateCommit() throws {
        let old = try stopped(), fresh = pending(destination: "Notes/C.textpack", operation: "22222222-2222-4222-8222-222222222222")
        let current = ["item": old]; var events: [String] = [], identities: [String] = []
        XCTAssertThrowsError(try Model.commit(context: .init(rootHash: root, scope: scope), current: current, itemId: "item", expected: old, replacement: fresh) { _ in XCTFail("Archive missing") })
        for durable in [false, true] {
            do {
                _ = try Model.commit(context: .init(rootHash: root, scope: scope), current: current, itemId: "item", expected: old, replacement: fresh, observation: observation(), archive: { record, bytes in
                    events.append("archive"); identities.append(record.request.operationId)
                    return .init(operationId: record.request.operationId, rootHash: record.rootHash, scope: record.scope, recordHash: TextTextStableDigest.sha256Hex(bytes), durable: durable)
                }) { value in events.append("state"); XCTAssertEqual(value["item"], fresh); if !durable { XCTFail("Undurable archive") } }
                XCTAssertTrue(durable)
            } catch { XCTAssertFalse(durable) }
        }
        XCTAssertEqual(events, ["archive", "archive", "state"])
        XCTAssertEqual(identities, [old.request.operationId, old.request.operationId])
        XCTAssertEqual(current["item"], old)
    }
    func testStoppedReplacementRefusesUnknownOrDivergentFreshFactsBeforeArchive() throws {
        let old = try stopped(), fresh = pending(destination: "Notes/C.textpack", operation: "22222222-2222-4222-8222-222222222222")
        for facts in [nil, observation(lifecycle: nil), observation(remote: "Notes/Peer.textpack"), observation(permitted: false), observation(destination: "Notes/B.textpack")] as [Model.ReplacementObservation?] {
            XCTAssertThrowsError(try Model.commit(context: .init(rootHash: root, scope: scope), current: ["item": old], itemId: "item", expected: old, replacement: fresh, observation: facts, archive: { _, _ in XCTFail("No archive on stale facts"); throw Model.Failure.archive }) { _ in XCTFail("No state write on stale facts") })
        }
    }
    func testImmutableRequestAndStaleExpectedRecordCannotBeRetargeted() throws {
        let old = pending(), fresh = pending(destination: "Notes/C.textpack", operation: "22222222-2222-4222-8222-222222222222")
        XCTAssertThrowsError(try Model.commit(context: .init(rootHash: root, scope: scope), current: ["item": old], itemId: "item", expected: old, replacement: fresh) { _ in XCTFail("Pending request changed") })
        XCTAssertThrowsError(try Model.commit(context: .init(rootHash: root, scope: scope), current: ["item": old], itemId: "item", expected: fresh, replacement: fresh) { _ in XCTFail("Stale state") })
    }
}
