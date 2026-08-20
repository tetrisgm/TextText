import XCTest
@testable import TextTextWorkspaceCore

final class CodexAppServerTests: XCTestCase {
    func testParsesNotificationsWithoutExposingSecrets() throws {
        let message = try CodexAppServerMessage(data: Data(#"{"method":"account/rateLimits/updated","params":{"rateLimits":{"planType":"pro"}}}"#.utf8))
        XCTAssertEqual(message.method, "account/rateLimits/updated")
        XCTAssertNil(message.id)
        XCTAssertNil(message.errorMessage)
    }

    func testRejectsNonObjectMessages() {
        XCTAssertThrowsError(try CodexAppServerMessage(data: Data(#"["not-json-rpc"]"#.utf8))) { error in
            XCTAssertEqual(error as? CodexAppServerError, .invalidMessage)
        }
    }

    func testPreservesDynamicToolCallNameAndArguments() throws {
        let message = try CodexAppServerMessage(data: Data(#"{"id":0,"method":"item/tool/call","params":{"callId":"exec-1","tool":"qa_echo","arguments":{"text":"hello"}}}"#.utf8))
        XCTAssertEqual(message.method, "item/tool/call")
        XCTAssertEqual(message.jsonRPCID, AnyHashable(0))
        XCTAssertNotEqual(message.jsonRPCID, AnyHashable("0"))
        XCTAssertEqual(message.rawParams?["tool"] as? String, "qa_echo")
        XCTAssertEqual((message.rawParams?["arguments"] as? [String: Any])?["text"] as? String, "hello")
    }

    func testRuntimeLocatorFindsOnlyExecutableCandidates() throws {
        let temporary = FileManager.default.temporaryDirectory
            .appendingPathComponent("texttext-codex-runtime-(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporary) }

        let helper = temporary.appendingPathComponent("Contents/Helpers/codex")
        try FileManager.default.createDirectory(at: helper.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("#!/bin/sh\n".utf8).write(to: helper)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: helper.path)

        let locator = CodexRuntimeLocator(bundleURL: temporary)
        XCTAssertEqual(locator.executableURL, helper)
    }

    func testThreadStartUsesTheCurrentReadOnlySandboxField() {
        let params = CodexAppServerRequests.threadStart(
            dynamicTools: [],
            disabledMCPServers: [],
            workingDirectory: "/tmp/texttext-agent")

        XCTAssertEqual(params["sandbox"] as? String, "read-only")
        XCTAssertNil(params["sandboxPolicy"])
        XCTAssertEqual(params["approvalPolicy"] as? String, "never")
        XCTAssertEqual(params["ephemeral"] as? Bool, true)
        XCTAssertEqual(params["cwd"] as? String, "/tmp/texttext-agent")
        let instructions = params["developerInstructions"] as? String
        XCTAssertTrue(instructions?.contains("Use only the dynamic tools") == true)
        XCTAssertTrue(instructions?.contains("Never use installed skills") == true)
        XCTAssertTrue(instructions?.contains("Do not retry through another integration") == true)
        XCTAssertTrue(instructions?.contains("never call search or read_item") == true)
        XCTAssertTrue(instructions?.contains("Make at most four dynamic tool calls") == true)
    }

    func testTurnInterruptUsesExactThreadAndTurn() {
        let params = CodexAppServerRequests.turnInterrupt(
            threadID: "thread-1", turnID: "turn-2")

        XCTAssertEqual(params["threadId"] as? String, "thread-1")
        XCTAssertEqual(params["turnId"] as? String, "turn-2")
    }

    func testThreadStartDisablesEveryEffectiveMCPWithoutCopyingConfiguration() throws {
        let configReadResult: [String: Any] = [
            "config": [
                "mcp_servers": [
                    "texttext": ["url": "https://example.invalid", "bearer_token": "secret"],
                    "computer-use": ["command": "/private/tool"],
                ],
            ],
        ]
        let serverNames = CodexAppServerRequests.effectiveMCPServerNames(
            configReadResult: configReadResult)
        let params = CodexAppServerRequests.threadStart(
            dynamicTools: [], disabledMCPServers: try XCTUnwrap(serverNames))
        let config = params["config"] as? [String: Any]
        let servers = config?["mcp_servers"] as? [String: [String: Bool]]

        XCTAssertEqual(serverNames, ["computer-use", "texttext"])
        XCTAssertEqual(servers?["computer-use"]?["enabled"], false)
        XCTAssertEqual(servers?["texttext"]?["enabled"], false)
        XCTAssertNil(servers?["texttext"]?["bearer_token"])
        XCTAssertNil(servers?["texttext"]?["url"])
    }

    func testMissingMCPConfigurationFailsClosed() {
        XCTAssertNil(CodexAppServerRequests.effectiveMCPServerNames(
            configReadResult: ["config": [:]]))
        XCTAssertNil(CodexAppServerRequests.effectiveMCPServerNames(
            configReadResult: nil))
    }

    func testThreadStartDeduplicatesMCPServerNames() {
        let params = CodexAppServerRequests.threadStart(
            dynamicTools: [], disabledMCPServers: ["texttext", "texttext"])
        let config = params["config"] as? [String: Any]
        let servers = config?["mcp_servers"] as? [String: [String: Bool]]

        XCTAssertEqual(servers?.count, 1)
        XCTAssertEqual(servers?["texttext"]?["enabled"], false)
    }

    func testSignedOutAccountIsNotParsedAsConnected() throws {
        let signedOut = try CodexAppServerMessage(
            data: Data(#"{"id":"account","result":{"account":null,"requiresOpenaiAuth":true}}"#.utf8))
        XCTAssertNil(CodexAccountSummary(result: signedOut.rawResult))

        let signedIn = try CodexAppServerMessage(
            data: Data(#"{"id":"account","result":{"account":{"type":"chatgpt","email":"writer@example.com","planType":"pro"},"requiresOpenaiAuth":true}}"#.utf8))
        XCTAssertEqual(
            CodexAccountSummary(result: signedIn.rawResult),
            CodexAccountSummary(email: "writer@example.com", planType: "pro"))
    }

    func testDynamicToolResponseCarriesRequiredSuccessFlag() {
        let success = CodexAppServerRequests.dynamicToolResult(text: "ok", success: true)
        let failure = CodexAppServerRequests.dynamicToolResult(text: "no", success: false)

        XCTAssertEqual(success["success"] as? Bool, true)
        XCTAssertEqual(failure["success"] as? Bool, false)
        XCTAssertEqual(
            ((success["contentItems"] as? [[String: Any]])?.first)?["type"] as? String,
            "inputText")
    }

    func testDynamicToolResponsePreservesNumericJSONRPCID() throws {
        let envelope = CodexAppServerRequests.responseEnvelope(
            id: try XCTUnwrap(CodexAppServerMessage(
                data: Data(#"{"id":0,"method":"item/tool/call","params":{}}"#.utf8)
            ).jsonRPCID),
            result: CodexAppServerRequests.dynamicToolResult(text: "ok", success: true))
        let encoded = try JSONSerialization.data(withJSONObject: envelope)
        let decoded = try XCTUnwrap(
            JSONSerialization.jsonObject(with: encoded) as? [String: Any])

        XCTAssertEqual(decoded["id"] as? Int, 0)
        XCTAssertNil(decoded["id"] as? String)
    }

    func testTurnCompletionDoesNotTreatFailuresAsSuccess() throws {
        let completed = try CodexAppServerMessage(
            data: Data(#"{"method":"turn/completed","params":{"threadId":"thread-1","turn":{"id":"turn-1","items":[],"status":"completed"}}}"#.utf8))
        let failed = try CodexAppServerMessage(
            data: Data(#"{"method":"turn/completed","params":{"threadId":"thread-1","turn":{"id":"turn-1","items":[],"status":"failed","error":{"message":"provider unavailable"}}}}"#.utf8))

        XCTAssertEqual(CodexTurnOutcome(params: completed.rawParams), .completed)
        XCTAssertEqual(CodexTurnOutcome(params: failed.rawParams), .failed("provider unavailable"))
    }

    func testAgentMessagesKeepCommentarySeparateFromFinalAnswers() throws {
        let commentary = try CodexAppServerMessage(data: Data(#"{"method":"item/started","params":{"threadId":"thread-1","turnId":"turn-1","item":{"id":"item-1","type":"agentMessage","text":"I am checking the workspace.","phase":"commentary"}}}"#.utf8))
        let final = try CodexAppServerMessage(data: Data(#"{"method":"item/completed","params":{"threadId":"thread-1","turnId":"turn-1","item":{"id":"item-2","type":"agentMessage","text":"Recent work centers on native AI reliability.","phase":"final_answer"}}}"#.utf8))

        XCTAssertEqual(
            CodexAgentMessage(params: commentary.rawParams),
            CodexAgentMessage(
                id: "item-1", phase: .commentary,
                text: "I am checking the workspace."))
        XCTAssertEqual(
            CodexAgentMessage(params: final.rawParams),
            CodexAgentMessage(
                id: "item-2", phase: .finalAnswer,
                text: "Recent work centers on native AI reliability."))
    }
}
