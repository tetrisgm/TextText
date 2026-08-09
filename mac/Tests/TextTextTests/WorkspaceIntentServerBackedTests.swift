import Foundation
import XCTest
@testable import TextTextApp

final class WorkspaceIntentServerBackedTests: XCTestCase {
    func testManifestDecodesCanonicalURL() throws {
        let data = Data("""
        {
          "file":"posts/hello.textpack",
          "kind":"article",
          "slug":"hello",
          "title":"Hello",
          "status":"published",
          "hash":"hash-1",
          "id":"post-1",
          "canonicalUrl":"https://texttext.example/t/demo/hello"
        }
        """.utf8)

        let item = try JSONDecoder().decode(ManifestItem.self, from: data)

        XCTAssertEqual(
            item.canonicalUrl, "https://texttext.example/t/demo/hello")
    }

    func testManifestMappingUsesPublicCanonicalURLNotSyncTransportURL() throws {
        let item = ManifestItem(
            file: "posts/hello.textpack",
            kind: "article",
            slug: "hello",
            title: "Hello",
            status: "published",
            hash: "hash-1",
            id: "post-1",
            date: nil,
            createdAt: nil,
            updatedAt: nil,
            url: "/api/sync/v1/files/post-1",
            canonicalUrl: "https://texttext.example/t/demo/hello")

        let mapped = try XCTUnwrap(
            ServerBackedWorkspaceIntentServer.serverItem(
                from: item, folderId: "blog"))

        XCTAssertEqual(mapped.canonicalURL, URL(string: "https://texttext.example/t/demo/hello"))
    }

    func testManifestMappingDoesNotExposeSyncTransportAsPublicURL() throws {
        let item = ManifestItem(
            file: "posts/private.textpack",
            kind: "note",
            slug: "private",
            title: "Private",
            status: "draft",
            hash: "hash-2",
            id: "post-2",
            date: nil,
            createdAt: nil,
            updatedAt: nil,
            url: "/api/sync/v1/files/post-2")

        let mapped = try XCTUnwrap(
            ServerBackedWorkspaceIntentServer.serverItem(
                from: item, folderId: "notes"))

        XCTAssertNil(mapped.canonicalURL)
    }

    func testSpotlightSignatureAndPathChangeWhenDocumentMoves() {
        let item = ManifestItem(
            file: "posts/hello.textpack",
            kind: "article",
            slug: "hello",
            title: "Hello World",
            status: "draft",
            hash: "same-hash",
            id: "post-1",
            date: nil,
            createdAt: nil,
            updatedAt: nil,
            url: "/api/sync/v1/files/post-1")
        let blog = WorkspaceFolder(
            id: "blog", name: "Blog", path: "blog", mode: "blog",
            parentId: nil)
        let archive = WorkspaceFolder(
            id: "archive", name: "Archive", path: "blog/archive",
            mode: "blog", parentId: "blog")
        let workspace = Workspace(
            blog: WorkspaceBlog(handle: "demo", name: "Demo", username: nil),
            folders: [blog, archive])

        XCTAssertNotEqual(
            AppDelegate.spotlightSignature(
                item: item, folder: blog, workspace: workspace),
            AppDelegate.spotlightSignature(
                item: item, folder: archive, workspace: workspace))
        XCTAssertEqual(
            AppDelegate.spotlightRelativePath(
                item: item, folder: archive, workspace: workspace),
            "Demo/Blog/Archive/Hello World.textpack")

        let renamed = Workspace(
            blog: WorkspaceBlog(
                handle: "demo", name: "Renamed", username: nil),
            folders: workspace.folders)
        XCTAssertNotEqual(
            AppDelegate.spotlightSignature(
                item: item, folder: archive, workspace: workspace),
            AppDelegate.spotlightSignature(
                item: item, folder: archive, workspace: renamed))
    }
}
