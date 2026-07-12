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

    func testStoreAccessGroupReadsEnvOverride() {
        setenv("WRITE_KEYCHAIN_GROUP", "TEAMID123.net.writeapp.write.fp", 1)
        defer { unsetenv("WRITE_KEYCHAIN_GROUP") }
        XCTAssertEqual(FileProviderHandoffStore.accessGroup(), "TEAMID123.net.writeapp.write.fp")
    }

    func testStoreSaveFailsWithoutAccessGroup() {
        // No env override and no Info.plist key in the test bundle -> no group ->
        // the store cannot write, and reports it rather than silently succeeding.
        unsetenv("WRITE_KEYCHAIN_GROUP")
        XCTAssertNil(FileProviderHandoffStore.accessGroup())
        XCTAssertFalse(FileProviderHandoffStore.save(
            FileProviderHandoff(origin: "https://x", token: "wsk_x", handle: "h")))
        XCTAssertNil(FileProviderHandoffStore.load())
    }
}
