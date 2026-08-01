import Foundation
import XCTest

final class SoleWriterInvariantTests: XCTestCase {
    func testGUIAppNeverConstructsLegacySyncEngine() throws {
        let macDirectory = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let writeSources = macDirectory.appendingPathComponent(
            "Sources/TextText", isDirectory: true)
        let enumerator = try XCTUnwrap(
            FileManager.default.enumerator(
                at: writeSources,
                includingPropertiesForKeys: [.isRegularFileKey],
                options: [.skipsHiddenFiles]))
        let pattern = try NSRegularExpression(pattern: #"\bSyncEngine\s*\("#)
        var violations: [String] = []

        for case let fileURL as URL in enumerator {
            guard fileURL.pathExtension == "swift",
                  fileURL.lastPathComponent != "Headless.swift" else { continue }
            let source = try String(contentsOf: fileURL, encoding: .utf8)
            for (offset, line) in source.split(
                separator: "\n", omittingEmptySubsequences: false
            ).enumerated() {
                let value = String(line)
                let range = NSRange(value.startIndex..., in: value)
                if pattern.firstMatch(in: value, range: range) != nil {
                    let relative = fileURL.path.replacingOccurrences(
                        of: macDirectory.path + "/", with: "")
                    violations.append("\(relative):\(offset + 1)")
                }
            }
        }

        XCTAssertTrue(
            violations.isEmpty,
            "The File Provider extension is the sole GUI writer. SyncEngine may "
                + "only be constructed by Sources/TextText/Headless.swift. Found: "
                + violations.joined(separator: ", "))
    }
}
