import AppKit
import UniformTypeIdentifiers
import WriteFileProviderKit
import WriteWorkspaceCore

enum OpenFileKind: Equatable {
    case workspace
    case external
    case unsupported
}

/// Classifies files delivered by Launch Services. Write workspace files retain
/// their metadata-aware behavior, while ordinary text files open literally.
enum OpenFileHandler {
    static func kind(for url: URL, syncRoot: URL) -> OpenFileKind {
        guard supportedExtensions.contains(url.pathExtension.lowercased()) else {
            return .unsupported
        }
        if let relativePath = WorkspaceLayout.relativePath(for: url, under: syncRoot) {
            return WorkspaceLayout.isInternal(relativePath: relativePath)
                ? .unsupported
                : .workspace
        }
        return .external
    }

    static func isWriteFileProviderItem(_ rawIdentifier: String?) -> Bool {
        guard let rawIdentifier,
              let identifier = WriteItemIdentifier(rawValue: rawIdentifier),
              case .file = identifier else { return false }
        return true
    }

    /// Whether Write.app is the system default for markdown files.
    static func isDefaultMarkdownApp() -> Bool {
        guard let appURL = NSWorkspace.shared.urlForApplication(toOpen: markdownType) else {
            return false
        }
        return sameFile(appURL, Bundle.main.bundleURL)
    }

    /// Make (or stop making) Write.app the default app for .md files.
    static func setDefaultMarkdownApp(_ enabled: Bool) {
        let appURL = enabled
            ? Bundle.main.bundleURL
            : URL(fileURLWithPath: "/System/Applications/TextEdit.app", isDirectory: true)
        NSWorkspace.shared.setDefaultApplication(at: appURL, toOpen: markdownType)
    }

    private static let markdownType = UTType(importedAs: "net.daringfireball.markdown")
    private static let supportedExtensions: Set<String> = ["md", "markdown", "txt"]

    private static func sameFile(_ lhs: URL, _ rhs: URL) -> Bool {
        let lhsId = try? lhs.resourceValues(forKeys: [.fileResourceIdentifierKey]).fileResourceIdentifier
        let rhsId = try? rhs.resourceValues(forKeys: [.fileResourceIdentifierKey]).fileResourceIdentifier
        if let lhsId = lhsId as? NSObject, let rhsId = rhsId as? NSObject, lhsId.isEqual(rhsId) {
            return true
        }
        return lhs.standardizedFileURL.path == rhs.standardizedFileURL.path
    }
}
