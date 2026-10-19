import Foundation
import CoreFoundation
import TextTextWorkspaceCore

/// A file-incarnation fact, not a credential or a permission grant. Unknown is
/// deliberately different from authenticated absence of a restore marker.
public enum LocalVaultGeneration: Codable, Equatable, Sendable {
    case unknown, observedAbsent, present(String)
    private struct Key: CodingKey {
        let stringValue: String; var intValue: Int? { nil }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }
    public init(from decoder: Decoder) throws {
        let fields = try decoder.container(keyedBy: Key.self)
        let kind = try fields.decode(String.self, forKey: Key(stringValue: "kind")!)
        let names = Set(fields.allKeys.map(\.stringValue))
        switch kind {
        case "unknown": guard names == ["kind"] else { throw LocalVaultSyncFailure.invalidResponse }; self = .unknown
        case "observed-absent": guard names == ["kind"] else { throw LocalVaultSyncFailure.invalidResponse }; self = .observedAbsent
        case "present":
            guard names == ["kind", "generation"] else { throw LocalVaultSyncFailure.invalidResponse }
            let generation = try fields.decode(String.self, forKey: Key(stringValue: "generation")!)
            guard Self.valid(generation) else { throw LocalVaultSyncFailure.invalidResponse }
            self = .present(generation)
        default: throw LocalVaultSyncFailure.invalidResponse
        }
    }
    public func encode(to encoder: Encoder) throws {
        var fields = encoder.container(keyedBy: Key.self)
        switch self {
        case .unknown: try fields.encode("unknown", forKey: Key(stringValue: "kind")!)
        case .observedAbsent: try fields.encode("observed-absent", forKey: Key(stringValue: "kind")!)
        case .present(let generation):
            guard Self.valid(generation) else { throw LocalVaultSyncFailure.invalidResponse }
            try fields.encode("present", forKey: Key(stringValue: "kind")!)
            try fields.encode(generation, forKey: Key(stringValue: "generation")!)
        }
    }
    static func valid(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 512 && !value.unicodeScalars.contains { $0.value < 32 || $0.value == 127 }
    }
    public var known: Bool { self != .unknown }
    public func matches(_ other: Self) -> Bool { known && other.known && self == other }
    public var lifecycle: String? { if case .present(let value) = self { return value }; return nil }
}

/// Returned only by the authenticated complete-manifest transport seam. A
/// persisted copy still requires fresh transport and native incorporation
/// checks before it can authorize a saved file move.
public struct LocalVaultManifestGenerationEvidence: Equatable, Sendable {
    public let scope: LocalVaultProtectedRenameScope
    public let item: LocalVaultRemoteItem
    public let manifestHash: String
    public let generation: LocalVaultGeneration
    public init(scope: LocalVaultProtectedRenameScope, item: LocalVaultRemoteItem, manifestHash: String, generation: LocalVaultGeneration) {
        self.scope = scope; self.item = item; self.manifestHash = manifestHash; self.generation = generation
    }
}

enum LocalVaultGenerationManifest {
    static func parse(_ bytes: Data, itemId: String, scope: LocalVaultProtectedRenameScope) throws -> LocalVaultManifestGenerationEvidence? {
        guard bytes.count <= 16 * 1024 * 1024, let accountId = scope.accountId,
              let origin = URL(string: scope.origin),
              try PortableWorkspaceBinding.normalized(.init(origin: origin, workspaceId: scope.workspaceId)).origin.absoluteString == scope.origin else { throw LocalVaultSyncFailure.invalidResponse }
        _ = try LocalVaultAccountIdentity.validate(accountId)
        // The existing bounded scanner rejects duplicate and escaped-duplicate
        // keys before Foundation's keyed decoding can erase them.
        try LocalVaultSharedRename.validateStateBytes(bytes)
        guard let root = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              Set(root.keys).isSubset(of: ["items", "tombstones", "folders", "problems", "revision", "fullAccess", "canCreateContent", "writableFolders", "manifestRevision", "syncCapabilities"]),
              let items = root["items"] as? [[String: Any]], let tombstones = root["tombstones"] as? [[String: Any]],
              items.count + tombstones.count <= 40_000,
              let problems = root["problems"] as? [Any], let folders = root["folders"] as? [String],
              root["writableFolders"] is [String], let revision = root["revision"] as? String,
              digest(revision), !folders.contains(where: { $0.isEmpty }) else { throw LocalVaultSyncFailure.invalidResponse }
        func boolean(_ value: Any?) -> Bool? {
            guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
            return number.boolValue
        }
        guard let full = boolean(root["fullAccess"]), let create = boolean(root["canCreateContent"]) else { throw LocalVaultSyncFailure.invalidResponse }
        guard full, create, problems.isEmpty else { return nil }
        var identities = Set<String>()
        for entry in items + tombstones {
            guard let id = entry["itemId"] as? String,
                  id.range(of: "^[A-Za-z0-9][A-Za-z0-9_-]{0,127}\\z", options: .regularExpression) != nil,
                  identities.insert(id).inserted else { throw LocalVaultSyncFailure.invalidResponse }
        }
        var livePaths = Set<String>()
        for entry in items {
            guard let path = entry["relativePath"] as? String, safePath(path),
                  livePaths.insert(path.precomposedStringWithCanonicalMapping.lowercased()).inserted,
                  !entry.keys.contains("deleted") || boolean(entry["deleted"]) == false else { throw LocalVaultSyncFailure.invalidResponse }
        }
        guard let selected = items.first(where: { $0["itemId"] as? String == itemId }) else { return nil }
        guard Set(selected.keys).isSubset(of: ["itemId", "relativePath", "revision", "canEditContent", "lifecycle", "restoreFromRevision", "deleted"]),
              boolean(selected["canEditContent"]) == true,
              let path = selected["relativePath"] as? String, safePath(path),
              let packRevision = selected["revision"] as? String, digest(packRevision) else { throw LocalVaultSyncFailure.invalidResponse }
        let generation: LocalVaultGeneration
        if selected.keys.contains("lifecycle") || selected.keys.contains("restoreFromRevision") {
            guard let value = selected["lifecycle"] as? String, LocalVaultGeneration.valid(value),
                  let restore = selected["restoreFromRevision"] as? String, digest(restore) else { throw LocalVaultSyncFailure.invalidResponse }
            generation = .present(value)
        } else { generation = .observedAbsent }
        let item = try JSONDecoder().decode(LocalVaultRemoteItem.self, from: JSONSerialization.data(withJSONObject: selected))
        return .init(scope: scope, item: item, manifestHash: TextTextStableDigest.sha256Hex(bytes), generation: generation)
    }
    static func digest(_ value: String) -> Bool { value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }
    static func safePath(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 1024 && value.lowercased().hasSuffix(".textpack") &&
        !value.contains("\\") && !value.contains(":") && !value.unicodeScalars.contains { $0.value < 32 || $0.value == 127 } &&
        value.split(separator: "/", omittingEmptySubsequences: false).allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }
}
