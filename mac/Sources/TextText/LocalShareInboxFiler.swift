import Foundation
import TextTextCLICore
import TextTextFileProviderKit
import TextTextShareCore

/// Share capture uses the same files and durable creation journal as CLI agents.
/// The inbox remains the recovery copy until the complete TextPack is visible.
struct LocalShareInboxFiler {
    private struct Destination: Codable {
        let root: String
        let title: String
    }

    func file(_ record: InboxRecord, root: URL) throws -> URL {
        let item = record.item
        let folder: String
        let kind: String
        switch item.kind {
        case .note: folder = "Notes"; kind = "note"
        case .bookmark: folder = "Bookmarks"; kind = "bookmark"
        case .draft: folder = "Blog"; kind = "article"
        case .append, .file:
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
            let stem = supplied.isEmpty ? (source.flatMap { URL(string: $0)?.host } ?? "Untitled") : supplied
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
                title: destination.title, body: item.text ?? "", folder: folder, kind: kind,
                sourceURL: source, key: "share-inbox:\(record.id)")
            return try files.read(path: DocumentStore(root: canonicalRoot).relativePath(of: created))
        }.contentsURL(root: canonicalRoot)
    }
}

private extension LocalVaultDocumentStore.Document {
    func contentsURL(root: URL) -> URL { root.appendingPathComponent(path) }
}
