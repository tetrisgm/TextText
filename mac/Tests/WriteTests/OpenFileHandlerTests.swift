import Foundation
import XCTest
@testable import Write

final class OpenFileHandlerTests: XCTestCase {
    func testWorkspaceMarkdownIsMetadataAware() {
        let root = URL(fileURLWithPath: "/tmp/write-workspace", isDirectory: true)
        let file = root.appendingPathComponent("Notes/Item.MD")
        XCTAssertEqual(OpenFileHandler.kind(for: file, syncRoot: root), .workspace)
    }

    func testExternalTextFormatsOpenLiterally() {
        let root = URL(fileURLWithPath: "/tmp/write-workspace", isDirectory: true)
        for name in ["note.md", "note.markdown", "note.txt", "NOTE.TXT"] {
            let file = URL(fileURLWithPath: "/tmp/outside/\(name)")
            XCTAssertEqual(
                OpenFileHandler.kind(for: file, syncRoot: root),
                .external,
                name
            )
        }
    }

    func testUnsupportedFilesAreRejected() {
        let root = URL(fileURLWithPath: "/tmp/write-workspace", isDirectory: true)
        let file = URL(fileURLWithPath: "/tmp/outside/image.png")
        XCTAssertEqual(OpenFileHandler.kind(for: file, syncRoot: root), .unsupported)
    }

    func testInternalWorkspaceMetadataIsNotOpenedAsContent() {
        let root = URL(fileURLWithPath: "/tmp/write-workspace", isDirectory: true)
        let file = root.appendingPathComponent(".write-local.nosync/state/index.md")
        XCTAssertEqual(OpenFileHandler.kind(for: file, syncRoot: root), .unsupported)
    }

    func testOnlyWriteFileProviderFileIdentifiersAreManaged() {
        XCTAssertTrue(OpenFileHandler.isWriteFileProviderItem("file:workspace:item-id"))
        XCTAssertFalse(OpenFileHandler.isWriteFileProviderItem("folder:workspace:folder-id"))
        XCTAssertFalse(OpenFileHandler.isWriteFileProviderItem("unrelated-provider-id"))
        XCTAssertFalse(OpenFileHandler.isWriteFileProviderItem(nil))
    }
}
