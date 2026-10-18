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
        let preparedHash: String?
    }

    public func createWithRetryKey(
        title: String, body: String?, folder: String?, kind: String?,
        sourceURL: String? = nil, key: String,
        customDocumentJSON: String? = nil, customTemplateJSON: String? = nil,
        assets: [TextTextTextBundlePackage.MaterializedAsset] = []
    ) throws -> URL {
        guard !key.isEmpty, key.utf8.count <= 512 else {
            throw TextTextCLIError.invalidDocument("creation retry key must contain 1 to 512 bytes")
        }
        let fm = FileManager.default
        let state = LocalVaultDeviceState.directory(root: root)
        let journal = state.appendingPathComponent("cli-creations", isDirectory: true)
        let canonicalRoot = root.resolvingSymlinksInPath().standardizedFileURL.path + "/"
        guard journal.resolvingSymlinksInPath().path == journal.standardizedFileURL.path else {
            throw TextTextCLIError.invalidDocument("invalid private creation journal")
        }
        let privateJournal = !journal.path.hasPrefix(canonicalRoot)
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
        var payload: [String: Any] = ["title": title, "body": body.map { $0 as Any } ?? NSNull(),
                                    "folder": folder.map { $0 as Any } ?? NSNull(),
                                    "kind": kind.map { $0 as Any } ?? NSNull(),
                                    "sourceURL": sourceURL.map { $0 as Any } ?? NSNull()]
        if customDocumentJSON != nil || customTemplateJSON != nil {
            payload["documentJSON"] = customDocumentJSON.map { $0 as Any } ?? NSNull()
            payload["templateJSON"] = customTemplateJSON.map { $0 as Any } ?? NSNull()
        }
        // Keep existing text-only intents compatible. Attachments bind the key
        // to their names, types and bytes without writing bytes into the intent.
        if !assets.isEmpty {
            payload["assets"] = assets.sorted { $0.filename < $1.filename }.map {
                ["filename": $0.filename, "sha256": TextTextStableDigest.sha256Hex($0.data),
                 "remoteURL": $0.remoteURL, "contentType": $0.contentType.map { $0 as Any } ?? NSNull(),
                 "title": $0.title.map { $0 as Any } ?? NSNull()] as [String: Any]
            }
        }
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
            let recordBytes = try Data(contentsOf: record)
            guard let fields = try JSONSerialization.jsonObject(with: recordBytes) as? [String: Any],
                  Set(fields.keys).isSubset(of: Set(["version", "fingerprint", "itemId", "destination", "preparedHash"])) else {
                throw TextTextCLIError.invalidDocument("unknown creation journal format")
            }
            intent = try JSONDecoder().decode(CreationIntent.self, from: recordBytes)
            guard (privateJournal ? intent.version == 3 : [1, 2].contains(intent.version)), UUID(uuidString: intent.itemId) != nil,
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
                                            itemId: id, preparedOutput: stage,
                                            customDocumentJSON: customDocumentJSON, customTemplateJSON: customTemplateJSON,
                                            assets: assets)
            intent = CreationIntent(version: privateJournal ? 3 : 2, fingerprint: fingerprint, itemId: id,
                                    destination: relativePath(of: target),
                                    preparedHash: TextTextStableDigest.sha256Hex(try Data(contentsOf: stage)))
            try JSONEncoder().encode(intent).write(to: record, options: [.withoutOverwriting])
            let handle = try FileHandle(forWritingTo: record)
            try handle.synchronize(); try handle.close()
            try synchronizeCreationDirectory(journal)
        }
        // Also flush an intent left by an earlier process before publication.
        let recordHandle = try FileHandle(forWritingTo: record)
        try recordHandle.synchronize(); try recordHandle.close()
        try synchronizeCreationDirectory(journal)
        let target = root.appendingPathComponent(intent.destination).standardizedFileURL
        let requestedDirectory = folder.map { root.appendingPathComponent($0, isDirectory: true) } ?? root
        let requestedTarget = requestedDirectory.appendingPathComponent(DocumentCreation.filename(for: title) + ".textpack").standardizedFileURL
        guard !intent.destination.hasPrefix("/"), target.resolvingSymlinksInPath().path.hasPrefix(canonicalRoot),
              target == requestedTarget, target.pathExtension == "textpack" else {
            throw TextTextCLIError.invalidDocument("invalid creation destination")
        }
        let paths = try list(limit: 5_001)
        guard paths.count < 5_001 else {
            throw TextTextCLIError.invalidDocument("workspace exceeds the bounded creation identity scan")
        }
        var matches: [URL] = []
        for path in paths {
            let url = try resolve(path)
            let markdown = url.pathExtension.lowercased() == "textpack"
                ? try LocalVaultDocumentStore(root: root).read(path: relativePath(of: url)).contents.markdown
                : try readMarkdown(at: url)
            if MarkdownIdentityCodec.extract(from: markdown)?.itemId == intent.itemId {
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
              let preparedHash = intent.preparedHash,
              TextTextStableDigest.sha256Hex(try Data(contentsOf: stage)) == preparedHash,
              MarkdownIdentityCodec.extract(from: try readMarkdown(at: stage))?.itemId == intent.itemId else {
            throw TextTextCLIError.invalidDocument("invalid prepared creation package")
        }
        let publicationStage: URL
        if privateJournal {
            let metadata = target.deletingLastPathComponent().appendingPathComponent(".texttext", isDirectory: true)
            let content = metadata.appendingPathComponent("cli-creation-content", isDirectory: true)
            for directory in [metadata, content] {
                if !fm.fileExists(atPath: directory.path) {
                    try fm.createDirectory(at: directory, withIntermediateDirectories: false)
                    try synchronizeCreationDirectory(directory.deletingLastPathComponent())
                }
                let values = try directory.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey])
                guard values.isSymbolicLink != true, values.isDirectory == true,
                      directory.resolvingSymlinksInPath().path == directory.standardizedFileURL.path else {
                    throw TextTextCLIError.invalidDocument("unsafe creation content staging directory")
                }
            }
            publicationStage = content.appendingPathComponent(intent.itemId + ".textpack")
            let publicationReceipt = journal.appendingPathComponent(digest + ".publication.json")
            let receiptBytes = try JSONSerialization.data(withJSONObject: ["version": 1,
                "itemId": intent.itemId, "destination": intent.destination, "preparedHash": preparedHash], options: [.sortedKeys])
            if fm.fileExists(atPath: publicationReceipt.path) {
                guard try publicationReceipt.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true,
                      try Data(contentsOf: publicationReceipt) == receiptBytes else {
                    throw TextTextCLIError.invalidDocument("invalid creation publication receipt")
                }
                guard fm.fileExists(atPath: publicationStage.path) else {
                    throw TextTextCLIError.invalidDocument("the previously created file is unavailable; no replacement was created")
                }
            }
            if !fm.fileExists(atPath: publicationStage.path) {
                try Data(contentsOf: stage).write(to: publicationStage, options: [.withoutOverwriting])
                let handle = try FileHandle(forWritingTo: publicationStage); try handle.synchronize(); try handle.close()
                try synchronizeCreationDirectory(content)
            }
            guard try publicationStage.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true,
                  TextTextStableDigest.sha256Hex(try Data(contentsOf: publicationStage)) == intent.preparedHash else {
                throw TextTextCLIError.invalidDocument("creation staging bytes changed; the private original is preserved")
            }
            if !fm.fileExists(atPath: publicationReceipt.path) {
                try receiptBytes.write(to: publicationReceipt, options: [.withoutOverwriting])
            }
            let receiptHandle = try FileHandle(forWritingTo: publicationReceipt)
            try receiptHandle.synchronize(); try receiptHandle.close()
            try synchronizeCreationDirectory(journal)
        } else { publicationStage = stage }
        var error: NSError?
        var result: Result<Void, Error>?
        NSFileCoordinator().coordinate(writingItemAt: target, options: [], error: &error) { coordinated in
            result = Result {
                guard coordinated.standardizedFileURL == target,
                      coordinated.resolvingSymlinksInPath().path.hasPrefix(canonicalRoot) else {
                    throw TextTextCLIError.invalidDocument("creation destination changed")
                }
                var preparedInfo = stat(), destinationInfo = stat()
                guard lstat(publicationStage.path, &preparedInfo) == 0,
                      lstat(coordinated.deletingLastPathComponent().path, &destinationInfo) == 0,
                      preparedInfo.st_dev == destinationInfo.st_dev else { throw POSIXError(.EXDEV) }
                // Foundation may expose the system /var alias. Bind the actual
                // parent paths before NOFOLLOW_ANY, without accepting a changed
                // workspace-relative ancestor as a new destination.
                func realDirectory(_ url: URL) throws -> String {
                    guard let bytes = Darwin.realpath(url.path, nil) else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
                    defer { free(bytes) }
                    return String(cString: bytes)
                }
                let physicalRoot = try realDirectory(root)
                let destinationParent = try realDirectory(coordinated.deletingLastPathComponent())
                let destinationRelativeParent = (intent.destination as NSString).deletingLastPathComponent
                let expectedParent = physicalRoot + (destinationRelativeParent.isEmpty ? "" : "/" + destinationRelativeParent)
                guard destinationParent == expectedParent else {
                    throw TextTextCLIError.invalidDocument("creation destination ancestor changed")
                }
                let stageParent = try realDirectory(publicationStage.deletingLastPathComponent())
                let expectedStageParent = privateJournal ? expectedParent + "/.texttext/cli-creation-content" : try realDirectory(journal)
                guard stageParent == expectedStageParent else {
                    throw TextTextCLIError.invalidDocument("creation staging ancestor changed")
                }
                let sourcePath = stageParent + "/" + publicationStage.lastPathComponent
                let destinationPath = destinationParent + "/" + coordinated.lastPathComponent
                guard renamex_np(sourcePath, destinationPath, UInt32(RENAME_EXCL | RENAME_NOFOLLOW_ANY)) == 0 else {
                    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
                }
                try synchronizeCreationDirectory(coordinated.deletingLastPathComponent())
                try synchronizeCreationDirectory(publicationStage.deletingLastPathComponent())
                guard TextTextStableDigest.sha256Hex(try Data(contentsOf: coordinated)) == intent.preparedHash else {
                    throw TextTextCLIError.invalidDocument("published creation bytes changed; recovery originals are preserved")
                }
                try synchronizeCreationDirectory(journal)
            }
        }
        if let error { throw error }
        guard let result else { throw CocoaError(.fileWriteUnknown) }
        try result.get()
        return target
    }
}
