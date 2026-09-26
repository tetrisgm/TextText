import Foundation
import Security
import CryptoKit

/// Store builds may launch only a declared, signed helper inside their own
/// bundle. External runtime discovery stays compiled out of that edition.
enum CodexEmbeddedRuntime {
    static func bundledExecutable(in bundle: Bundle = .main, sandboxed: Bool) -> URL? {
        guard bundle.object(forInfoDictionaryKey: "TextTextEmbeddedAgentRuntime") as? Bool == true else { return nil }
        let candidate = bundle.bundleURL.resolvingSymlinksInPath().appendingPathComponent("Contents/Helpers/codex")
        guard FileManager.default.isExecutableFile(atPath: candidate.path),
              candidate.resolvingSymlinksInPath().path == candidate.standardizedFileURL.path else { return nil }
        var code: SecStaticCode?
        guard SecStaticCodeCreateWithPath(candidate as CFURL, [], &code) == errSecSuccess,
              let code,
              SecStaticCodeCheckValidity(code, [], nil) == errSecSuccess else { return nil }
        if sandboxed {
            var information: CFDictionary?
            guard SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &information) == errSecSuccess,
                  let values = information as? [String: Any],
                  let entitlements = values[kSecCodeInfoEntitlementsDict as String] as? [String: Any],
                  sandboxInheritanceIsValid(entitlements) else { return nil }
        }
        return candidate
    }

    static func sandboxInheritanceIsValid(_ entitlements: [String: Any]) -> Bool {
        let keys = Set(entitlements.keys.filter { $0.hasPrefix("com.apple.security.") })
        return keys == ["com.apple.security.app-sandbox", "com.apple.security.inherit"] &&
            entitlements["com.apple.security.app-sandbox"] as? Bool == true &&
            entitlements["com.apple.security.inherit"] as? Bool == true
    }

    static func profileDirectory() throws -> URL {
        let directory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/TextText/Agent/Codex", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700])
        return directory
    }

    static func verificationKey(origin: String, workspace: String, account: String, runtime: String, model: String) -> String {
        let value = [origin, workspace, account, runtime, model].joined(separator: "\n")
        let hash = SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
        return "TextTextAgentVerified." + hash
    }

    static func deviceAuthorization(_ result: [String: Any]?) -> (loginID: String, url: String, code: String)? {
        guard let result,
              let loginID = result["loginId"] as? String, !loginID.isEmpty,
              let rawURL = result["verificationUrl"] as? String,
              let url = URL(string: rawURL), url.scheme == "https", url.host == "auth.openai.com",
              url.path == "/codex/device", url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil,
              let code = result["userCode"] as? String,
              code.range(of: "^[A-Z0-9-]{4,32}$", options: .regularExpression) != nil else { return nil }
        return (loginID, url.absoluteString, code)
    }
}

/// Raw runtime errors may contain URLs or provider payloads. Only this bounded
/// classification crosses the native/UI boundary or enters diagnostic logs.
struct CodexConnectionFailure {
    let code: String
    let message: String
    let recoveryAction: String

    init(_ raw: String) {
        let evidence = raw.lowercased()
        if evidence.contains("401") || evidence.contains("unauthorized") || evidence.contains("authentication") || evidence.contains("expired token") || evidence.contains("not logged in") || evidence.contains("missing bearer") {
            code = "authentication"; message = "Your agent sign-in was rejected or expired. Reconnect to continue."; recoveryAction = "connect"
        } else if evidence.contains("quota") || evidence.contains("billing") || evidence.contains("usage limit") || evidence.contains("insufficient") {
            code = "quota"; message = "Your agent account has reached its usage or billing limit. Check your account before retrying."; recoveryAction = "wait"
        } else if evidence.contains("429") || evidence.contains("rate limit") {
            code = "rate-limit"; message = "Your agent is receiving too many requests. Wait briefly, then retry."; recoveryAction = "wait"
        } else if evidence.contains("model") && (evidence.contains("not found") || evidence.contains("not supported") || evidence.contains("not available") || evidence.contains("access") || evidence.contains("does not exist")) {
            code = "model-access"; message = "Your agent account cannot use the selected model. Check its model access, then reconnect."; recoveryAction = "connect"
        } else if evidence.contains("timed out") || evidence.contains("timeout") || evidence.contains("connection") || evidence.contains("network") {
            code = "connection"; message = "The agent connection was interrupted. Your request is preserved; retry when the connection returns."; recoveryAction = "retry"
        } else if evidence.contains("operation not permitted") || evidence.contains("executable") || evidence.contains("process") || evidence.contains("runtime") || evidence.contains("notrunning") {
            code = "runtime"; message = "The agent runtime could not start in this app. Check the app's agent support."; recoveryAction = "retry"
        } else {
            code = "unknown"; message = "The agent failed for an unknown reason. Your request is preserved; use the diagnostic reference if it happens again."; recoveryAction = "retry"
        }
    }
}
