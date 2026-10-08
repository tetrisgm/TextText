import Foundation
import XCTest
import TextTextFileProviderKit

@testable import TextTextApp
@testable import TextTextWorkspaceCore

private final class VaultAgentTestServer: LocalVaultAgentServer {
    struct Request {
        let id: String
        let method: String
        let params: [String: Any]
    }
    struct Response {
        let id: AnyHashable
        let result: [String: Any]
    }

    var onEvent: ((CodexAppServerMessage) -> Void)?
    var onExit: ((Int32) -> Void)?
    private(set) var requests: [Request] = []
    private(set) var responses: [Response] = []
    private(set) var notifications: [(String, [String: Any])] = []
    private(set) var stopCount = 0
    private let accountEmail: String?

    init(accountEmail: String? = "writer@example.com") {
        self.accountEmail = accountEmail
    }

    func start() throws {}
    func stop() { stopCount += 1 }

    func send(id: String, method: String, params: [String: Any]) throws {
        let request = Request(id: id, method: method, params: params)
        requests.append(request)
        switch method {
        case "initialize":
            emitResponse(request, result: [:])
        case "account/read":
            var account: [String: Any] = ["type": "chatgpt", "planType": "pro"]
            if let accountEmail { account["email"] = accountEmail }
            emitResponse(request, result: ["account": account])
        case "config/read":
            emitResponse(request, result: ["config": ["mcp_servers": [String: Any]()]])
        default:
            break
        }
    }

    func notify(method: String, params: [String: Any]) throws {
        notifications.append((method, params))
    }

    func respond(id: AnyHashable, result: [String: Any]) throws {
        responses.append(Response(id: id, result: result))
    }

    func requests(_ method: String) -> [Request] {
        requests.filter { $0.method == method }
    }

    func emitResponse(_ request: Request, result: [String: Any]) {
        emit(["jsonrpc": "2.0", "id": request.id, "result": result])
    }

    func emitNotification(_ method: String, params: [String: Any], id: AnyHashable? = nil) {
        var value: [String: Any] = ["jsonrpc": "2.0", "method": method, "params": params]
        if let id { value["id"] = id.base }
        emit(value)
    }

    private func emit(_ value: [String: Any]) {
        let data = try! JSONSerialization.data(withJSONObject: value)
        onEvent?(try! CodexAppServerMessage(data: data))
    }
}

final class LocalVaultAgentControllerTests: XCTestCase {
    private struct Timeout: Error {}

    @MainActor
    func testSelectedPhotoInputIsBoundedAndAttachedToItsTurn() async throws {
        let (root, controller, server) = try await fixture()
        defer { controller.stop(); try? FileManager.default.removeItem(at: root) }
        _ = try LocalVaultAgentFiles.perform("create_file", arguments: ["title": "Photo", "body": "Keep"],
            root: root, access: .folder(path: ""))
        for url in ["https://example.test/photo.jpg", "data:image/jpeg;base64,bm90LWpwZWc=",
                    "data:image/jpeg;base64," + String(repeating: "A", count: 1_000_000)] {
            XCTAssertThrowsError(try controller.send(taskID: "invalid", prompt: "Describe", path: "Photo.textpack", imageURL: url))
        }
        XCTAssertTrue(server.requests("thread/start").isEmpty)
        let url = "data:image/jpeg;base64,/9j/AA=="
        try controller.send(taskID: "photo", prompt: "Describe", path: "Photo.textpack", imageURL: url)
        server.emitResponse(try XCTUnwrap(server.requests("thread/start").first), result: ["thread": ["id": "photo-thread"]])
        try await eventually { server.requests("turn/start").count == 1 }
        let input = try XCTUnwrap(server.requests("turn/start").first?.params["input"] as? [[String: Any]])
        XCTAssertEqual(input.count, 2)
        XCTAssertEqual(input[1]["type"] as? String, "image")
        XCTAssertEqual(input[1]["url"] as? String, url)
    }

    @MainActor
    private func fixture(ownsProfile: Bool = false, accountEmail: String? = "writer@example.com",
                         cancellationTimeout: TimeInterval = 15) async throws
        -> (URL, LocalVaultAgentController, VaultAgentTestServer) {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("texttext-agent-task-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let server = VaultAgentTestServer(accountEmail: accountEmail)
        let controller = LocalVaultAgentController(root: root, serverFactory: { server },
            ownsProfile: ownsProfile,
            cancellationTimeout: cancellationTimeout)
        try controller.connect()
        try await eventually { controller.status["state"] as? String == "ready" }
        return (root, controller, server)
    }

    @MainActor
    private func eventually(_ label: String = "native agent state", _ condition: @escaping () -> Bool) async throws {
        for _ in 0..<200 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Timed out waiting for \(label)")
        throw Timeout()
    }

    @MainActor
    private func start(_ taskID: String, threadID: String, turnID: String,
                       controller: LocalVaultAgentController, server: VaultAgentTestServer) async throws {
        let threadIndex = server.requests("thread/start").count
        try controller.send(taskID: taskID, prompt: "List the current files")
        try await eventually { server.requests("thread/start").count == threadIndex + 1 }
        let thread = server.requests("thread/start")[threadIndex]
        server.emitResponse(thread, result: ["thread": ["id": threadID]])
        try await eventually { server.requests("turn/start").count == threadIndex + 1 }
        let turn = server.requests("turn/start")[threadIndex]
        server.emitResponse(turn, result: ["turn": ["id": turnID]])
        try await eventually { controller.activeTaskIdentifiers?.turnID == turnID }
    }

    @MainActor
    private func complete(threadID: String, turnID: String, server: VaultAgentTestServer) {
        server.emitNotification("turn/completed", params: [
            "threadId": threadID,
            "turn": ["id": turnID, "status": "completed", "items": []],
        ])
    }

    @MainActor
    func testEverySubmittedTaskStartsAFreshAppServerThread() async throws {
        let (root, controller, server) = try await fixture()
        defer { controller.stop(); try? FileManager.default.removeItem(at: root) }

        try await start("task-one", threadID: "thread-one", turnID: "turn-one",
            controller: controller, server: server)
        complete(threadID: "thread-one", turnID: "turn-one", server: server)
        try await eventually { controller.status["state"] as? String == "ready" }

        try await start("task-two", threadID: "thread-two", turnID: "turn-two",
            controller: controller, server: server)

        XCTAssertEqual(server.requests("thread/start").count, 2)
        XCTAssertEqual(server.requests("turn/start").compactMap { $0.params["threadId"] as? String },
            ["thread-one", "thread-two"])
    }

    @MainActor
    func testEveryNonStatusEventCarriesTheActiveTaskID() async throws {
        let (root, controller, server) = try await fixture()
        defer { controller.stop(); try? FileManager.default.removeItem(at: root) }
        var events: [[String: Any]] = []
        controller.onEvent = { events.append($0) }

        try await start("task-correlated", threadID: "thread-correlated", turnID: "turn-correlated",
            controller: controller, server: server)
        server.emitNotification("item/started", params: [
            "threadId": "thread-correlated", "turnId": "turn-correlated",
            "item": ["id": "answer", "type": "agentMessage", "text": "", "phase": "final_answer"],
        ])
        server.emitNotification("item/agentMessage/delta", params: [
            "threadId": "thread-correlated", "turnId": "turn-correlated",
            "itemId": "answer", "delta": "Hello",
        ])
        server.emitNotification("item/completed", params: [
            "threadId": "thread-correlated", "turnId": "turn-correlated",
            "item": ["id": "answer", "type": "agentMessage", "text": "Hello", "phase": "final_answer"],
        ])
        complete(threadID: "thread-correlated", turnID: "turn-correlated", server: server)

        try await eventually { events.contains { $0["type"] as? String == "turn-completed" } }
        let taskEvents = events.filter { $0["type"] as? String != "status" }
        XCTAssertEqual(taskEvents.compactMap { $0["type"] as? String },
            ["text-delta", "final-text", "turn-completed"])
        XCTAssertTrue(taskEvents.allSatisfy { $0["taskId"] as? String == "task-correlated" })
    }

    @MainActor
    func testProviderFailureIsClassifiedAndCarriesAnOpaqueDiagnosticReference() async throws {
        let (root, controller, server) = try await fixture()
        defer { controller.stop(); try? FileManager.default.removeItem(at: root) }
        var events: [[String: Any]] = []
        controller.onEvent = { events.append($0) }

        try await start("task-failure", threadID: "thread-failure", turnID: "turn-failure",
            controller: controller, server: server)
        server.emitNotification("turn/completed", params: [
            "threadId": "thread-failure",
            "turn": ["id": "turn-failure", "status": "failed",
                "error": ["message": "billing quota exceeded bearer private-secret"]],
        ])

        try await eventually("classified task failure") { events.contains {
            $0["type"] as? String == "error" && $0["taskId"] as? String == "task-failure"
        } }
        let failure = try XCTUnwrap(events.first { $0["type"] as? String == "error" })
        XCTAssertEqual(failure["failureCode"] as? String, "quota")
        XCTAssertEqual(failure["recoveryAction"] as? String, "wait")
        XCTAssertFalse((failure["message"] as? String ?? "").contains("private-secret"))
        XCTAssertNotNil((failure["diagnosticId"] as? String)?.range(
            of: "^TT-[A-F0-9]{12}$", options: .regularExpression))
    }

    @MainActor
    func testStaleCancelAndLateToolCallFailClosed() async throws {
        let (root, controller, server) = try await fixture()
        defer { controller.stop(); try? FileManager.default.removeItem(at: root) }

        try await start("task-current", threadID: "thread-current", turnID: "turn-current",
            controller: controller, server: server)
        XCTAssertThrowsError(try controller.cancel(taskID: "task-stale"))
        XCTAssertTrue(server.requests("turn/interrupt").isEmpty)

        server.emitNotification("item/tool/call", params: [
            "threadId": "thread-stale", "turnId": "turn-stale", "namespace": "texttext",
            "tool": "create_file", "arguments": ["title": "Must not exist", "body": "No"],
        ], id: AnyHashable(71))
        try await eventually { server.responses.contains { $0.id == AnyHashable(71) } }
        let response = try XCTUnwrap(server.responses.first { $0.id == AnyHashable(71) })
        XCTAssertEqual(response.result["success"] as? Bool, false)
        XCTAssertTrue(try LocalVaultDocumentStore(root: root).list().isEmpty)
    }

    @MainActor
    func testCancelBeforeThreadStartPreservesDraftAndNeverStartsTurn() async throws {
        let (root, controller, server) = try await fixture()
        defer { controller.stop(); try? FileManager.default.removeItem(at: root) }
        var events: [[String: Any]] = []
        controller.onEvent = { events.append($0) }

        try controller.send(taskID: "task-pending", prompt: "Keep this draft")
        try await eventually { server.requests("thread/start").count == 1 }
        let pendingThread = server.requests("thread/start")[0]
        try controller.cancel(taskID: "task-pending")
        try await eventually { events.contains {
            $0["type"] as? String == "turn-cancelled" && $0["taskId"] as? String == "task-pending"
        } }
        server.emitResponse(pendingThread, result: ["thread": ["id": "late-thread"]])
        try await Task.sleep(for: .milliseconds(50))

        XCTAssertTrue(server.requests("turn/start").isEmpty)
        XCTAssertEqual(controller.status["state"] as? String, "ready")
        XCTAssertEqual(server.stopCount, 0)
    }

    @MainActor
    func testCurrentTaskCancelInterruptsAndKeepsAuthenticatedConnection() async throws {
        let (root, controller, server) = try await fixture(cancellationTimeout: 0.05)
        defer { controller.stop(); try? FileManager.default.removeItem(at: root) }
        var events: [[String: Any]] = []
        controller.onEvent = { events.append($0) }

        try await start("task-cancel", threadID: "thread-cancel", turnID: "turn-cancel",
            controller: controller, server: server)
        try controller.cancel(taskID: "task-cancel")
        try await eventually("turn interrupt") { server.requests("turn/interrupt").count == 1 }
        let interrupt = server.requests("turn/interrupt")[0]
        XCTAssertEqual(interrupt.params["threadId"] as? String, "thread-cancel")
        XCTAssertEqual(interrupt.params["turnId"] as? String, "turn-cancel")
        XCTAssertEqual(server.stopCount, 0)

        server.emitNotification("item/tool/call", params: [
            "threadId": "thread-cancel", "turnId": "turn-cancel", "namespace": "texttext",
            "tool": "create_file", "arguments": ["title": "Cancelled", "body": "No"],
        ], id: AnyHashable(72))
        try await eventually("cancelled tool rejection") { server.responses.contains { $0.id == AnyHashable(72) } }
        // A provider that accepts the interrupt but never reports completion
        // cannot hold the product task fence forever.
        try await eventually("cancellation deadline") { events.contains {
            $0["type"] as? String == "turn-cancelled" && $0["taskId"] as? String == "task-cancel"
        } }
        XCTAssertEqual(events.first { $0["type"] as? String == "turn-cancelled" }?["message"] as? String,
            "Stopped. Any save that already finished is preserved.")
        XCTAssertEqual(controller.status["state"] as? String, "ready")
        XCTAssertEqual(server.stopCount, 0)

        // The authenticated process is still usable without reconnecting.
        try controller.send(taskID: "task-next", prompt: "Continue")
        try await eventually("next private thread") { server.requests("thread/start").count == 2 }
        XCTAssertEqual(server.stopCount, 0)
    }

    @MainActor
    func testManagedProfileDisconnectLogsOutStopsAndCanReconnect() async throws {
        let (root, controller, server) = try await fixture(ownsProfile: true)
        defer { controller.stop(); try? FileManager.default.removeItem(at: root) }

        try controller.disconnect()
        try await eventually("managed account logout") { server.requests("account/logout").count == 1 }
        XCTAssertEqual(controller.status["state"] as? String, "connecting")
        XCTAssertEqual(server.stopCount, 0)

        server.emitResponse(server.requests("account/logout")[0], result: [:])
        try await eventually("disconnected state") {
            controller.status["state"] as? String == "disconnected"
        }
        XCTAssertNil(controller.status["accountEmail"])
        XCTAssertEqual(server.stopCount, 1)

        try controller.connect()
        try await eventually("reconnected state") { controller.status["state"] as? String == "ready" }
        XCTAssertEqual(server.requests("initialize").count, 2)
        XCTAssertEqual(controller.status["accountEmail"] as? String, "writer@example.com")
    }

    @MainActor
    func testManagedProfileDisconnectLogsOutWhenAccountHasNoEmail() async throws {
        let (root, controller, server) = try await fixture(ownsProfile: true, accountEmail: nil)
        defer { controller.stop(); try? FileManager.default.removeItem(at: root) }
        XCTAssertNil(controller.status["accountEmail"])

        try controller.disconnect()
        try await eventually("managed account logout") { server.requests("account/logout").count == 1 }
        XCTAssertEqual(controller.status["state"] as? String, "connecting")
        XCTAssertEqual(server.stopCount, 0)

        server.emitResponse(server.requests("account/logout")[0], result: [:])
        try await eventually("disconnected state") {
            controller.status["state"] as? String == "disconnected"
        }
        XCTAssertEqual(server.stopCount, 1)
    }

    @MainActor
    func testWindowStopNotifiesRetainedWebViewToEndAgentPresence() async throws {
        let (root, controller, server) = try await fixture()
        defer { controller.stop(); try? FileManager.default.removeItem(at: root) }
        try await start("task-window", threadID: "thread-window", turnID: "turn-window", controller: controller, server: server)
        var events: [[String: Any]] = []
        controller.onEvent = { events.append($0) }
        controller.stop()
        XCTAssertEqual(events.last?["type"] as? String, "status")
        XCTAssertEqual(events.last?["state"] as? String, "disconnected")
        XCTAssertNil(controller.activeTaskIdentifiers)
    }

    @MainActor
    func testExternalProfileDisconnectStopsOnlyTextTextSession() async throws {
        let (root, controller, server) = try await fixture()
        defer { controller.stop(); try? FileManager.default.removeItem(at: root) }

        try controller.disconnect()

        XCTAssertTrue(server.requests("account/logout").isEmpty)
        XCTAssertEqual(server.stopCount, 1)
        XCTAssertEqual(controller.status["state"] as? String, "disconnected")
        XCTAssertNil(controller.status["accountEmail"])
    }

    @MainActor
    func testInterruptAcknowledgementDoesNotReportTaskCompletion() async throws {
        let (root, controller, server) = try await fixture(cancellationTimeout: 1)
        defer { controller.stop(); try? FileManager.default.removeItem(at: root) }
        var events: [[String: Any]] = []
        controller.onEvent = { events.append($0) }

        try await start("task-interrupt", threadID: "thread-interrupt", turnID: "turn-interrupt",
            controller: controller, server: server)
        try controller.cancel(taskID: "task-interrupt")
        try await eventually("turn interrupt") { server.requests("turn/interrupt").count == 1 }
        server.emitResponse(server.requests("turn/interrupt")[0], result: [:])
        try await Task.sleep(for: .milliseconds(50))

        XCTAssertFalse(events.contains { $0["type"] as? String == "turn-cancelled" })
        XCTAssertEqual(controller.status["state"] as? String, "working")
        server.emitNotification("turn/completed", params: [
            "threadId": "thread-interrupt",
            "turn": ["id": "turn-interrupt", "status": "interrupted", "items": []],
        ])
        try await eventually("interrupted turn completion") { events.contains {
            $0["type"] as? String == "turn-cancelled" && $0["taskId"] as? String == "task-interrupt"
        } }
    }

    @MainActor
    func testAppServerInterruptedTurnEmitsCancellationWithoutLocalCancel() async throws {
        let (root, controller, server) = try await fixture()
        defer { controller.stop(); try? FileManager.default.removeItem(at: root) }
        var events: [[String: Any]] = []
        controller.onEvent = { events.append($0) }

        try await start("task-provider-interrupt", threadID: "thread-provider-interrupt",
            turnID: "turn-provider-interrupt", controller: controller, server: server)
        server.emitNotification("turn/completed", params: [
            "threadId": "thread-provider-interrupt",
            "turn": ["id": "turn-provider-interrupt", "status": "interrupted", "items": []],
        ])

        try await eventually("provider interruption") { events.contains {
            $0["type"] as? String == "turn-cancelled"
                && $0["taskId"] as? String == "task-provider-interrupt"
        } }
        XCTAssertFalse(events.contains { $0["type"] as? String == "turn-completed" })
        XCTAssertEqual(controller.status["state"] as? String, "ready")
    }

    @MainActor
    func testStaleTaskCannotResolveCurrentTemplateProposal() async throws {
        let (root, controller, server) = try await fixture()
        defer { controller.stop(); try? FileManager.default.removeItem(at: root) }
        _ = try LocalVaultAgentFiles.perform("create_file", arguments: [
            "title": "Designed", "body": "Original",
        ], root: root, access: .folder(path: ""))
        let file = try LocalVaultDocumentStore(root: root).read(path: "Designed.textpack")
        let template = try XCTUnwrap(file.contents.templateJSON)
        var proposalID: String?
        controller.onEvent = { event in
            if event["type"] as? String == "template-proposal" {
                proposalID = event["proposalId"] as? String
            }
        }

        try controller.send(taskID: "task-design", prompt: "Change the look",
            path: file.path, customizing: true)
        try await eventually { server.requests("thread/start").count == 1 }
        server.emitResponse(server.requests("thread/start")[0],
            result: ["thread": ["id": "thread-design"]])
        try await eventually { server.requests("turn/start").count == 1 }
        server.emitResponse(server.requests("turn/start")[0],
            result: ["turn": ["id": "turn-design"]])
        server.emitNotification("item/tool/call", params: [
            "threadId": "thread-design", "turnId": "turn-design", "namespace": "texttext",
            "tool": "propose_template", "arguments": [
                "path": file.path, "hash": file.hash, "templateJSON": template,
            ],
        ], id: AnyHashable(73))
        try await eventually { proposalID != nil }
        let proposal = try XCTUnwrap(proposalID)

        XCTAssertThrowsError(try controller.proposalResult(taskID: "task-stale",
            proposalID: proposal, valid: false))
        XCTAssertNoThrow(try controller.proposalResult(taskID: "task-design",
            proposalID: proposal, valid: false, message: "Try again"))
        let response = try XCTUnwrap(server.responses.first { $0.id == AnyHashable(73) })
        XCTAssertEqual(response.result["success"] as? Bool, false)
    }
}
