import XCTest
@testable import TextTextApp
@testable import TextTextWorkspaceCore

final class CodexEmbeddedRuntimeTests: XCTestCase {
    func testBundledSandboxRuntimeCannotHaveIndependentOrWidenedPermissions() {
        let inherited: [String: Any] = ["com.apple.security.app-sandbox": true, "com.apple.security.inherit": true]
        XCTAssertTrue(CodexEmbeddedRuntime.sandboxInheritanceIsValid(inherited))
        XCTAssertFalse(CodexEmbeddedRuntime.sandboxInheritanceIsValid(["com.apple.security.app-sandbox": true]))
        var widened = inherited
        widened["com.apple.security.network.server"] = true
        XCTAssertFalse(CodexEmbeddedRuntime.sandboxInheritanceIsValid(widened))
        widened = inherited
        widened["com.apple.security.cs.disable-library-validation"] = true
        XCTAssertFalse(CodexEmbeddedRuntime.sandboxInheritanceIsValid(widened))
    }

    func testDeviceAuthorizationOnlyAcceptsOfficialCredentialFreeVerificationPage() {
        let valid: [String: Any] = ["loginId": "opaque", "verificationUrl": "https://auth.openai.com/codex/device", "userCode": "ABCD-1234"]
        XCTAssertEqual(CodexEmbeddedRuntime.deviceAuthorization(valid)?.code, "ABCD-1234")
        for url in ["https://evil.test/codex/device", "http://auth.openai.com/codex/device", "https://auth.openai.com/codex/device?token=secret", "https://user:secret@auth.openai.com/codex/device"] {
            var candidate = valid
            candidate["verificationUrl"] = url
            XCTAssertNil(CodexEmbeddedRuntime.deviceAuthorization(candidate), url)
        }
    }

    func testHealthReceiptIsBoundToAccountWorkspaceRuntimeAndModel() {
        let key = CodexEmbeddedRuntime.verificationKey(origin: "https://texttext.test", workspace: "one", account: "writer@example.test", runtime: "1", model: "model-one")
        for tuple in [("two", "writer@example.test", "1", "model-one"), ("one", "other@example.test", "1", "model-one"), ("one", "writer@example.test", "2", "model-one"), ("one", "writer@example.test", "1", "model-two")] {
            XCTAssertNotEqual(key, CodexEmbeddedRuntime.verificationKey(origin: "https://texttext.test", workspace: tuple.0, account: tuple.1, runtime: tuple.2, model: tuple.3))
        }
        XCTAssertFalse(key.contains("writer@example.test"))
    }

    func testProviderFailuresDoNotEchoSensitiveUpstreamContent() {
        for raw in ["401 unauthorized Bearer private-token", "429 rate limit https://example.test/?token=private-token", "Model not available for account secret-user", "unknown provider payload private-document"] {
            let failure = CodexConnectionFailure(raw)
            XCTAssertFalse(failure.message.contains("private-token"))
            XCTAssertFalse(failure.message.contains("private-document"))
            XCTAssertFalse(failure.message.contains("secret-user"))
            XCTAssertFalse(failure.message.contains("https://"))
        }
        XCTAssertEqual(CodexConnectionFailure("401 unauthorized").recoveryAction, "connect")
        XCTAssertEqual(CodexConnectionFailure("billing quota exceeded").code, "quota")
        XCTAssertEqual(CodexConnectionFailure("Operation not permitted").code, "runtime")
    }

    func testAPIKeyAccountIsNeverPresentedAsChatGPTAccountConnection() {
        XCTAssertNil(CodexAccountSummary(result: ["account": ["type": "apiKey"]]))
        XCTAssertNil(CodexAccountSummary(result: ["account": ["type": "chatgptAuthTokens"]]))
        XCTAssertNotNil(CodexAccountSummary(result: ["account": ["type": "chatgpt", "email": "writer@example.test"]]))
    }
}
