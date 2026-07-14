import XCTest
@testable import WriteFileProviderKit

final class BookmarkSidecarsTests: XCTestCase {
    private let captureURL =
        "https://write.public.blob.vercel-storage.com/captures/demo/post-1/assets/hero.png"

    func testDirectoryNameEscapesUnsupportedFilenameCharacters() {
        let name = WriteBookmarkSidecars.directoryName(slug: "why??: now*")

        XCTAssertEqual(name, "why~3F~3F~3A now~2A.assets")
        XCTAssertFalse(name.contains("?"))
        XCTAssertTrue(name.hasSuffix(".assets"))
    }

    func testDirectoryNameReservesSuffixInsideFilesystemLimit() {
        let name = WriteBookmarkSidecars.directoryName(
            slug: String(repeating: "very-long-title-", count: 40))

        XCTAssertLessThanOrEqual(
            name.utf8.count, WriteFilename.maximumComponentUTF8Length)
        XCTAssertTrue(name.hasSuffix(".assets"))
    }

    func testSyntheticIdentifiersRoundTripUnsafePostIdentifiers() {
        let postId = "post?/with:unsupported\\characters"
        let folder = WriteBookmarkSidecars.folderIdentifier(
            handle: "demo", postId: postId)
        let asset = WriteBookmarkSidecars.assetIdentifier(
            handle: "demo", postId: postId, filename: "asset-001.webp")

        guard case .folder(_, let folderServerId) = folder,
              case .file(_, let assetServerId) = asset else {
            return XCTFail("synthetic identifiers used the wrong item kind")
        }
        XCTAssertEqual(
            WriteBookmarkSidecars.postId(fromFolderServerId: folderServerId),
            postId)
        XCTAssertEqual(
            WriteBookmarkSidecars.assetIdentity(fromFileServerId: assetServerId)?.postId,
            postId)
        XCTAssertEqual(
            WriteBookmarkSidecars.assetIdentity(fromFileServerId: assetServerId)?.filename,
            "asset-001.webp")
    }

    func testLocalMarkdownRewritesOnlyValidatedWriteHostedArtifacts() {
        let manifest = WriteBookmarkArtifactManifest(
            postId: "post-1", slug: "why??", fileHash: "hash-1",
            artifacts: [
                WriteBookmarkArtifact(
                    filename: "asset-001.png", role: "asset", url: captureURL),
                WriteBookmarkArtifact(
                    filename: "asset-002.png", role: "asset",
                    url: "https://example.com/captures/demo/post-1/foreign.png"),
                WriteBookmarkArtifact(
                    filename: "../escape.png", role: "asset",
                    url: "https://write.public.blob.vercel-storage.com/captures/demo/post-1/escape.png"),
            ])
        let canonical = "![Hero](\(captureURL))\n\n" +
            "![Remote](https://example.com/captures/demo/post-1/foreign.png)"

        let local = WriteBookmarkSidecars.localMarkdown(
            canonical: canonical, manifest: manifest, handle: "demo")

        XCTAssertTrue(local.contains("![Hero](./why~3F~3F.assets/asset-001.png)"))
        XCTAssertTrue(local.contains("https://example.com/captures/demo/post-1/foreign.png"))
        XCTAssertFalse(local.contains("../escape.png"))
        XCTAssertEqual(
            WriteBookmarkSidecars.canonicalMarkdown(
                local: local, manifest: manifest, handle: "demo"),
            canonical)
    }

    func testArtifactValidationRejectsForeignPathsDuplicatesAndUnsafeNames() {
        let manifest = WriteBookmarkArtifactManifest(
            postId: "post-1", slug: "bookmark", fileHash: "hash-1",
            artifacts: [
                WriteBookmarkArtifact(
                    filename: "asset-001.png", role: "asset", url: captureURL),
                WriteBookmarkArtifact(
                    filename: "asset-001.png", role: "asset",
                    url: "https://write.public.blob.vercel-storage.com/captures/demo/post-1/assets/other.png"),
                WriteBookmarkArtifact(
                    filename: "asset-002.png", role: "asset",
                    url: "https://write.public.blob.vercel-storage.com/captures/other/post-1/assets/other.png"),
                WriteBookmarkArtifact(
                    filename: "screenshot-001.png", role: "screenshot",
                    url: "https://write.public.blob.vercel-storage.com/captures/demo/post-1/tiles/001.png"),
            ])
        let validated = WriteBookmarkSidecars.validatedArtifacts(
            manifest, handle: "demo")

        XCTAssertEqual(
            validated.map(\.filename), ["asset-001.png", "screenshot-001.png"])
    }
}
