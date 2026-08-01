import XCTest
@testable import TextTextFileProviderKit

final class TextTextItemIdentifierTests: XCTestCase {
    func testReservedIdentifiersUseApplesConstants() {
        // The extension bridges these to NSFileProviderItemIdentifier for free,
        // so the raw values must match Apple's documented constants exactly.
        XCTAssertEqual(
            TextTextItemIdentifier.rootContainer.rawValue,
            "NSFileProviderRootContainerItemIdentifier")
        XCTAssertEqual(
            TextTextItemIdentifier.workingSet.rawValue,
            "NSFileProviderWorkingSetContainerItemIdentifier")
        XCTAssertEqual(
            TextTextItemIdentifier.trashContainer.rawValue,
            "NSFileProviderTrashContainerItemIdentifier")
    }

    func testWorkspaceFolderAndFileRoundTrip() {
        let ids: [TextTextItemIdentifier] = [
            .workspace("demo"),
            .folder(handle: "demo", id: "blog"),
            .file(handle: "demo", id: "xyz-123"),
            // A server id containing a colon must survive: only the FIRST colon
            // (after the handle) is the boundary.
            .file(handle: "amber-quiet-fern", id: "id:with:colons"),
        ]
        for id in ids {
            let back = TextTextItemIdentifier(rawValue: id.rawValue)
            XCTAssertEqual(back, id, "round trip failed for \(id.rawValue)")
        }
    }

    func testCentralAttachmentIdentifiersRoundTripUnsafeFilenameCharacters() {
        let ids: [TextTextItemIdentifier] = [
            .dataContainer,
            .attachmentsContainer,
            .attachmentWorkspace("user/name??"),
            .attachmentItem(handle: "user/name??", id: "post:?/\\id"),
            .attachmentFile(
                handle: "user/name??", id: "post:?/\\id",
                filename: "what?? #1.png"),
        ]
        for id in ids {
            XCTAssertEqual(TextTextItemIdentifier(rawValue: id.rawValue), id)
        }
        XCTAssertFalse(ids.last!.rawValue.contains("what??"))
    }

    func testRawValueShape() {
        XCTAssertEqual(TextTextItemIdentifier.workspace("demo").rawValue, "workspace:demo")
        XCTAssertEqual(TextTextItemIdentifier.folder(handle: "demo", id: "blog").rawValue, "folder:demo:blog")
        XCTAssertEqual(TextTextItemIdentifier.file(handle: "demo", id: "p1").rawValue, "file:demo:p1")
    }

    func testFirstColonSplitsHandleFromId() {
        // handle is colon-free (URL-safe); the id keeps every remaining colon.
        guard case .file(let handle, let id)? = TextTextItemIdentifier(rawValue: "file:demo:a:b:c") else {
            return XCTFail("expected a file identifier")
        }
        XCTAssertEqual(handle, "demo")
        XCTAssertEqual(id, "a:b:c")
    }

    func testWorkspaceHandleExtraction() {
        XCTAssertEqual(TextTextItemIdentifier.workspace("demo").workspaceHandle, "demo")
        XCTAssertEqual(TextTextItemIdentifier.folder(handle: "h", id: "f").workspaceHandle, "h")
        XCTAssertEqual(TextTextItemIdentifier.file(handle: "h", id: "p").workspaceHandle, "h")
        XCTAssertNil(TextTextItemIdentifier.rootContainer.workspaceHandle)
        XCTAssertNil(TextTextItemIdentifier.workingSet.workspaceHandle)
        XCTAssertEqual(
            TextTextItemIdentifier.attachmentFile(
                handle: "h", id: "p", filename: "a.png").workspaceHandle,
            "h")
    }

    func testReservedRoundTrip() {
        for id in [TextTextItemIdentifier.rootContainer, .workingSet, .trashContainer] {
            XCTAssertEqual(TextTextItemIdentifier(rawValue: id.rawValue), id)
        }
    }

    func testMalformedIdentifiersAreRejected() {
        XCTAssertNil(TextTextItemIdentifier(rawValue: "workspace:"))    // empty handle
        XCTAssertNil(TextTextItemIdentifier(rawValue: "folder:demo"))   // no id
        XCTAssertNil(TextTextItemIdentifier(rawValue: "folder::id"))    // empty handle
        XCTAssertNil(TextTextItemIdentifier(rawValue: "folder:demo:"))  // empty id
        XCTAssertNil(TextTextItemIdentifier(rawValue: "file:"))
        XCTAssertNil(TextTextItemIdentifier(rawValue: "garbage"))
    }

    func testContainerClassification() {
        XCTAssertTrue(TextTextItemIdentifier.rootContainer.isContainer)
        XCTAssertTrue(TextTextItemIdentifier.workspace("demo").isContainer)
        XCTAssertTrue(TextTextItemIdentifier.folder(handle: "demo", id: "x").isContainer)
        XCTAssertTrue(TextTextItemIdentifier.dataContainer.isContainer)
        XCTAssertTrue(TextTextItemIdentifier.attachmentsContainer.isContainer)
        XCTAssertTrue(TextTextItemIdentifier.attachmentItem(handle: "demo", id: "x").isContainer)
        XCTAssertFalse(TextTextItemIdentifier.file(handle: "demo", id: "x").isContainer)
        XCTAssertFalse(TextTextItemIdentifier.attachmentFile(
            handle: "demo", id: "x", filename: "a.png").isContainer)
    }
}
