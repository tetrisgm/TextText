import Foundation
import XCTest
@testable import TextTextAppIntents

final class NativeItemActionsTests: XCTestCase {
    final class Server: NativeWorkspaceCommandServer {
        var calls: [(String, [String: Any])] = []
        var fail = false
        var hash: String? = "revision"
        func command(_ name: String, args: [String: Any]) throws -> [String: Any] {
            calls.append((name, args))
            if fail { throw WorkspaceIntentServerError.conflict }
            var item: [String: Any] = ["id": "one", "title": "Note", "kind": "note"]
            item["hash"] = hash
            return name == "search" ? ["results": [item]] : ["item": item]
        }
    }
    func testCreateUsesCommandAndPrivateNoteKind() throws {
        let server = Server()
        let result = try NativeItemActions(server: server).create(title: "Title", body: "Body", folder: "Notes")
        XCTAssertEqual(result.id, "one")
        XCTAssertEqual(server.calls.first?.0, "create_item")
        XCTAssertEqual(server.calls.first?.1["kind"] as? String, "note")
        XCTAssertEqual(server.calls.first?.1["folder_path"] as? String, "Notes")
        XCTAssertNotNil(server.calls.first?.1["idempotency_key"])
    }
    func testAppendReadsAndPassesVersionToSharedAppend() throws {
        let server = Server()
        _ = try NativeItemActions(server: server).append(id: "one", text: "More")
        XCTAssertEqual(server.calls.map { $0.0 }, ["read_item", "append_to_item"])
        XCTAssertEqual(server.calls.last?.1["if_match_hash"] as? String, "revision")
        XCTAssertEqual(server.calls.last?.1["markdown"] as? String, "More")
    }
    func testAppendRefusesMissingVersion() throws {
        let server = Server(); server.hash = nil
        XCTAssertThrowsError(try NativeItemActions(server: server).append(id: "one", text: "More"))
        XCTAssertEqual(server.calls.count, 1)
    }
    func testAppendPropagatesConflict() throws {
        let server = Server(); server.fail = true
        XCTAssertThrowsError(try NativeItemActions(server: server).append(id: "one", text: "More"))
    }
    func testSearchUsesServerAndClampsLimit() throws {
        let server = Server()
        XCTAssertEqual(try NativeItemActions(server: server).search(query: "body", limit: 500).count, 1)
        XCTAssertEqual(server.calls.first?.0, "search")
        XCTAssertEqual(server.calls.first?.1["limit"] as? Int, 50)
    }
    func testOpenResolvesAccessBeforeReturningDeepLink() throws {
        let server = Server()
        XCTAssertEqual(try NativeItemActions(server: server).open(id: "one").absoluteString, "texttext-app://item/one")
        XCTAssertEqual(server.calls.first?.0, "read_item")
        server.fail = true
        XCTAssertThrowsError(try NativeItemActions(server: server).open(id: "one"))
    }
    func testEmptyInputsDoNotMutate() throws {
        let server = Server(); let actions = try NativeItemActions(server: server)
        XCTAssertThrowsError(try actions.create(title: "  ", body: "", folder: ""))
        XCTAssertThrowsError(try actions.append(id: "one", text: "  "))
        XCTAssertTrue(server.calls.isEmpty)
    }
}
