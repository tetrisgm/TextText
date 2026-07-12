import Foundation
import Security
import os.log

private let handoffLog = Logger(subsystem: "net.writeapp.write", category: "fileprovider-handoff")

/// Stores the File Provider credential handoff in a shared keychain access group
/// so the non-sandboxed app can write it and the sandboxed extension can read it.
///
/// The app-group CONTAINER cannot serve this: a non-sandboxed app is blocked from
/// writing a Group Container even with the app-group entitlement (the write is
/// sandbox-gated, EPERM). The keychain is not sandbox-gated, so a shared keychain
/// access group is the reliable bridge. Both the app and the extension carry the
/// same `keychain-access-groups` entitlement; the access group value
/// (`<TeamID>.net.writeapp.write.fp`) is stamped into each bundle's Info.plist at
/// build time as `WriteKeychainAccessGroup`.
public enum FileProviderHandoffStore {
    private static let service = "net.writeapp.write.fileprovider"
    private static let account = "handoff"

    /// The shared keychain access group. An env override supports headless tests.
    public static func accessGroup() -> String? {
        if let env = ProcessInfo.processInfo.environment["WRITE_KEYCHAIN_GROUP"],
           !env.isEmpty {
            return env
        }
        guard let group = Bundle.main
            .object(forInfoDictionaryKey: "WriteKeychainAccessGroup") as? String,
              !group.isEmpty, group != "WRITE_KEYCHAIN_GROUP" else {
            return nil
        }
        return group
    }

    private static func baseQuery(_ group: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: group,
            // The data-protection keychain (iOS-style) shares items across apps
            // in the access group WITHOUT per-app ACL prompts. The default macOS
            // file-based keychain uses SecACLs that prompt other apps, which a
            // File Provider extension cannot answer, so it must be forced on.
            kSecUseDataProtectionKeychain as String: true,
        ]
    }

    /// Write (or replace) the handoff. Returns false if there is no access group
    /// or the keychain rejected the item.
    @discardableResult
    public static func save(_ handoff: FileProviderHandoff) -> Bool {
        guard let group = accessGroup(), let data = handoff.encoded() else {
            handoffLog.error("save: no access group or encode failed")
            return false
        }
        let base = baseQuery(group)
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = data
        // Available in the background without an interactive unlock, which the
        // extension needs; still device-only (not synced to iCloud keychain).
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(add as CFDictionary, nil)
        handoffLog.log("save: group=\(group, privacy: .public) status=\(status, privacy: .public) handle=\(handoff.handle, privacy: .public)")
        return status == errSecSuccess
    }

    /// Read the handoff, or nil if not signed in / not present.
    public static func load() -> FileProviderHandoff? {
        guard let group = accessGroup() else {
            handoffLog.error("load: no access group")
            return nil
        }
        var query = baseQuery(group)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        guard status == errSecSuccess, let data = out as? Data else {
            handoffLog.log("load: group=\(group, privacy: .public) status=\(status, privacy: .public) -> not signed in")
            return nil
        }
        let handoff = FileProviderHandoff.decode(data)
        handoffLog.log("load: ok handle=\(handoff?.handle ?? "?", privacy: .public)")
        return handoff
    }

    /// Remove the handoff (sign-out).
    public static func clear() {
        guard let group = accessGroup() else { return }
        SecItemDelete(baseQuery(group) as CFDictionary)
    }
}
