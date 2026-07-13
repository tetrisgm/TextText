import XCTest
@testable import WriteFileProviderKit

final class WriteItemIdentifierTests: XCTestCase {
    func testReservedIdentifiersUseApplesConstants() {
        // The extension bridges these to NSFileProviderItemIdentifier for free,
        // so the raw values must match Apple's documented constants exactly.
        XCTAssertEqual(
            WriteItemIdentifier.rootContainer.rawValue,
            "NSFileProviderRootContainerItemIdentifier")
        XCTAssertEqual(
            WriteItemIdentifier.workingSet.rawValue,
            "NSFileProviderWorkingSetContainerItemIdentifier")
        XCTAssertEqual(
            WriteItemIdentifier.trashContainer.rawValue,
            "NSFileProviderTrashContainerItemIdentifier")
    }

    func testWorkspaceFolderAndFileRoundTrip() {
        let ids: [WriteItemIdentifier] = [
            .workspace("demo"),
            .folder(handle: "demo", id: "blog"),
            .file(handle: "demo", id: "xyz-123"),
            // A server id containing a colon must survive: only the FIRST colon
            // (after the handle) is the boundary.
            .file(handle: "amber-quiet-fern", id: "id:with:colons"),
        ]
        for id in ids {
            let back = WriteItemIdentifier(rawValue: id.rawValue)
            XCTAssertEqual(back, id, "round trip failed for \(id.rawValue)")
        }
    }

    func testRawValueShape() {
        XCTAssertEqual(WriteItemIdentifier.workspace("demo").rawValue, "workspace:demo")
        XCTAssertEqual(WriteItemIdentifier.folder(handle: "demo", id: "blog").rawValue, "folder:demo:blog")
        XCTAssertEqual(WriteItemIdentifier.file(handle: "demo", id: "p1").rawValue, "file:demo:p1")
    }

    func testFirstColonSplitsHandleFromId() {
        // handle is colon-free (URL-safe); the id keeps every remaining colon.
        guard case .file(let handle, let id)? = WriteItemIdentifier(rawValue: "file:demo:a:b:c") else {
            return XCTFail("expected a file identifier")
        }
        XCTAssertEqual(handle, "demo")
        XCTAssertEqual(id, "a:b:c")
    }

    func testWorkspaceHandleExtraction() {
        XCTAssertEqual(WriteItemIdentifier.workspace("demo").workspaceHandle, "demo")
        XCTAssertEqual(WriteItemIdentifier.folder(handle: "h", id: "f").workspaceHandle, "h")
        XCTAssertEqual(WriteItemIdentifier.file(handle: "h", id: "p").workspaceHandle, "h")
        XCTAssertNil(WriteItemIdentifier.rootContainer.workspaceHandle)
        XCTAssertNil(WriteItemIdentifier.workingSet.workspaceHandle)
    }

    func testReservedRoundTrip() {
        for id in [WriteItemIdentifier.rootContainer, .workingSet, .trashContainer] {
            XCTAssertEqual(WriteItemIdentifier(rawValue: id.rawValue), id)
        }
    }

    func testMalformedIdentifiersAreRejected() {
        XCTAssertNil(WriteItemIdentifier(rawValue: "workspace:"))    // empty handle
        XCTAssertNil(WriteItemIdentifier(rawValue: "folder:demo"))   // no id
        XCTAssertNil(WriteItemIdentifier(rawValue: "folder::id"))    // empty handle
        XCTAssertNil(WriteItemIdentifier(rawValue: "folder:demo:"))  // empty id
        XCTAssertNil(WriteItemIdentifier(rawValue: "file:"))
        XCTAssertNil(WriteItemIdentifier(rawValue: "garbage"))
    }

    func testContainerClassification() {
        XCTAssertTrue(WriteItemIdentifier.rootContainer.isContainer)
        XCTAssertTrue(WriteItemIdentifier.workspace("demo").isContainer)
        XCTAssertTrue(WriteItemIdentifier.folder(handle: "demo", id: "x").isContainer)
        XCTAssertFalse(WriteItemIdentifier.file(handle: "demo", id: "x").isContainer)
    }
}
