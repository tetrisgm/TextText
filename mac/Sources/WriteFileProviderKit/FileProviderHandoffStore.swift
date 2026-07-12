import Foundation
import Security

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
        ]
    }

    /// Write (or replace) the handoff. Returns false if there is no access group
    /// or the keychain rejected the item.
    @discardableResult
    public static func save(_ handoff: FileProviderHandoff) -> Bool {
        guard let group = accessGroup(), let data = handoff.encoded() else { return false }
        let base = baseQuery(group)
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = data
        // Available in the background without an interactive unlock, which the
        // extension needs; still device-only (not synced to iCloud keychain).
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    /// Read the handoff, or nil if not signed in / not present.
    public static func load() -> FileProviderHandoff? {
        guard let group = accessGroup() else { return nil }
        var query = baseQuery(group)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else {
            return nil
        }
        return FileProviderHandoff.decode(data)
    }

    /// Remove the handoff (sign-out).
    public static func clear() {
        guard let group = accessGroup() else { return }
        SecItemDelete(baseQuery(group) as CFDictionary)
    }
}
