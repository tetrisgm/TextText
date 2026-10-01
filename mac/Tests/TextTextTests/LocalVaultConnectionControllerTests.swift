import XCTest
@testable import TextTextApp

final class LocalVaultConnectionControllerTests: XCTestCase {
    @MainActor
    func testSuccessfulIdleWatchClearsOnlyWatchFailureOnce() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let connection = LocalVaultConnectionController(root: root, credentials: { nil })
        let retry = "Changes are saved on this Mac. The web connection will retry."
        var notices: [String?] = []
        connection.onChange = { status, changed in
            XCTAssertFalse(changed)
            notices.append(status["message"] as? String)
        }

        connection.watchDidFail()
        connection.watchDidFail()
        XCTAssertEqual(connection.message, retry)
        XCTAssertEqual(notices, [retry])
        connection.watchDidSucceed() // A 304 unchanged wait is still a successful connection.
        connection.watchDidSucceed()
        XCTAssertNil(connection.message)
        XCTAssertEqual(notices, [retry, nil])

        connection.recordSyncMessage("A sync error")
        connection.watchDidFail()
        connection.watchDidSucceed()
        XCTAssertEqual(connection.message, "A sync error")
        XCTAssertEqual(notices.count, 2)
        connection.recordSyncMessage("Conflicting edits were kept in recovery copies.")
        connection.watchDidSucceed()
        XCTAssertEqual(connection.message, "Conflicting edits were kept in recovery copies.")
        connection.recordSyncMessage(retry) // The sync failure can use the same copy.
        connection.watchDidSucceed()
        XCTAssertEqual(connection.message, retry)
        XCTAssertEqual(notices.count, 2)

        connection.recordSyncMessage(nil)
        connection.watchDidFail()
        connection.watchDidSucceed()
        XCTAssertEqual(notices, [retry, nil, retry, nil])
    }
}
