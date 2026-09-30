import Foundation
import ZIPFoundation
import TextTextWorkspaceCore

extension LocalVaultDocumentStore {
    /// Import is a copy with a fresh identity, including when the same source
    /// is imported twice. Never overwrite a workspace file or mutate the source.
    public func importFile(from source: URL, newPath: String) throws -> Document {
        let destination = try url(for: newPath)
        let temporary = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let staged = temporary.appendingPathComponent("Source.textpack")
        var outcome: Result<Void, Error>?
        var coordinationError: NSError?
        NSFileCoordinator().coordinate(readingItemAt: source, options: [], error: &coordinationError) { input in
            outcome = Result {
                let values = try input.resourceValues(forKeys: [.isSymbolicLinkKey, .isRegularFileKey, .isDirectoryKey, .fileSizeKey])
                guard values.isSymbolicLink != true else { throw Failure.invalidPath }
                switch input.pathExtension.lowercased() {
                case "textpack":
                    guard values.isRegularFile == true, (values.fileSize ?? Int.max) <= 64 * 1024 * 1024 else { throw Failure.tooLarge }
                    try FileManager.default.copyItem(at: input, to: staged)
                case "textbundle":
                    guard values.isDirectory == true else { throw Failure.invalidPath }
                    // Copy individually after validation: copyItem on a directory
                    // would also copy symlinks and unbounded opaque payloads.
                    let copy = temporary.appendingPathComponent("Import.textbundle")
                    try Self.copyImportBundle(input, to: copy)
                    let packed = try TextTextTextBundlePackage.zipToTextPack(packageURL: copy, in: temporary)
                    try FileManager.default.moveItem(at: packed, to: staged)
                case "md", "markdown":
                    guard values.isRegularFile == true, (values.fileSize ?? Int.max) <= 64 * 1024 * 1024 else { throw Failure.tooLarge }
                    let data = try Data(contentsOf: input)
                    guard let markdown = String(data: data, encoding: .utf8) else {
                        throw TextTextTextBundleError.invalidPackage("Markdown must be UTF-8")
                    }
                    let assets = try Self.markdownImportAssets(markdown, beside: input, startingSize: data.count)
                    let package = try TextTextTextBundlePackage.materialize(canonicalMarkdown: markdown,
                        assets: assets, sourceURL: nil, in: temporary)
                    // Imported sibling paths are local assets, not remote URLs.
                    try JSONEncoder().encode(TextTextTextBundleInfo()).write(to: package.url.appendingPathComponent("info.json"))
                    let packed = try TextTextTextBundlePackage.zipToTextPack(packageURL: package.url, in: temporary)
                    try FileManager.default.moveItem(at: packed, to: staged)
                default:
                    throw TextTextTextBundleError.invalidPackage("Choose a TextPack, TextBundle, or Markdown file")
                }
            }
        }
        if let coordinationError { throw coordinationError }
        guard let outcome else { throw CocoaError(.fileReadUnknown) }
        try outcome.get()
        // read/clone validates the complete ZIP, enforces the expanded size
        // bound, and changes only text.md so opaque entries remain untouched.
        let stagingStore = LocalVaultDocumentStore(root: temporary)
        try Self.ensureImportSnapshot(at: staged, filename: source.deletingPathExtension().lastPathComponent, temporary: temporary)
        _ = try stagingStore.clone(path: "Source.textpack", newPath: "Imported.textpack")
        let ready = temporary.appendingPathComponent("Imported.textpack")
        var installed: Result<Void, Error>?
        NSFileCoordinator().coordinate(writingItemAt: destination, options: [], error: &coordinationError) { target in
            installed = Result {
                try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
                // Stage on the destination volume, then publish with a create-only
                // rename. Readers cannot observe a partially copied archive.
                let sibling = target.deletingLastPathComponent().appendingPathComponent(".texttext-import-\(UUID().uuidString)")
                defer { try? FileManager.default.removeItem(at: sibling) }
                try FileManager.default.copyItem(at: ready, to: sibling)
                let handle = try FileHandle(forWritingTo: sibling)
                try handle.synchronize(); try handle.close()
                try FileManager.default.moveItem(at: sibling, to: target)
            }
        }
        if let coordinationError { throw coordinationError }
        guard let installed else { throw CocoaError(.fileWriteUnknown) }
        try installed.get()
        return try read(path: newPath)
    }

    private static func ensureImportSnapshot(at pack: URL, filename: String, temporary: URL) throws {
        // Validate/bound the untrusted package before opening it for updates.
        let store = LocalVaultDocumentStore(root: temporary)
        let imported = try store.read(path: "Source.textpack")
        let archive = try Archive(url: pack, accessMode: .update)
        guard let textEntry = archive.first(where: { $0.path == "text.md" || $0.path.hasSuffix("/text.md") }) else { throw Failure.invalidPath }
        let prefix = String(textEntry.path.dropLast("text.md".count))
        var bytes = Data()
        _ = try archive.extract(textEntry) { bytes.append($0) }
        guard let markdown = String(data: bytes, encoding: .utf8) else { throw Failure.invalidPath }
        var title = filename, body = markdown.replacingOccurrences(of: "\r\n", with: "\n")
        if body.hasPrefix("\u{FEFF}") { body.removeFirst() }
        if body.hasPrefix("---\n"), let end = body.range(of: "\n---", range: body.index(body.startIndex, offsetBy: 4)..<body.endIndex) {
            let frontmatter = String(body[body.index(body.startIndex, offsetBy: 4)..<end.lowerBound])
            for line in frontmatter.components(separatedBy: "\n") where line.hasPrefix("title:") {
                let value = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
                title = (try? JSONSerialization.jsonObject(with: Data(value.utf8), options: .fragmentsAllowed)) as? String ?? value
            }
            body = String(body[end.upperBound...]).trimmingCharacters(in: .newlines)
        }
        guard title.count <= 20_000, body.count <= 10_000_000 else { throw Failure.tooLarge }
        var document = imported.contents.documentJSON
        var template = imported.contents.templateJSON
        if let existing = document {
            guard let value = try JSONSerialization.jsonObject(with: Data(existing.utf8)) as? [String: Any],
                  value["schemaVersion"] as? Int == 1,
                  let content = value["content"] as? [String: Any],
                  let existingTitle = content["title"] as? String, existingTitle.count <= 20_000,
                  let existingBody = content["body"] as? String, existingBody.count <= 10_000_000,
                  let presentation = value["presentation"] as? [String: Any],
                  let reference = presentation["template"] as? [String: Any],
                  let id = reference["id"] as? String, let version = reference["version"] as? Int, version > 0 else {
                throw TextTextTextBundleError.invalidPackage("Unsupported document snapshot")
            }
            if template == nil {
                let definitions = try JSONSerialization.jsonObject(with: Data(GeneratedBuiltinTemplates.json.utf8)) as? [[String: Any]]
                guard let matching = definitions?.first(where: { $0["id"] as? String == id && $0["version"] as? Int == version }) else {
                    throw TextTextTextBundleError.invalidPackage("This document needs its template.json")
                }
                template = String(decoding: try JSONSerialization.data(withJSONObject: matching), as: UTF8.self)
            }
        } else {
            let snapshot = try BuiltinTextPackDocument.create(title: title, body: body)
            if let existingTemplate = template {
                guard let definition = try JSONSerialization.jsonObject(with: Data(existingTemplate.utf8)) as? [String: Any],
                      definition["schemaVersion"] as? Int == 1, let id = definition["id"] as? String,
                      let version = definition["version"] as? Int, version > 0 else {
                    throw TextTextTextBundleError.invalidPackage("Unsupported template definition")
                }
                var value = try JSONSerialization.jsonObject(with: Data(snapshot.documentJSON.utf8)) as! [String: Any]
                value["presentation"] = ["template": ["id": id, "version": version], "theme": [:]] as [String: Any]
                document = String(decoding: try JSONSerialization.data(withJSONObject: value), as: UTF8.self)
            } else {
                document = snapshot.documentJSON
                template = snapshot.templateJSON
            }
        }
        for (name, value) in [("document.json", document), ("template.json", template)] {
            guard archive[prefix + name] == nil, let value else { continue }
            let entry = temporary.appendingPathComponent(name)
            try Data(value.utf8).write(to: entry)
            try archive.addEntry(with: prefix + name, fileURL: entry, compressionMethod: .deflate)
        }
    }

    private static func copyImportBundle(_ suppliedSource: URL, to destination: URL) throws {
        let source = suppliedSource.standardizedFileURL.resolvingSymlinksInPath()
        let keys: Set<URLResourceKey> = [.isSymbolicLinkKey, .isRegularFileKey, .isDirectoryKey, .fileSizeKey]
        guard let entries = FileManager.default.enumerator(at: source, includingPropertiesForKeys: Array(keys)) else { throw Failure.invalidPath }
        try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
        var size = 0, count = 0
        for case let entry as URL in entries {
            let values = try entry.resourceValues(forKeys: keys)
            count += 1
            guard values.isSymbolicLink != true, count <= TextTextTextBundlePackage.maximumEntryCount else { throw Failure.invalidPath }
            let canonical = entry.standardizedFileURL.resolvingSymlinksInPath().path
            guard canonical.hasPrefix(source.path + "/") else { throw Failure.invalidPath }
            let relative = String(canonical.dropFirst(source.path.count + 1))
            let target = destination.appendingPathComponent(relative)
            if values.isDirectory == true {
                try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
            } else {
                guard values.isRegularFile == true else { throw Failure.invalidPath }
                size += values.fileSize ?? Int.max / 2
                guard size <= 64 * 1024 * 1024 else { throw Failure.tooLarge }
                try FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
                try FileManager.default.copyItem(at: entry, to: target)
            }
        }
    }

    private static func markdownImportAssets(_ markdown: String, beside source: URL, startingSize: Int) throws -> [TextTextTextBundlePackage.MaterializedAsset] {
        // Standard inline links/images. Preserve remote links unchanged. Relative
        // references must stay inside the selected file's directory.
        let regex = try NSRegularExpression(pattern: #"!?\[[^\]\n]*\]\(<?([^\s)>]+)>?(?:\s+\"[^\"]*\")?\)"#)
        let text = markdown as NSString
        let parent = source.deletingLastPathComponent().resolvingSymlinksInPath()
        var assets: [TextTextTextBundlePackage.MaterializedAsset] = []
        var seen = Set<String>(), size = startingSize
        for match in regex.matches(in: markdown, range: NSRange(location: 0, length: text.length)) {
            let reference = text.substring(with: match.range(at: 1))
            guard seen.insert(reference).inserted, !reference.hasPrefix("#"), URL(string: reference)?.scheme == nil else { continue }
            let decoded = reference.removingPercentEncoding ?? reference
            guard !decoded.hasPrefix("/"), !decoded.split(separator: "/").contains("..") else { throw Failure.invalidPath }
            let asset = parent.appendingPathComponent(decoded)
            guard asset.resolvingSymlinksInPath().path == asset.path else { throw Failure.invalidPath }
            let values = try asset.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
            guard values.isRegularFile == true else { throw Failure.invalidPath }
            size += values.fileSize ?? Int.max / 2
            guard size <= 64 * 1024 * 1024, assets.count < 2_000 else { throw Failure.tooLarge }
            // Unique flat asset names also handle two subfolders with same name.
            let filename = "\(assets.count + 1)-\(asset.lastPathComponent)"
            guard TextTextTextBundlePackage.isSafeAssetFilename(filename) else { throw Failure.invalidPath }
            assets.append(.init(filename: filename, data: try Data(contentsOf: asset), remoteURL: reference))
        }
        return assets
    }
}
