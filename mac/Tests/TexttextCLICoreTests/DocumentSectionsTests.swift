import XCTest
@testable import TexttextCLICore

final class DocumentSectionsTests: XCTestCase {
    private let document = """
        # Launch post

        Intro paragraph.

        ## Pricing

        Ten dollars a month.

        ### Discounts

        Students pay less.

        ## Availability

        Today.
        """

    func testParsesHeadingsWithLevels() {
        let sections = DocumentSections.parse(document)
        XCTAssertEqual(sections.map(\.title), ["Launch post", "Pricing", "Discounts", "Availability"])
        XCTAssertEqual(sections.map(\.level), [1, 2, 3, 2])
    }

    func testIgnoresHashesInsideFencedCode() {
        let withCode = """
            # Real

            ```sh
            # not a heading
            echo hi
            ```

            ## Also real
            """
        XCTAssertEqual(DocumentSections.parse(withCode).map(\.title), ["Real", "Also real"])
    }

    func testIgnoresHashtagWithoutSpace() {
        XCTAssertTrue(DocumentSections.parse("#nothing here").isEmpty)
    }

    func testASectionContainsItsDeeperChildren() {
        let pricing = DocumentSections.find("Pricing", in: document)
        let body = DocumentSections.body(of: XCTUnwrap2(pricing), in: document)
        XCTAssertTrue(body.contains("Ten dollars"))
        XCTAssertTrue(body.contains("### Discounts"), "a ## section should contain its ### children")
        XCTAssertFalse(body.contains("Today."), "it must stop at the next ## heading")
    }

    func testFindsByBareTitleAndByFullHeadingAndCaseInsensitively() {
        XCTAssertNotNil(DocumentSections.find("Pricing", in: document))
        XCTAssertNotNil(DocumentSections.find("## Pricing", in: document))
        XCTAssertNotNil(DocumentSections.find("pricing", in: document))
        XCTAssertNil(DocumentSections.find("Nonexistent", in: document))
    }

    // The load-bearing property: a section edit must be surgical, so a human
    // typing elsewhere and another agent in another section are unaffected.
    func testReplacingASectionLeavesEveryOtherByteAlone() {
        let section = XCTUnwrap2(DocumentSections.find("Pricing", in: document))
        let updated = DocumentSections.replaceBody(
            of: section, in: document, with: "Twelve dollars a month.")

        XCTAssertTrue(updated.contains("Twelve dollars a month."))
        XCTAssertFalse(updated.contains("Ten dollars a month."))
        // Everything outside the section survives verbatim.
        XCTAssertTrue(updated.contains("# Launch post"))
        XCTAssertTrue(updated.contains("Intro paragraph."))
        XCTAssertTrue(updated.contains("## Availability"))
        XCTAssertTrue(updated.contains("Today."))
        XCTAssertTrue(updated.contains("## Pricing"), "the heading itself is preserved")
    }

    func testReplacingTheLastSectionWorks() {
        let section = XCTUnwrap2(DocumentSections.find("Availability", in: document))
        let updated = DocumentSections.replaceBody(
            of: section, in: document, with: "Next week.")
        XCTAssertTrue(updated.contains("Next week."))
        XCTAssertFalse(updated.contains("Today."))
        XCTAssertTrue(updated.contains("Ten dollars a month."))
    }

    func testReplacementKeepsCanonicalBlankLines() {
        // An edit must not reflow the document around the section it touched.
        let section = XCTUnwrap2(DocumentSections.find("Pricing", in: document))
        let updated = DocumentSections.replaceBody(
            of: section, in: document, with: "Twelve dollars a month.")

        XCTAssertTrue(
            updated.contains("## Pricing\n\nTwelve dollars a month."),
            "a blank line must follow the heading, as in the original")
        XCTAssertTrue(
            updated.contains("Twelve dollars a month.\n\n## Availability"),
            "a blank line must precede the next heading")
    }

    func testHeadingsStaySeparatedAfterReplacement() {
        let section = XCTUnwrap2(DocumentSections.find("Pricing", in: document))
        let updated = DocumentSections.replaceBody(
            of: section, in: document, with: "Cheap.")
        XCTAssertFalse(
            updated.contains("Cheap.## Availability"),
            "a replacement must not glue itself to the following heading")
    }

    func testEditingTwoDifferentSectionsComposes() {
        // Two agents, two sections, one document: neither loses the other's work.
        let first = XCTUnwrap2(DocumentSections.find("Pricing", in: document))
        let afterFirst = DocumentSections.replaceBody(
            of: first, in: document, with: "Twelve dollars.")
        let second = XCTUnwrap2(DocumentSections.find("Availability", in: afterFirst))
        let afterSecond = DocumentSections.replaceBody(
            of: second, in: afterFirst, with: "Next week.")

        XCTAssertTrue(afterSecond.contains("Twelve dollars."))
        XCTAssertTrue(afterSecond.contains("Next week."))
    }

    private func XCTUnwrap2<T>(_ value: T?, file: StaticString = #filePath, line: UInt = #line) -> T {
        guard let value else {
            XCTFail("unexpected nil", file: file, line: line)
            fatalError("unreachable")
        }
        return value
    }
}
