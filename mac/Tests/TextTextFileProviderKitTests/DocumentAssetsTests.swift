import Foundation
import XCTest
@testable import TextTextFileProviderKit

final class DocumentAssetsTests: XCTestCase {
    private let legacyURL =
        "https://texttext.public.blob.vercel-storage.com/captures/demo/post-1/assets/hero.png"
    private let documentURL =
        "https://texttext.public.blob.vercel-storage.com/documents/demo/post-1/assets/photo.jpg"

    func testMarkdownRoundTripsOnlyValidatedInlineAssets() {
        let manifest = TextTextArtifactManifest(
            postId: "post-1", slug: "why??", fileHash: "hash-1",
            artifacts: [
                TextTextArtifact(
                    filename: "asset-001.png", role: "asset", url: legacyURL),
                TextTextArtifact(
                    filename: "photo.jpg", role: "asset", url: documentURL),
                TextTextArtifact(
                    filename: "screenshot.png", role: "screenshot",
                    url: "https://texttext.public.blob.vercel-storage.com/captures/demo/post-1/tiles/001.png"),
                TextTextArtifact(
                    filename: "../escape.png", role: "asset", url: legacyURL),
            ])
        let canonical = "![Hero](\(legacyURL))\n\n![Photo](\(documentURL))"

        let local = TextTextDocumentAssets.localMarkdown(
            canonical: canonical, manifest: manifest, handle: "demo")

        XCTAssertEqual(local, "![Hero](assets/asset-001.png)\n\n![Photo](assets/photo.jpg)")
        XCTAssertEqual(
            TextTextDocumentAssets.canonicalMarkdown(
                local: local, manifest: manifest, handle: "demo"),
            canonical)
    }

    func testCanonicalMarkdownDoesNotRewriteInsideInsertedOrExistingURLs() {
        let short =
            "https://texttext.public.blob.vercel-storage.com/documents/demo/post-1/assets/photo.png"
        let long =
            "https://texttext.public.blob.vercel-storage.com/documents/demo/post-1/assets/photo.png.png"
        let local = "![A](./assets/photo.png)\n![B](assets/photo.png.png)\n![C](\(short))\n![D](assets/photo.png.bak)"

        let canonical = TextTextDocumentAssets.canonicalMarkdown(
            local: local,
            remoteURLsByFilename: ["photo.png": short, "photo.png.png": long])

        XCTAssertEqual(
            canonical,
            "![A](\(short))\n![B](\(long))\n![C](\(short))\n![D](assets/photo.png.bak)")
        XCTAssertFalse(canonical.contains("/post-1/https://"))
    }

    func testValidationRejectsForeignDuplicateScreenshotAndUnsafeAssets() {
        let manifest = TextTextArtifactManifest(
            postId: "post-1", slug: "bookmark", fileHash: "hash-1",
            artifacts: [
                TextTextArtifact(
                    filename: "asset.png", role: "asset", url: legacyURL),
                TextTextArtifact(
                    filename: "asset.png", role: "asset", url: documentURL),
                TextTextArtifact(
                    filename: "foreign.png", role: "asset",
                    url: "https://example.com/documents/demo/post-1/assets/foreign.png"),
                TextTextArtifact(
                    filename: "tile.png", role: "screenshot",
                    url: "https://texttext.public.blob.vercel-storage.com/captures/demo/post-1/tiles/001.png"),
            ])

        XCTAssertEqual(
            TextTextDocumentAssets.validatedInlineAssets(manifest, handle: "demo")
                .map(\.filename),
            ["asset.png"])
    }

    func testLegacyIdentifierParserRecognizesUnsafePostIdentifiers() {
        let postId = "post?/with:unsupported\\characters"
        let filename = "asset-001.webp"
        let postToken = token(postId)
        let filenameToken = token(filename)

        XCTAssertEqual(
            TextTextLegacyBookmarkSidecars.postId(
                fromFolderServerId: "texttext-bookmark-assets.\(postToken)"),
            postId)
        let identity = TextTextLegacyBookmarkSidecars.assetIdentity(
            fromFileServerId: "texttext-bookmark-asset.\(postToken).\(filenameToken)")
        XCTAssertEqual(identity?.postId, postId)
        XCTAssertEqual(identity?.filename, filename)
    }

    func testCentralMarkdownPathRoundTripsPortableEscapedComponents() {
        let escapedDocumentURL =
            "https://texttext.public.blob.vercel-storage.com/documents/demo/post-1/assets/what%20%231.png"
        let manifest = TextTextArtifactManifest(
            postId: "post-1", slug: "why??", fileHash: "hash-1",
            artifacts: [TextTextArtifact(
                filename: "what #1.png", role: "asset", url: escapedDocumentURL,
                contentType: "image/png")])
        let workspace = TextTextCentralAttachments.workspaceFolderFilename(
            displayName: "A workspace??", handle: "demo")
        let document = "A note [post-1]"
        let canonical = "![Photo](\(escapedDocumentURL))"

        let local = TextTextCentralAttachments.localMarkdown(
            canonical: canonical, manifest: manifest, handle: "demo",
            workspaceFilename: workspace, documentFilename: document,
            folderDepth: 2)

        XCTAssertTrue(local.contains("../../../Data/Attachments/"))
        XCTAssertTrue(local.contains("what%20%231.png"))
        XCTAssertEqual(
            TextTextCentralAttachments.canonicalMarkdown(
                local: local, manifest: manifest, handle: "demo",
                workspaceFilename: workspace, documentFilename: document,
                folderDepth: 2),
            canonical)
    }

    private func token(_ value: String) -> String {
        Data(value.utf8).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
