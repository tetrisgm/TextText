import Foundation
import Darwin
import TextTextWorkspaceCore
import TextTextFileProviderKit

@_silgen_name("flock")
private func creationFlock(_ descriptor: Int32, _ operation: Int32) -> Int32

/// A creation intent is durable before its complete TextPack becomes visible.
/// Consumed staging plus a missing identity is ambiguous: never recreate it.
/// flock serializes local processes; it is not a distributed iCloud lock.
extension DocumentStore {
    private struct CreationIntent: Codable {
        let version: Int
        let fingerprint: String
        let itemId: String
        let destination: String
    }

    func createWithRetryKey(
        title: String, body: String?, folder: String?, kind: String?,
        sourceURL: String? = nil, key: String
    ) throws -> URL {
        guard !key.isEmpty, key.utf8.count <= 512 else {
            throw TextTextCLIError.invalidDocument("creation retry key must contain 1 to 512 bytes")
        }
        let fm = FileManager.default
        let journal = root.appendingPathComponent(".texttext/cli-creations", isDirectory: true)
        let canonicalRoot = root.resolvingSymlinksInPath().standardizedFileURL.path + "/"
        guard journal.resolvingSymlinksInPath().path.hasPrefix(canonicalRoot) else {
            throw TextTextCLIError.invalidDocument("creation journal is outside the workspace")
        }
        try fm.createDirectory(at: journal, withIntermediateDirectories: true)
        try synchronizeCreationDirectory(root)
        try synchronizeCreationDirectory(journal.deletingLastPathComponent())
        let digest = TextTextStableDigest.sha256Hex(Data(key.utf8))
        let lock = journal.appendingPathComponent(digest + ".lock")
        let fd = Darwin.open(lock.path, O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW, S_IRUSR | S_IWUSR)
        guard fd >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        defer { Darwin.close(fd) }
        guard creationFlock(fd, LOCK_EX) == 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
        defer { creationFlock(fd, LOCK_UN) }
        let payload: [String: Any] = ["title": title, "body": body.map { $0 as Any } ?? NSNull(),
                                    "folder": folder.map { $0 as Any } ?? NSNull(),
                                    "kind": kind.map { $0 as Any } ?? NSNull(),
                                    "sourceURL": sourceURL.map { $0 as Any } ?? NSNull()]
        let fingerprint = TextTextStableDigest.sha256Hex(
            try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]))
        let record = journal.appendingPathComponent(digest + ".json")
        let stage: URL
        let intent: CreationIntent
        if fm.fileExists(atPath: record.path) {
            let values = try record.resourceValues(forKeys: [.isSymbolicLinkKey, .fileSizeKey])
            guard values.isSymbolicLink != true, (values.fileSize ?? Int.max) <= 16_384 else {
                throw TextTextCLIError.invalidDocument("invalid creation journal")
            }
            intent = try JSONDecoder().decode(CreationIntent.self, from: Data(contentsOf: record))
            guard intent.version == 1, UUID(uuidString: intent.itemId) != nil,
                  intent.fingerprint == fingerprint else {
                throw TextTextCLIError.invalidDocument("creation retry key already belongs to a different request")
            }
            stage = journal.appendingPathComponent(intent.itemId + ".textpack")
        } else {
            // A preparation interrupted before the intent is retained as an
            // unpublished orphan. A new attempt never overwrites it.
            let id = UUID().uuidString.lowercased()
            stage = journal.appendingPathComponent(id + ".textpack")
            let target = try prepareCreation(title: title, body: body, folder: folder,
                                            kind: kind, sourceURL: sourceURL,
                                            itemId: id, preparedOutput: stage)
            intent = CreationIntent(version: 1, fingerprint: fingerprint, itemId: id,
                                    destination: relativePath(of: target))
            try JSONEncoder().encode(intent).write(to: record, options: [.withoutOverwriting])
            let handle = try FileHandle(forWritingTo: record)
            try handle.synchronize(); try handle.close()
            try synchronizeCreationDirectory(journal)
        }
        // Also flush an intent left by an earlier process before publication.
        let recordHandle = try FileHandle(forWritingTo: record)
        try recordHandle.synchronize(); try recordHandle.close()
        try synchronizeCreationDirectory(journal)
        let paths = try list(limit: 5_001)
        guard paths.count < 5_001 else {
            throw TextTextCLIError.invalidDocument("workspace exceeds the bounded creation identity scan")
        }
        var matches: [URL] = []
        for path in paths {
            let url = try resolve(path)
            if MarkdownIdentityCodec.extract(from: try readMarkdown(at: url))?.itemId == intent.itemId {
                matches.append(url)
            }
        }
        guard matches.count <= 1 else {
            throw TextTextCLIError.invalidDocument("creation identity appears in multiple files")
        }
        if let existing = matches.first { return existing }
        guard fm.fileExists(atPath: stage.path) else {
            throw TextTextCLIError.invalidDocument("the previously created file is unavailable; no replacement was created")
        }
        guard try stage.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true,
              MarkdownIdentityCodec.extract(from: try readMarkdown(at: stage))?.itemId == intent.itemId else {
            throw TextTextCLIError.invalidDocument("invalid prepared creation package")
        }
        let target = root.appendingPathComponent(intent.destination).standardizedFileURL
        guard !intent.destination.hasPrefix("/"), target.resolvingSymlinksInPath().path.hasPrefix(canonicalRoot),
              target.pathExtension == "textpack" else {
            throw TextTextCLIError.invalidDocument("invalid creation destination")
        }
        var error: NSError?
        var result: Result<Void, Error>?
        NSFileCoordinator().coordinate(writingItemAt: target, options: [], error: &error) { coordinated in
            result = Result {
                guard coordinated.standardizedFileURL == target,
                      coordinated.resolvingSymlinksInPath().path.hasPrefix(canonicalRoot) else {
                    throw TextTextCLIError.invalidDocument("creation destination changed")
                }
                try fm.moveItem(at: stage, to: coordinated)
                try synchronizeCreationDirectory(coordinated.deletingLastPathComponent())
                try synchronizeCreationDirectory(journal)
            }
        }
        if let error { throw error }
        guard let result else { throw CocoaError(.fileWriteUnknown) }
        try result.get()
        return target
    }
}
