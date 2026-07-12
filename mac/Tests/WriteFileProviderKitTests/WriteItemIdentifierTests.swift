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

    func testFolderAndFileRoundTrip() {
        for id in [WriteItemIdentifier.folder("abc"), .file("xyz-123"), .folder("id:with:colons")] {
            let back = WriteItemIdentifier(rawValue: id.rawValue)
            XCTAssertEqual(back, id, "round trip failed for \(id.rawValue)")
        }
    }

    func testReservedRoundTrip() {
        for id in [WriteItemIdentifier.rootContainer, .workingSet, .trashContainer] {
            XCTAssertEqual(WriteItemIdentifier(rawValue: id.rawValue), id)
        }
    }

    func testEmptyIdsAreRejected() {
        XCTAssertNil(WriteItemIdentifier(rawValue: "folder:"))
        XCTAssertNil(WriteItemIdentifier(rawValue: "file:"))
        XCTAssertNil(WriteItemIdentifier(rawValue: "garbage"))
    }

    func testContainerClassification() {
        XCTAssertTrue(WriteItemIdentifier.rootContainer.isContainer)
        XCTAssertTrue(WriteItemIdentifier.folder("x").isContainer)
        XCTAssertFalse(WriteItemIdentifier.file("x").isContainer)
    }
}
