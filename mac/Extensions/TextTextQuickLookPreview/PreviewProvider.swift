import CoreGraphics
import Foundation
import TextTextShareCore

public enum QuickLookMarkdownPreview {
    public static func html(for markdown: String, fileURL: URL? = nil) -> String {
        TextTextMarkdownPreviewRenderer.renderHTML(
            markdown: markdown,
            workspaceRootURL: fileURL.flatMap { workspaceRoot(containing: $0) }
        )
    }

    public static func workspaceRoot(containing fileURL: URL) -> URL? {
        var directory = fileURL.deletingLastPathComponent().standardizedFileURL
        while directory.path != "/" {
            if looksLikeWorkspaceRoot(directory) {
                return directory
            }
            let parent = directory.deletingLastPathComponent().standardizedFileURL
            if parent.path == directory.path { break }
            directory = parent
        }
        return nil
    }

    private static func looksLikeWorkspaceRoot(_ url: URL) -> Bool {
        let fileManager = FileManager.default
        if fileManager.fileExists(atPath: url.appendingPathComponent(".texttext", isDirectory: true).path) {
            return true
        }
        let expected = ["Notes", "Bookmarks", "Drafts", "Media"]
        return expected.contains { name in
            var isDirectory: ObjCBool = false
            return fileManager.fileExists(
                atPath: url.appendingPathComponent(name, isDirectory: true).path,
                isDirectory: &isDirectory
            ) && isDirectory.boolValue
        }
    }
}

#if canImport(QuickLookUI) && canImport(UniformTypeIdentifiers)
import QuickLookUI
import UniformTypeIdentifiers

@available(macOS 12.0, *)
@objc(PreviewProvider)
public final class PreviewProvider: QLPreviewProvider {
    public func providePreview(
        for request: QLFilePreviewRequest,
        completionHandler handler: @escaping (QLPreviewReply?, Error?) -> Void
    ) {
        do {
            let data = try Data(contentsOf: request.fileURL)
            guard let markdown = String(data: data, encoding: .utf8) else {
                throw CocoaError(.fileReadInapplicableStringEncoding)
            }
            let html = QuickLookMarkdownPreview.html(for: markdown, fileURL: request.fileURL)
            let htmlData = Data(html.utf8)
            let reply = QLPreviewReply(
                dataOfContentType: .html,
                contentSize: CGSize(width: 760, height: 980)
            ) { _ in
                htmlData
            }
            reply.title = request.fileURL.deletingPathExtension().lastPathComponent
            handler(reply, nil)
        } catch {
            handler(nil, error)
        }
    }
}
#endif
