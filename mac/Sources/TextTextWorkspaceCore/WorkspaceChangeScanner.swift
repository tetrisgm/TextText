import Foundation

public struct WorkspaceFileRecord: Codable, Equatable {
    public var relativePath: String
    public var identityId: String?
    public var syncHash: String
    public var fileMtime: Double?

    public init(relativePath: String, identityId: String?, syncHash: String, fileMtime: Double?) {
        self.relativePath = relativePath
        self.identityId = identityId
        self.syncHash = syncHash
        self.fileMtime = fileMtime
    }
}

public struct WorkspaceSnapshot: Codable, Equatable {
    public var files: [String: WorkspaceFileRecord]

    public init(files: [String: WorkspaceFileRecord] = [:]) {
        self.files = files
    }
}

public enum WorkspaceDetectedChange: Equatable {
    case created(String)
    case modified(String)
    case renamed(from: String, to: String)
    case moved(from: String, to: String)
    case deleted(String)
}

public enum WorkspaceChangeScanner {
    public static func snapshot(root: URL, fileManager: FileManager = .default) -> WorkspaceSnapshot {
        var files: [String: WorkspaceFileRecord] = [:]
        for url in WorkspaceLayout.markdownFiles(at: root, fileManager: fileManager) {
            guard let rel = WorkspaceLayout.relativePath(for: url, under: root),
                  let data = try? Data(contentsOf: url) else { continue }
            let text = String(data: data, encoding: .utf8) ?? ""
            files[rel] = WorkspaceFileRecord(
                relativePath: rel,
                identityId: MarkdownIdentityCodec.extract(from: text)?.itemId,
                syncHash: MarkdownIdentityCodec.syncHash(for: data),
                fileMtime: fileMtime(url)
            )
        }
        return WorkspaceSnapshot(files: files)
    }

    public static func diff(from old: WorkspaceSnapshot, to new: WorkspaceSnapshot) -> [WorkspaceDetectedChange] {
        var changes: [WorkspaceDetectedChange] = []
        var consumedOld = Set<String>()
        var consumedNew = Set<String>()

        let oldByIdentity = Dictionary(grouping: old.files.values.compactMap { record -> WorkspaceFileRecord? in
            record.identityId == nil ? nil : record
        }, by: { $0.identityId ?? "" })
        let newByIdentity = Dictionary(grouping: new.files.values.compactMap { record -> WorkspaceFileRecord? in
            record.identityId == nil ? nil : record
        }, by: { $0.identityId ?? "" })

        for (identity, oldRecords) in oldByIdentity {
            guard let oldRecord = oldRecords.first,
                  let newRecord = newByIdentity[identity]?.first,
                  oldRecord.relativePath != newRecord.relativePath else { continue }
            consumedOld.insert(oldRecord.relativePath)
            consumedNew.insert(newRecord.relativePath)
            if deletingLastPathComponent(oldRecord.relativePath) == deletingLastPathComponent(newRecord.relativePath) {
                changes.append(.renamed(from: oldRecord.relativePath, to: newRecord.relativePath))
            } else {
                changes.append(.moved(from: oldRecord.relativePath, to: newRecord.relativePath))
            }
            if oldRecord.syncHash != newRecord.syncHash {
                changes.append(.modified(newRecord.relativePath))
            }
        }

        for (path, oldRecord) in old.files where !consumedOld.contains(path) {
            if let newRecord = new.files[path] {
                consumedNew.insert(path)
                if oldRecord.syncHash != newRecord.syncHash {
                    changes.append(.modified(path))
                }
            } else {
                changes.append(.deleted(path))
            }
        }

        for path in new.files.keys.sorted() where !old.files.keys.contains(path) && !consumedNew.contains(path) {
            changes.append(.created(path))
        }

        return changes.sorted(by: sortKey)
    }

    private static func fileMtime(_ url: URL) -> Double? {
        let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
        return (attrs?[.modificationDate] as? Date)?.timeIntervalSince1970
    }

    private static func deletingLastPathComponent(_ path: String) -> String {
        (path as NSString).deletingLastPathComponent
    }

    private static func sortKey(_ lhs: WorkspaceDetectedChange, _ rhs: WorkspaceDetectedChange) -> Bool {
        describe(lhs) < describe(rhs)
    }

    private static func describe(_ change: WorkspaceDetectedChange) -> String {
        switch change {
        case .created(let path): return "created:\(path)"
        case .modified(let path): return "modified:\(path)"
        case .renamed(let from, let to): return "renamed:\(from):\(to)"
        case .moved(let from, let to): return "moved:\(from):\(to)"
        case .deleted(let path): return "deleted:\(path)"
        }
    }
}
