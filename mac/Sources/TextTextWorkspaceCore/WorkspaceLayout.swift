import Foundation

public struct WorkspaceBlogDescriptor: Codable, Equatable {
    public var handle: String
    public var name: String

    public init(handle: String, name: String) {
        self.handle = handle
        self.name = name
    }
}

public struct WorkspaceFolderDescriptor: Codable, Equatable {
    public var id: String
    public var name: String
    public var path: String
    public var mode: String
    public var parentId: String?

    public init(id: String, name: String, path: String, mode: String, parentId: String? = nil) {
        self.id = id
        self.name = name
        self.path = path
        self.mode = mode
        self.parentId = parentId
    }
}

public struct WorkspaceDescriptor: Codable, Equatable {
    public var blog: WorkspaceBlogDescriptor
    public var folders: [WorkspaceFolderDescriptor]

    public init(blog: WorkspaceBlogDescriptor, folders: [WorkspaceFolderDescriptor]) {
        self.blog = blog
        self.folders = folders
    }
}

public struct WorkspaceItemDescriptor: Codable, Equatable {
    public var id: String?
    public var kind: String
    public var slug: String
    public var status: String
    public var date: String?
    public var createdAt: String?
    public var updatedAt: String?

    public init(
        id: String?,
        kind: String,
        slug: String,
        status: String,
        date: String? = nil,
        createdAt: String? = nil,
        updatedAt: String? = nil
    ) {
        self.id = id
        self.kind = kind
        self.slug = slug
        self.status = status
        self.date = date
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

public struct WorkspaceLocalClassification: Equatable {
    public var folder: WorkspaceFolderDescriptor
    public var isDraftsArea: Bool

    public init(folder: WorkspaceFolderDescriptor, isDraftsArea: Bool) {
        self.folder = folder
        self.isDraftsArea = isDraftsArea
    }
}

public enum WorkspaceLayout {
    public static let metadataDirectoryName = ".texttext"
    public static let localMetadataDirectoryName = ".texttext-local.nosync"

    public static func ensureSkeleton(
        at root: URL,
        workspace: WorkspaceDescriptor?,
        fileManager: FileManager = .default
    ) throws {
        let directories = [
            "Blogs",
            "Notes",
            "Bookmarks",
            "Drafts",
            "Media",
            ".texttext",
            ".texttext/state",
        ]
        for relative in directories {
            try fileManager.createDirectory(
                at: root.appendingPathComponent(relative, isDirectory: true),
                withIntermediateDirectories: true
            )
        }

        guard let workspace else { return }
        let blogRoot = root.appendingPathComponent(blogRootRelativePath(workspace: workspace), isDirectory: true)
        try fileManager.createDirectory(at: blogRoot, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: blogRoot.appendingPathComponent("Posts", isDirectory: true),
                                        withIntermediateDirectories: true)
        try fileManager.createDirectory(at: blogRoot.appendingPathComponent("Media", isDirectory: true),
                                        withIntermediateDirectories: true)
        try writeWorkspaceMetadata(root: root, workspace: workspace, fileManager: fileManager)
        try writeBlogMetadata(root: root, workspace: workspace, fileManager: fileManager)
        for folder in workspace.folders {
            let directory = root.appendingPathComponent(directoryRelativePath(for: folder, workspace: workspace),
                                                       isDirectory: true)
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        }
    }

    public static func relativePath(
        for item: WorkspaceItemDescriptor,
        in folder: WorkspaceFolderDescriptor,
        workspace: WorkspaceDescriptor
    ) -> String {
        let filename = safeFilenameStem(item.slug) + ".md"
        switch normalizedMode(folder.mode) {
        case "notes":
            return join(directoryRelativePath(for: folder, workspace: workspace), filename)
        case "bookmarks":
            let year = bookmarkYear(for: item)
            return join(directoryRelativePath(for: folder, workspace: workspace), year, filename)
        default:
            let draft = item.status == "draft"
            if draft {
                let child = folder.path.hasPrefix("blog/") ? String(folder.path.dropFirst("blog/".count)) : ""
                return child.isEmpty ? join("Drafts", filename) : join("Drafts", child, filename)
            }
            return join(directoryRelativePath(for: folder, workspace: workspace), filename)
        }
    }

    public static func directoryRelativePath(
        for folder: WorkspaceFolderDescriptor,
        workspace: WorkspaceDescriptor
    ) -> String {
        switch normalizedMode(folder.mode) {
        case "notes":
            let child = pathAfterSystemPrefix(folder.path, prefix: "notes")
            return child.isEmpty ? "Notes" : join("Notes", child)
        case "bookmarks":
            let child = pathAfterSystemPrefix(folder.path, prefix: "bookmarks")
            return child.isEmpty ? "Bookmarks" : join("Bookmarks", child)
        default:
            let child = pathAfterSystemPrefix(folder.path, prefix: "blog")
            let base = join(blogRootRelativePath(workspace: workspace), "Posts")
            return child.isEmpty ? base : join(base, child)
        }
    }

    public static func classify(
        relativePath: String,
        workspace: WorkspaceDescriptor
    ) -> WorkspaceLocalClassification? {
        let normalized = normalizeRelativePath(relativePath)
        guard normalized.hasSuffix(".md"), !isInternal(relativePath: normalized) else { return nil }

        if normalized.hasPrefix("Drafts/"),
           let blog = workspace.folders.first(where: { normalizedMode($0.mode) == "blog" && $0.path == "blog" })
                ?? workspace.folders.first(where: { normalizedMode($0.mode) == "blog" }) {
            return WorkspaceLocalClassification(folder: blog, isDraftsArea: true)
        }

        var matches: [(folder: WorkspaceFolderDescriptor, directory: String)] = []
        for folder in workspace.folders {
            let directory = directoryRelativePath(for: folder, workspace: workspace)
            if normalized == directory || normalized.hasPrefix(directory + "/") {
                matches.append((folder, directory))
            }
        }
        let best = matches.max { lhs, rhs in lhs.directory.count < rhs.directory.count }
        if let best {
            return WorkspaceLocalClassification(folder: best.folder, isDraftsArea: false)
        }

        return nil
    }

    public static func markdownFiles(
        at root: URL,
        fileManager: FileManager = .default,
        includeSkippedDirectories: Bool = false,
        includeHiddenFiles: Bool = false,
        onEnumerationFailure: ((URL, Error) -> Void)? = nil
    ) -> [URL] {
        let options: FileManager.DirectoryEnumerationOptions = includeHiddenFiles ? [] : [.skipsHiddenFiles]
        // Without an errorHandler, FileManager silently skips directories it
        // cannot enumerate, which makes their whole subtree look deleted to
        // callers that diff against an index. Surface those failures.
        guard let enumerator = fileManager.enumerator(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: options,
            errorHandler: { url, error in
                onEnumerationFailure?(url, error)
                return true
            }
        ) else { return [] }
        var urls: [URL] = []
        for case let url as URL in enumerator {
            guard let rel = relativePath(for: url, under: root) else { continue }
            if isInternal(relativePath: rel) {
                enumerator.skipDescendants()
                continue
            }
            if !includeSkippedDirectories && (url.lastPathComponent == "Media" || url.lastPathComponent == "media") {
                var isDirectoryValue: ObjCBool = false
                if fileManager.fileExists(atPath: url.path, isDirectory: &isDirectoryValue),
                   isDirectoryValue.boolValue {
                    enumerator.skipDescendants()
                    continue
                }
            }
            if url.pathExtension.lowercased() == "md" {
                urls.append(url)
            }
        }
        return urls.sorted { $0.path < $1.path }
    }

    public static func relativePath(for url: URL, under root: URL) -> String? {
        let rootPath = root.standardizedFileURL.path
        let path = url.standardizedFileURL.path
        guard path == rootPath || path.hasPrefix(rootPath + "/") else { return nil }
        if path == rootPath { return "" }
        let start = path.index(path.startIndex, offsetBy: rootPath.count + 1)
        return normalizeRelativePath(String(path[start...]))
    }

    public static func isInternal(relativePath: String) -> Bool {
        let first = normalizeRelativePath(relativePath).split(separator: "/").first
        return first == Substring(metadataDirectoryName) || first == Substring(localMetadataDirectoryName)
    }

    private static func writeWorkspaceMetadata(
        root: URL,
        workspace: WorkspaceDescriptor,
        fileManager: FileManager
    ) throws {
        var lines = [
            "schema: texttext.workspace.v1",
            "blogHandle: \(yamlScalar(workspace.blog.handle))",
            "blogName: \(yamlScalar(workspace.blog.name))",
        ]
        lines.append("")
        let url = root.appendingPathComponent(".texttext/workspace.yaml")
        try writeIfChanged(Data(lines.joined(separator: "\n").utf8), to: url, fileManager: fileManager)
    }

    private static func writeBlogMetadata(
        root: URL,
        workspace: WorkspaceDescriptor,
        fileManager: FileManager
    ) throws {
        let lines = [
            "schema: texttext.blog.v1",
            "handle: \(yamlScalar(workspace.blog.handle))",
            "name: \(yamlScalar(workspace.blog.name))",
            "",
        ]
        let url = root.appendingPathComponent(join(blogRootRelativePath(workspace: workspace), "blog.yaml"))
        try writeIfChanged(Data(lines.joined(separator: "\n").utf8), to: url, fileManager: fileManager)
    }

    private static func writeIfChanged(_ data: Data, to url: URL, fileManager: FileManager) throws {
        if let existing = try? Data(contentsOf: url), existing == data { return }
        try fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }

    private static func blogRootRelativePath(workspace: WorkspaceDescriptor) -> String {
        join("Blogs", safePathComponent(workspace.blog.handle.isEmpty ? "default" : workspace.blog.handle))
    }

    private static func normalizedMode(_ mode: String) -> String {
        mode.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private static func pathAfterSystemPrefix(_ path: String, prefix: String) -> String {
        let normalized = normalizeRelativePath(path)
        if normalized == prefix { return "" }
        if normalized.hasPrefix(prefix + "/") { return String(normalized.dropFirst(prefix.count + 1)) }
        return normalized
    }

    private static func bookmarkYear(for item: WorkspaceItemDescriptor) -> String {
        let candidates = [item.date, item.createdAt, item.updatedAt].compactMap { $0 }
        for candidate in candidates {
            let trimmed = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.count >= 4 {
                let prefix = String(trimmed.prefix(4))
                if prefix.range(of: #"^\d{4}$"#, options: .regularExpression) != nil {
                    return prefix
                }
            }
        }
        let year = Calendar(identifier: .gregorian).component(.year, from: Date())
        return "\(year)"
    }

    private static func normalizeRelativePath(_ path: String) -> String {
        path.split(separator: "/", omittingEmptySubsequences: true).joined(separator: "/")
    }

    private static func safeFilenameStem(_ stem: String) -> String {
        let cleaned = stem.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.isEmpty { return "untitled" }
        return cleaned.replacingOccurrences(of: "/", with: "-")
    }

    private static func safePathComponent(_ component: String) -> String {
        component.replacingOccurrences(of: "/", with: "-")
    }

    private static func join(_ parts: String...) -> String {
        parts.flatMap { $0.split(separator: "/", omittingEmptySubsequences: true).map(String.init) }
            .joined(separator: "/")
    }

    private static func yamlScalar(_ value: String) -> String {
        guard let data = try? JSONEncoder().encode(value),
              let text = String(data: data, encoding: .utf8) else {
            return "\"\(value.replacingOccurrences(of: "\"", with: "\\\""))\""
        }
        return text
    }
}
