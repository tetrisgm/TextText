import Foundation

/// Synthetic, read-only Finder items used for assets belonging to imported
/// plain files. Write-created documents keep assets inside their TextBundle;
/// this tree prevents external `.md` files from polluting content folders with
/// per-document sidecars while still giving relative Markdown URLs local bytes.
public enum WriteCentralAttachments {
    public static func dataContainerItem() -> WriteItem {
        folder(
            identifier: .dataContainer, parent: .rootContainer,
            filename: "Data")
    }

    public static func attachmentsContainerItem() -> WriteItem {
        folder(
            identifier: .attachmentsContainer, parent: .dataContainer,
            filename: "Attachments")
    }

    public static func workspaceItem(handle: String, displayName: String) -> WriteItem {
        folder(
            identifier: .attachmentWorkspace(handle),
            parent: .attachmentsContainer,
            filename: workspaceFolderFilename(displayName: displayName, handle: handle))
    }

    /// The attachment tree always carries a stable handle suffix. Workspace
    /// display names may collide or change, while Markdown references must keep
    /// addressing the same workspace folder without ambiguity.
    public static func workspaceFolderFilename(
        displayName: String, handle: String
    ) -> String {
        WriteFilename.collisionComponent(
            displayName.isEmpty ? handle : displayName, stableId: handle)
    }

    public static func documentItem(for item: WriteItem) -> WriteItem? {
        guard case .file(let handle, let postId) = item.identifier,
              item.representation == .markdown || item.representation == .text else {
            return nil
        }
        return folder(
            identifier: .attachmentItem(handle: handle, id: postId),
            parent: .attachmentWorkspace(handle),
            filename: documentFolderFilename(for: item))
    }

    public static func assetItem(
        _ artifact: WriteArtifact, handle: String, postId: String,
        size: Int? = nil
    ) -> WriteItem {
        WriteItem(
            identifier: .attachmentFile(
                handle: handle, id: postId, filename: artifact.filename),
            parentIdentifier: .attachmentItem(handle: handle, id: postId),
            filename: artifact.filename, isFolder: false, kind: .other("asset"),
            typeIdentifier: typeIdentifier(contentType: artifact.contentType),
            serverId: nil,
            contentHash: WriteStableDigest.sha256Hex(artifact.url),
            documentSize: size, creationDate: nil, contentModificationDate: nil,
            capabilities: .readOnlyFile, manifestURL: artifact.url)
    }

    public static func documentFolderFilename(for item: WriteItem) -> String {
        let suffix = item.representation?.filenameSuffix ?? ""
        var stem = item.filename
        if !suffix.isEmpty, stem.lowercased().hasSuffix(suffix.lowercased()) {
            stem.removeLast(suffix.count)
        }
        guard let serverId = item.serverId, !serverId.isEmpty else { return stem }
        return WriteFilename.collisionComponent(
            WriteFilename.decodeComponent(stem), stableId: serverId)
    }

    /// Rewrite canonical URLs as paths from a plain Markdown file to the
    /// synthetic root Data/Attachments tree.
    public static func localMarkdown(
        canonical: String, manifest: WriteArtifactManifest, handle: String,
        workspaceFilename: String, documentFilename: String, folderDepth: Int
    ) -> String {
        transform(
            canonical, manifest: manifest, handle: handle,
            workspaceFilename: workspaceFilename,
            documentFilename: documentFilename, folderDepth: folderDepth,
            toLocal: true)
    }

    /// Restore Write-hosted URLs before a plain Markdown edit is sent back to
    /// the server. Both percent-encoded and literal Finder paths are accepted.
    public static func canonicalMarkdown(
        local: String, manifest: WriteArtifactManifest, handle: String,
        workspaceFilename: String, documentFilename: String, folderDepth: Int
    ) -> String {
        transform(
            local, manifest: manifest, handle: handle,
            workspaceFilename: workspaceFilename,
            documentFilename: documentFilename, folderDepth: folderDepth,
            toLocal: false)
    }

    public static func localReference(
        filename: String, workspaceFilename: String, documentFilename: String,
        folderDepth: Int, percentEncoded: Bool = true
    ) -> String {
        let components = [
            "Data", "Attachments", workspaceFilename, documentFilename, filename,
        ]
        let path = components.map {
            percentEncoded ? markdownPathComponent($0) : $0
        }.joined(separator: "/")
        return String(repeating: "../", count: max(0, folderDepth) + 1) + path
    }

    private static func transform(
        _ markdown: String, manifest: WriteArtifactManifest, handle: String,
        workspaceFilename: String, documentFilename: String, folderDepth: Int,
        toLocal: Bool
    ) -> String {
        var result = markdown
        for artifact in WriteDocumentAssets.validatedInlineAssets(
            manifest, handle: handle
        ).sorted(by: { $0.url.count > $1.url.count }) {
            let encoded = localReference(
                filename: artifact.filename, workspaceFilename: workspaceFilename,
                documentFilename: documentFilename, folderDepth: folderDepth)
            if toLocal {
                result = result.replacingOccurrences(of: artifact.url, with: encoded)
            } else {
                let literal = localReference(
                    filename: artifact.filename,
                    workspaceFilename: workspaceFilename,
                    documentFilename: documentFilename, folderDepth: folderDepth,
                    percentEncoded: false)
                result = result.replacingOccurrences(of: encoded, with: artifact.url)
                result = result.replacingOccurrences(of: literal, with: artifact.url)
            }
        }
        return result
    }

    private static func folder(
        identifier: WriteItemIdentifier, parent: WriteItemIdentifier,
        filename: String
    ) -> WriteItem {
        WriteItem(
            identifier: identifier, parentIdentifier: parent,
            filename: filename, isFolder: true, kind: .folder,
            typeIdentifier: WriteItem.folderTypeIdentifier, serverId: nil,
            contentHash: nil, documentSize: nil, creationDate: nil,
            contentModificationDate: nil, capabilities: .readOnlyFolder)
    }

    private static func markdownPathComponent(_ value: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/?#%")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    private static func typeIdentifier(contentType: String?) -> String {
        guard let contentType else { return "public.data" }
        if contentType.hasPrefix("image/") { return "public.image" }
        if contentType.hasPrefix("video/") { return "public.movie" }
        return "public.data"
    }
}
