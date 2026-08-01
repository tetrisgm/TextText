import Foundation
import XCTest
@testable import TextTextEditor

/// Golden evals for the Writing Tools contract (plan section 9): prose is
/// rewritable, but fenced code, inline code, and machine syntax must survive
/// a rewrite untouched. `MarkdownProtectedRangeFinder` computes the ranges the
/// editor hands to `writingToolsIgnoredRangesInEnclosingRange`, so these cases
/// pin exactly which spans are protected.
final class WritingToolsProtectionEvalTests: XCTestCase {
    private func fullRange(_ text: String) -> NSRange {
        NSRange(location: 0, length: (text as NSString).length)
    }

    private func protectedSubstrings(in text: String) -> [String] {
        let ns = text as NSString
        return MarkdownProtectedRangeFinder
            .protectedRanges(in: text, enclosingRange: fullRange(text))
            .map { ns.substring(with: $0) }
    }

    func testProseWithNoCodeHasNothingProtected() {
        let text = "Just prose that Writing Tools may freely rewrite.\n\nA second paragraph."
        XCTAssertEqual(protectedSubstrings(in: text), [])
    }

    func testFencedCodeBlockIsFullyProtected() {
        let text = """
        Intro prose.

        ```swift
        let answer = 42
        print(answer)
        ```

        Closing prose.
        """
        let protectedText = protectedSubstrings(in: text).joined()
        XCTAssertTrue(protectedText.contains("let answer = 42"))
        XCTAssertTrue(protectedText.contains("```swift"))
        XCTAssertTrue(protectedText.contains("```"))
        XCTAssertFalse(protectedText.contains("Intro prose"))
        XCTAssertFalse(protectedText.contains("Closing prose"))
    }

    func testInlineCodeIsProtectedButSurroundingProseIsNot() {
        let text = "Call `URLSession.shared` before `resume()` to start."
        let protectedText = protectedSubstrings(in: text)
        XCTAssertTrue(protectedText.contains("`URLSession.shared`"))
        XCTAssertTrue(protectedText.contains("`resume()`"))
        XCTAssertFalse(protectedText.joined().contains("before"))
    }

    func testInlineBackticksInsideAFenceAreNotDoubleCounted() {
        // The fence owns the whole block; the backticks in its body must not
        // spawn a second, overlapping inline-code range.
        let text = """
        ```
        echo `date` > out.txt
        ```
        """
        let ranges = MarkdownProtectedRangeFinder.protectedRanges(
            in: text, enclosingRange: fullRange(text))
        XCTAssertEqual(ranges.count, 1, "one fence, not a fence plus stray inline ranges")
    }

    func testUnclosedFenceProtectsToEndOfDocument() {
        let text = """
        Prose.

        ```
        never closed
        still code
        """
        let protectedText = protectedSubstrings(in: text).joined()
        XCTAssertTrue(protectedText.contains("never closed"))
        XCTAssertTrue(protectedText.contains("still code"))
    }

    func testTildeFencesAreProtected() {
        let text = """
        ~~~
        tilde fenced body
        ~~~
        """
        XCTAssertTrue(protectedSubstrings(in: text).joined().contains("tilde fenced body"))
    }

    func testEnclosingRangeClipsProtectedSpansToTheRewriteSelection() {
        let text = "prefix `code` suffix"
        let ns = text as NSString
        // A selection that ends inside the inline code must not report a
        // protected range reaching past the selection.
        let selection = NSRange(location: 0, length: ns.range(of: "`code`").location + 3)
        let ranges = MarkdownProtectedRangeFinder.protectedRanges(in: text, enclosingRange: selection)
        for range in ranges {
            XCTAssertLessThanOrEqual(NSMaxRange(range), NSMaxRange(selection))
        }
    }

    func testNotFoundEnclosingRangeFallsBackToWholeDocument() {
        let text = "Use `x` here."
        let ranges = MarkdownProtectedRangeFinder.protectedRanges(
            in: text, enclosingRange: NSRange(location: NSNotFound, length: 0))
        XCTAssertFalse(ranges.isEmpty, "NSNotFound means the whole document is in scope")
    }
}
