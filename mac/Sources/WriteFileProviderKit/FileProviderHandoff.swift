import Foundation

/// The credential handoff the container app writes and the File Provider
/// extension reads, defined once so both sides agree on the shape and the
/// filename. It carries nothing the app does not already hold: `token` is the
/// same workspace-scoped `wsk_` bearer the native sync engine uses. It lives at
/// the root of the shared app-group container (a sibling of the Share `Inbox/`),
/// written 0600 by the non-sandboxed app and read by the sandboxed appex.
public struct FileProviderHandoff: Codable, Equatable, Sendable {
    /// Product origin, e.g. https://write.ramine.net (LiveWriteSyncAPI trims any
    /// trailing slash).
    public var origin: String
    /// The workspace-scoped `wsk_` bearer token.
    public var token: String
    /// The workspace handle; the File Provider domain identity is derived from it.
    public var handle: String

    public init(origin: String, token: String, handle: String) {
        self.origin = origin
        self.token = token
        self.handle = handle
    }

    /// The container-relative filename both sides agree on.
    public static let filename = "fileprovider-credentials.json"

    public func encoded() -> Data? {
        try? JSONEncoder().encode(self)
    }

    public static func decode(_ data: Data) -> FileProviderHandoff? {
        try? JSONDecoder().decode(FileProviderHandoff.self, from: data)
    }
}
