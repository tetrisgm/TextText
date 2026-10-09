import Foundation
import Darwin
import TextTextCLICore
import TextTextFileProviderKit
import TextTextShareCore
import TextTextWorkspaceCore
import UniformTypeIdentifiers

/// Share capture uses the same files and durable creation journal as CLI agents.
/// The inbox remains the recovery copy until the complete TextPack is visible.
struct LocalShareInboxFiler {
    private struct Destination: Codable {
        let root: String
        let title: String
    }

    func file(_ record: InboxRecord, root: URL) throws -> URL {
        let item = record.item
        if item.kind == .append { return try append(record, root: root) }
        let folder: String
        let kind: String
        var assets: [TextTextTextBundlePackage.MaterializedAsset] = []
        var body = item.text ?? ""
        switch item.kind {
        case .note: folder = "Notes"; kind = "note"
        case .bookmark: folder = "Bookmarks"; kind = "bookmark"
        case .draft: folder = "Blog"; kind = "article"
        case .file:
            guard let payload = record.payloadURL, let filename = item.payloadFilename,
                  TextTextTextBundlePackage.isSafeAssetFilename(filename),
                  payload.standardizedFileURL == record.directoryURL.appendingPathComponent(filename).standardizedFileURL else {
                throw TextTextCLIError.invalidDocument("The shared attachment is unavailable.")
            }
            let values = try payload.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
            guard values.isRegularFile == true, values.isSymbolicLink != true,
                  (values.fileSize ?? Int.max) <= 64 * 1_024 * 1_024 else {
                throw TextTextCLIError.invalidDocument("The shared attachment is unavailable or too large.")
            }
            // Open without following a replacement symlink, then bound the
            // actual descriptor rather than trusting an earlier path stat.
            let descriptor = Darwin.open(payload.path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK)
            guard descriptor >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
            let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
            defer { try? handle.close() }
            var actual = stat()
            guard fstat(descriptor, &actual) == 0, actual.st_mode & S_IFMT == S_IFREG,
                  actual.st_size >= 0, actual.st_size <= 64 * 1_024 * 1_024 else {
                throw TextTextCLIError.invalidDocument("The shared attachment is unavailable or too large.")
            }
            let data = try handle.read(upToCount: Int(actual.st_size) + 1) ?? Data()
            guard data.count == actual.st_size else {
                throw TextTextCLIError.invalidDocument("The shared attachment changed while it was being read.")
            }
            guard data.count <= 64 * 1_024 * 1_024 else {
                throw TextTextCLIError.invalidDocument("The shared attachment is too large.")
            }
            let type = UTType(filenameExtension: payload.pathExtension)
            let visual = type?.conforms(to: .image) == true || type?.conforms(to: .movie) == true
            folder = visual ? "Gallery" : "Notes"; kind = visual ? "gallery" : "note"
            let ext = type?.preferredFilenameExtension ?? "bin"
            let storedName = "shared-" + TextTextStableDigest.sha256Hex(data) + "." + ext
            assets = [.init(filename: storedName, data: data, remoteURL: "assets/\(storedName)",
                            contentType: type?.preferredMIMEType ?? "application/octet-stream")]
            if !visual {
                let label = filename.replacingOccurrences(of: "\\", with: "\\\\")
                    .replacingOccurrences(of: "[", with: "\\[").replacingOccurrences(of: "]", with: "\\]")
                body += (body.isEmpty ? "" : "\n\n") + "[\(label)](assets/\(storedName))"
            }
        case .append:
            throw NSError(domain: "TextTextShare", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "This shared item is kept in the inbox for filing."])
        }
        let source = item.urlString?.trimmingCharacters(in: .whitespacesAndNewlines)
        if item.kind == .bookmark {
            guard let source, let url = URL(string: source),
                  ["https", "http"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else {
                throw InboxFilerError.missingURL
            }
        }
        let canonicalRoot = root.standardizedFileURL.resolvingSymlinksInPath()
        let files = LocalVaultDocumentStore(root: canonicalRoot)
        try files.ensureFolders([folder])
        let marker = record.directoryURL.appendingPathComponent("local-destination.json")
        let destination: Destination
        if FileManager.default.fileExists(atPath: marker.path) {
            destination = try JSONDecoder().decode(Destination.self, from: Data(contentsOf: marker))
            guard destination.root == canonicalRoot.path else {
                throw NSError(domain: "TextTextShare", code: 2,
                              userInfo: [NSLocalizedDescriptionKey: "The shared item is retained for its original workspace."])
            }
        } else {
            let supplied = item.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let fallback = item.kind == .file
                ? URL(fileURLWithPath: item.payloadFilename ?? "Shared file").deletingPathExtension().lastPathComponent
                : (source.flatMap { URL(string: $0)?.host } ?? "Untitled")
            let stem = supplied.isEmpty ? fallback : supplied
            var title = stem, suffix = 2
            while FileManager.default.fileExists(atPath: canonicalRoot.appendingPathComponent(folder)
                .appendingPathComponent(DocumentCreation.filename(for: title) + ".textpack").path) {
                title = "\(stem) \(suffix)"; suffix += 1
            }
            destination = Destination(root: canonicalRoot.path, title: title)
            try JSONEncoder().encode(destination).write(to: marker, options: [.atomic])
        }
        return try LocalVaultEditOriginJournal(root: canonicalRoot).recordingNativeSave {
            let created = try DocumentStore(root: canonicalRoot).createWithRetryKey(
                title: destination.title, body: body, folder: folder, kind: kind,
                sourceURL: item.kind == .file ? nil : source, key: "share-inbox:\(record.id)", assets: assets)
            return try files.read(path: DocumentStore(root: canonicalRoot).relativePath(of: created))
        }.contentsURL(root: canonicalRoot)
    }

    private func append(_ record: InboxRecord, root: URL) throws -> URL {
        guard let target = record.item.targetTextTextId, UUID(uuidString: target) != nil else {
            throw InboxFilerError.missingAppendTarget
        }
        let canonicalRoot = root.standardizedFileURL.resolvingSymlinksInPath()
        let files = LocalVaultDocumentStore(root: canonicalRoot)
        guard let path = try files.path(forItemId: target) else {
            throw TextTextCLIError.documentNotFound(target)
        }
        let marker = record.directoryURL.appendingPathComponent("append-destination.json")
        let destination = Destination(root: canonicalRoot.path, title: target)
        if FileManager.default.fileExists(atPath: marker.path) {
            let stored = try JSONDecoder().decode(Destination.self, from: Data(contentsOf: marker))
            guard stored.root == destination.root, stored.title == destination.title else {
                throw TextTextCLIError.invalidDocument("The shared append is retained for its original workspace.")
            }
        } else {
            try JSONEncoder().encode(destination).write(to: marker, options: [.atomic])
        }
        let current = try files.read(path: path)
        let text = record.item.text ?? ""
        let separator = current.contents.markdown.hasSuffix("\n") ? "" : "\n"
        let written = try LocalVaultEditOriginJournal(root: canonicalRoot).recordingNativeSave {
            try files.write(path: path, expectedHash: current.hash,
                markdown: current.contents.markdown + separator + text,
                documentJSON: current.contents.documentJSON,
                templateJSON: current.contents.templateJSON,
                templateAuthoringSourceJSON: current.contents.templateAuthoringSourceJSON,
                mutationKey: "share-inbox:\(record.id)",
                mutationFingerprint: TextTextStableDigest.sha256Hex(Data(("share-append\u{0}" + target + "\u{0}" + text).utf8)))
        }
        return canonicalRoot.appendingPathComponent(written.path)
    }
}

private extension LocalVaultDocumentStore.Document {
    func contentsURL(root: URL) -> URL { root.appendingPathComponent(path) }
}
