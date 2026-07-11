import Foundation

public struct WorkspaceMigrationSummary: Equatable {
    public var moved = 0
    public var adopted = 0
    public var skipped = 0
    public var conflicts = 0
    public var errors: [String] = []

    public init() {}
}

public enum WorkspaceMigrator {
    @discardableResult
    public static func migrateLegacyMirror(
        from legacyRoot: URL,
        to workspaceRoot: URL,
        workspace: WorkspaceDescriptor? = nil,
        fileManager: FileManager = .default
    ) -> WorkspaceMigrationSummary {
        var summary = WorkspaceMigrationSummary()
        guard legacyRoot.standardizedFileURL.path != workspaceRoot.standardizedFileURL.path else {
            return summary
        }
        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: legacyRoot.path, isDirectory: &isDirectory),
              isDirectory.boolValue else {
            return summary
        }

        do {
            try fileManager.createDirectory(at: workspaceRoot, withIntermediateDirectories: true)
            try mergeDirectory(
                from: legacyRoot,
                sourceRoot: legacyRoot,
                to: workspaceRoot,
                workspace: workspace,
                summary: &summary,
                fileManager: fileManager
            )
            if summary.errors.isEmpty {
                try writeLocalSyncMarker(at: workspaceRoot, fileManager: fileManager)
            }
        } catch {
            summary.errors.append(error.localizedDescription)
        }
        return summary
    }

    private static func mergeDirectory(
        from source: URL,
        sourceRoot: URL,
        to destination: URL,
        workspace: WorkspaceDescriptor?,
        summary: inout WorkspaceMigrationSummary,
        fileManager: FileManager
    ) throws {
        let contents = try fileManager.contentsOfDirectory(at: source, includingPropertiesForKeys: [.isDirectoryKey])
        for item in contents {
            let name = item.lastPathComponent
            if name == ".write-sync" || name == ".DS_Store" {
                summary.skipped += 1
                continue
            }
            var isDirectory: ObjCBool = false
            let itemIsDirectory = fileManager.fileExists(atPath: item.path, isDirectory: &isDirectory) && isDirectory.boolValue
            if itemIsDirectory {
                try mergeDirectory(
                    from: item,
                    sourceRoot: sourceRoot,
                    to: destination,
                    workspace: workspace,
                    summary: &summary,
                    fileManager: fileManager
                )
                continue
            }

            guard let legacyRel = WorkspaceLayout.relativePath(for: item, under: sourceRoot) else {
                summary.skipped += 1
                continue
            }
            let targetRel = migratedRelativePath(for: legacyRel, source: item, workspace: workspace)
            let target = destination.appendingPathComponent(targetRel)

            if !fileManager.fileExists(atPath: target.path) {
                do {
                    try fileManager.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try fileManager.moveItem(at: item, to: target)
                    summary.moved += 1
                } catch {
                    try fileManager.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try fileManager.copyItem(at: item, to: target)
                    summary.adopted += 1
                }
                continue
            }

            switch sameBytes(item, target) {
            case .same:
                summary.skipped += 1
                continue
            case .unreadable(let message):
                summary.errors.append(message)
                continue
            case .different:
                break
            }

            let conflict = conflictURL(for: target, fileManager: fileManager)
            do {
                try fileManager.moveItem(at: item, to: conflict)
                summary.conflicts += 1
            } catch {
                summary.errors.append("Could not preserve \(item.path): \(error.localizedDescription)")
            }
        }
    }

    private enum ByteComparison {
        case same
        case different
        case unreadable(String)
    }

    private static func sameBytes(_ left: URL, _ right: URL) -> ByteComparison {
        do {
            let l = try Data(contentsOf: left)
            let r = try Data(contentsOf: right)
            if l == r { return .same }
            if left.pathExtension.lowercased() == "md",
               right.pathExtension.lowercased() == "md",
               MarkdownIdentityCodec.syncHash(for: l) == MarkdownIdentityCodec.syncHash(for: r) {
                return .same
            }
            return .different
        } catch {
            return .unreadable("Could not compare \(left.path) with \(right.path): \(error.localizedDescription)")
        }
    }

    private static func conflictURL(for target: URL, fileManager: FileManager) -> URL {
        let dir = target.deletingLastPathComponent()
        let stem = target.deletingPathExtension().lastPathComponent
        let ext = target.pathExtension
        let stamp = legacyConflictStamp()
        var candidate = dir.appendingPathComponent("\(stem) (conflicted copy migration \(stamp)).\(ext)")
        if ext.isEmpty {
            candidate = dir.appendingPathComponent("\(stem) (conflicted copy migration \(stamp))")
        }
        var n = 2
        while fileManager.fileExists(atPath: candidate.path) {
            let suffix = " (conflicted copy migration \(stamp) \(n))"
            candidate = ext.isEmpty
                ? dir.appendingPathComponent(stem + suffix)
                : dir.appendingPathComponent(stem + suffix + "." + ext)
            n += 1
        }
        return candidate
    }

    private static func migratedRelativePath(
        for legacyRel: String,
        source: URL,
        workspace: WorkspaceDescriptor?
    ) -> String {
        let parts = legacyRel.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        guard let first = parts.first else { return legacyRel }
        let remainder = Array(parts.dropFirst())
        switch first.lowercased() {
        case "blog":
            if markdownFrontMatterValue("status", in: source)?.lowercased() == "draft" {
                return join(["Drafts"] + remainder)
            }
            let rawHandle = workspace?.blog.handle ?? "default"
            let handle = rawHandle.isEmpty ? "default" : rawHandle
            return join(["Blogs", safePathComponent(handle), "Posts"] + remainder)
        case "notes":
            return join(["Notes"] + remainder)
        case "bookmarks":
            guard source.pathExtension.lowercased() == "md" else {
                return join(["Bookmarks"] + remainder)
            }
            let year = bookmarkYear(in: source) ?? currentYear()
            return join(["Bookmarks", year] + remainder)
        case "drafts":
            return join(["Drafts"] + remainder)
        default:
            return legacyRel
        }
    }

    private static func markdownFrontMatterValue(_ key: String, in url: URL) -> String? {
        guard let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .utf8),
              text.hasPrefix("---\n") || text.hasPrefix("---\r\n") else { return nil }
        let wanted = key.lowercased()
        for line in text.components(separatedBy: .newlines).dropFirst() {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed == "---" { return nil }
            guard let colon = trimmed.firstIndex(of: ":") else { continue }
            let frontMatterKey = trimmed[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            guard frontMatterKey == wanted else { continue }
            let raw = trimmed[trimmed.index(after: colon)...].trimmingCharacters(in: .whitespacesAndNewlines)
            return raw.trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
        }
        return nil
    }

    private static func bookmarkYear(in url: URL) -> String? {
        guard let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .utf8) else { return nil }
        let keys = ["date", "createdAt", "created_at", "updatedAt", "updated_at"]
        for line in text.components(separatedBy: .newlines) {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let key = line[..<colon].trimmingCharacters(in: .whitespaces)
            guard keys.contains(key) else { continue }
            let raw = line[line.index(after: colon)...].trimmingCharacters(in: .whitespacesAndNewlines)
            let cleaned = raw.trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
            if cleaned.count >= 4 {
                let prefix = String(cleaned.prefix(4))
                if prefix.range(of: #"^\d{4}$"#, options: .regularExpression) != nil {
                    return prefix
                }
            }
        }
        return nil
    }

    private static func currentYear() -> String {
        "\(Calendar(identifier: .gregorian).component(.year, from: Date()))"
    }

    private static func join(_ parts: [String]) -> String {
        parts.flatMap { $0.split(separator: "/", omittingEmptySubsequences: true).map(String.init) }
            .joined(separator: "/")
    }

    private static func safePathComponent(_ value: String) -> String {
        value.replacingOccurrences(of: "/", with: "-")
    }

    private static func legacyConflictStamp() -> String {
        let df = DateFormatter()
        df.locale = Locale(identifier: "en_US_POSIX")
        df.dateFormat = "yyyy-MM-dd HHmm"
        return df.string(from: Date())
    }

    private static func writeLocalSyncMarker(at root: URL, fileManager: FileManager) throws {
        let marker = root
            .appendingPathComponent(WorkspaceLayout.localMetadataDirectoryName, isDirectory: true)
            .appendingPathComponent("state", isDirectory: true)
            .appendingPathComponent("sync-marker.txt")
        try fileManager.createDirectory(at: marker.deletingLastPathComponent(), withIntermediateDirectories: true)
        if fileManager.fileExists(atPath: marker.path) { return }
        try Data("Write local sync marker. This directory is per device and is not synced through iCloud.\n".utf8)
            .write(to: marker, options: .atomic)
    }
}
