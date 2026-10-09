import Foundation
import XCTest
@testable import TextTextApp

/// The vault window refused every non-entry navigation, which silently dropped the
/// recovery JSON the editor offers through a blob anchor with a download attribute.
final class LocalVaultDownloadTests: XCTestCase {
    private let entry = URL(fileURLWithPath: "/Applications/TextText.app/Contents/Resources/vault/index.html")

    func testDownloadNavigationsBecomeDownloadsAndOthersKeepTheirPolicy() {
        let blob = URL(string: "blob:null/8f0e2c2a-recovery")!
        XCTAssertEqual(LocalVaultWindowController.navigationDecision(url: blob, shouldPerformDownload: true, entry: entry), .download)
        XCTAssertEqual(LocalVaultWindowController.navigationDecision(url: nil, shouldPerformDownload: true, entry: entry), .download)
        // Without the download attribute a blob navigation is still refused.
        XCTAssertEqual(LocalVaultWindowController.navigationDecision(url: blob, shouldPerformDownload: false, entry: entry), .cancel)
        XCTAssertEqual(LocalVaultWindowController.navigationDecision(url: nil, shouldPerformDownload: false, entry: entry), .cancel)
        XCTAssertEqual(LocalVaultWindowController.navigationDecision(url: entry, shouldPerformDownload: false, entry: entry), .allow)
        let web = URL(string: "https://texttext.app/docs")!
        XCTAssertEqual(LocalVaultWindowController.navigationDecision(url: web, shouldPerformDownload: false, entry: entry), .openExternally(web))
        XCTAssertEqual(LocalVaultWindowController.navigationDecision(url: URL(fileURLWithPath: "/etc/passwd"), shouldPerformDownload: false, entry: entry), .cancel)
    }

    func testDownloadFileNameKeepsOnlyASafeLastComponent() {
        XCTAssertEqual(LocalVaultWindowController.downloadFileName(suggested: "TextText document recovery.json"), "TextText document recovery.json")
        XCTAssertEqual(LocalVaultWindowController.downloadFileName(suggested: "../../evil/recovery.json"), "recovery.json")
        XCTAssertEqual(LocalVaultWindowController.downloadFileName(suggested: ""), "TextText download")
        XCTAssertEqual(LocalVaultWindowController.downloadFileName(suggested: ".."), "TextText download")
    }
}
