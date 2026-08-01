import Foundation

/// One workspace the app has handed off to the File Provider extension: its
/// display name, handle, product origin, and workspace-scoped `wsk_` bearer.
public struct FileProviderWorkspace: Codable, Equatable, Sendable {
    /// The workspace's display name (blog.name), shown as its folder in Finder.
    public var name: String
    /// The workspace handle; folder/file identifiers are scoped by it.
    public var handle: String
    /// Product origin, e.g. https://TextText.app (LiveTextTextSyncAPI trims any
    /// trailing slash).
    public var origin: String
    /// The workspace-scoped `wsk_` bearer token.
    public var token: String

    public init(name: String, handle: String, origin: String, token: String) {
        self.name = name
        self.handle = handle
        self.origin = origin
        self.token = token
    }
}

/// The credential handoff the container app writes and the File Provider
/// extension reads, defined once so both sides agree on the shape. It carries a
/// LIST of workspaces (one "TextText" domain now spans every workspace the user has
/// joined); today the app holds one credential, so the list has one element, but
/// the extension already fans out per handle. Stored in a shared keychain access
/// group (see FileProviderHandoffStore).
public struct FileProviderHandoff: Codable, Equatable, Sendable {
    public var version: Int
    public var workspaces: [FileProviderWorkspace]

    public init(version: Int = 1, workspaces: [FileProviderWorkspace]) {
        self.version = version
        self.workspaces = workspaces
    }

    /// Convenience for the single-workspace app today.
    public init(origin: String, token: String, handle: String, name: String = "") {
        self.version = 1
        self.workspaces = [FileProviderWorkspace(
            name: name.isEmpty ? handle : name, handle: handle, origin: origin, token: token)]
    }

    /// The descriptor for a handle, or nil if that workspace was not handed off.
    public func descriptor(for handle: String) -> FileProviderWorkspace? {
        workspaces.first { $0.handle == handle }
    }

    /// The container-relative filename both sides once agreed on (retained for
    /// compatibility; the handoff now lives in the keychain, not a file).
    public static let filename = "fileprovider-credentials.json"

    private enum CodingKeys: String, CodingKey {
        case version, workspaces
        case origin, token, handle, name // legacy flat shape
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        if let list = try c.decodeIfPresent([FileProviderWorkspace].self, forKey: .workspaces) {
            self.version = (try? c.decode(Int.self, forKey: .version)) ?? 1
            self.workspaces = list
        } else {
            // An older app wrote a single flat {origin, token, handle}. Wrap it
            // so a new extension reading it before the app republishes still
            // authenticates instead of failing.
            let origin = try c.decode(String.self, forKey: .origin)
            let token = try c.decode(String.self, forKey: .token)
            let handle = try c.decode(String.self, forKey: .handle)
            let name = (try? c.decode(String.self, forKey: .name)) ?? handle
            self.version = 1
            self.workspaces = [FileProviderWorkspace(
                name: name.isEmpty ? handle : name, handle: handle, origin: origin, token: token)]
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(version, forKey: .version)
        try c.encode(workspaces, forKey: .workspaces)
    }

    public func encoded() -> Data? {
        try? JSONEncoder().encode(self)
    }

    public static func decode(_ data: Data) -> FileProviderHandoff? {
        try? JSONDecoder().decode(FileProviderHandoff.self, from: data)
    }
}
