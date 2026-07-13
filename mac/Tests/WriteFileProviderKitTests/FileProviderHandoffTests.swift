import XCTest
@testable import WriteFileProviderKit

final class FileProviderHandoffTests: XCTestCase {
    func testRoundTrip() {
        let handoff = FileProviderHandoff(
            origin: "https://write.ramine.net", token: "wsk_test_123", handle: "demo", name: "Demo")
        guard let data = handoff.encoded() else { return XCTFail("encode failed") }
        let back = FileProviderHandoff.decode(data)
        XCTAssertEqual(back, handoff)
        XCTAssertEqual(back?.workspaces.count, 1)
        XCTAssertEqual(back?.descriptor(for: "demo")?.token, "wsk_test_123")
    }

    func testMultiWorkspaceRoundTrip() {
        let handoff = FileProviderHandoff(version: 1, workspaces: [
            FileProviderWorkspace(name: "One", handle: "one", origin: "https://x", token: "wsk_1"),
            FileProviderWorkspace(name: "Two", handle: "two", origin: "https://x", token: "wsk_2"),
        ])
        guard let data = handoff.encoded() else { return XCTFail() }
        let back = FileProviderHandoff.decode(data)
        XCTAssertEqual(back, handoff)
        XCTAssertEqual(back?.descriptor(for: "two")?.token, "wsk_2")
        XCTAssertNil(back?.descriptor(for: "missing"))
    }

    func testLegacyFlatShapeDecodes() {
        // An older app wrote {origin, token, handle}; a new extension reading it
        // before the app republishes must still authenticate.
        let legacy = Data("""
        {"origin":"https://write.ramine.net","token":"wsk_old","handle":"demo"}
        """.utf8)
        guard let handoff = FileProviderHandoff.decode(legacy) else {
            return XCTFail("legacy shape must decode")
        }
        XCTAssertEqual(handoff.workspaces.count, 1)
        XCTAssertEqual(handoff.descriptor(for: "demo")?.token, "wsk_old")
        XCTAssertEqual(handoff.descriptor(for: "demo")?.name, "demo")
    }

    func testDecodeRejectsGarbage() {
        XCTAssertNil(FileProviderHandoff.decode(Data("not json".utf8)))
    }

    func testStoreAccessGroupReadsEnvOverride() {
        setenv("WRITE_KEYCHAIN_GROUP", "TEAMID123.net.writeapp.write.fp", 1)
        defer { unsetenv("WRITE_KEYCHAIN_GROUP") }
        XCTAssertEqual(FileProviderHandoffStore.accessGroup(), "TEAMID123.net.writeapp.write.fp")
    }

    func testStoreSaveFailsWithoutAccessGroup() {
        unsetenv("WRITE_KEYCHAIN_GROUP")
        XCTAssertNil(FileProviderHandoffStore.accessGroup())
        XCTAssertFalse(FileProviderHandoffStore.save(
            FileProviderHandoff(origin: "https://x", token: "wsk_x", handle: "h")))
        XCTAssertNil(FileProviderHandoffStore.load())
    }
}
