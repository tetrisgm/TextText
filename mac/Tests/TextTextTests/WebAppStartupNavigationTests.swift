import XCTest
@testable import TextTextApp

final class WebAppStartupNavigationTests: XCTestCase {
    func testFinderItemReplacesWorkspaceRootBeforeColdLaunchNavigationStarts() {
        var navigation = WebAppStartupNavigation(path: "/start?to=home")

        XCTAssertTrue(navigation.replaceBeforeStart(
            with: "/t/workspace/for-codex?edit=1&id=note-id"
        ))
        XCTAssertEqual(
            navigation.begin(),
            "/t/workspace/for-codex?edit=1&id=note-id"
        )
    }

    func testLaterNavigationLoadsNormallyAfterStartupBegins() {
        var navigation = WebAppStartupNavigation(path: "/start?to=home")

        XCTAssertEqual(navigation.begin(), "/start?to=home")
        XCTAssertFalse(navigation.replaceBeforeStart(with: "/t/workspace/note"))
        XCTAssertEqual(navigation.path, "/start?to=home")
    }
}
