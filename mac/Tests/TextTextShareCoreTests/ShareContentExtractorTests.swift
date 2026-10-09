import AppKit
import UniformTypeIdentifiers
import XCTest
import TextTextShareExtensionCore

final class ShareContentExtractorTests: XCTestCase {
    func testAlternateRepresentationsProduceOneFileAndKeepEveryProviderInOrder() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let original = Data("original file bytes".utf8)
        let source = root.appendingPathComponent("Original.jpg")
        try original.write(to: source)
        let first = NSItemProvider(item: source as NSURL, typeIdentifier: UTType.fileURL.identifier)
        first.registerDataRepresentation(forTypeIdentifier: UTType.jpeg.identifier, visibility: .all) { completion in
            completion(Data("alternate image representation".utf8), nil)
            return nil
        }
        let second = NSItemProvider()
        second.suggestedName = "Second"
        second.registerDataRepresentation(forTypeIdentifier: UTType.png.identifier, visibility: .all) { completion in
            completion(Data("second file bytes".utf8), nil)
            return nil
        }
        let done = expectation(description: "extracted every supplied file")
        ShareContentExtractor.extract(from: [first, second]) { result in
            do {
                let files = try result.get().payloads
                XCTAssertEqual(files.count, 2)
                XCTAssertEqual(files.first?.filename, "Original.jpg")
                XCTAssertEqual(files.first?.data, original)
                XCTAssertEqual(files.last?.filename, "Second.png")
                XCTAssertEqual(files.last?.data, Data("second file bytes".utf8))
            } catch { XCTFail("\(error)") }
            done.fulfill()
        }
        wait(for: [done], timeout: 10)
    }
}
