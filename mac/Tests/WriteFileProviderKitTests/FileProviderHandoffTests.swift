import XCTest
@testable import WriteFileProviderKit

final class FileProviderHandoffTests: XCTestCase {
    func testRoundTrip() {
        let handoff = FileProviderHandoff(
            origin: "https://write.ramine.net", token: "wsk_test_123", handle: "demo")
        guard let data = handoff.encoded() else { return XCTFail("encode failed") }
        XCTAssertEqual(FileProviderHandoff.decode(data), handoff)
    }

    func testDecodeRejectsGarbage() {
        XCTAssertNil(FileProviderHandoff.decode(Data("not json".utf8)))
    }

    func testFilenameIsStable() {
        // Both app (writer) and extension (reader) hardcode this; it must not drift.
        XCTAssertEqual(FileProviderHandoff.filename, "fileprovider-credentials.json")
    }
}
