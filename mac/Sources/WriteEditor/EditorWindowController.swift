import AppKit
import Foundation

public final class EditorWindowController: NSWindowController, NSTextViewDelegate, NSTextFieldDelegate, NSWindowDelegate {
    private let editorDocument: EditorDocument
    private let onClose: ((URL) -> Void)?
    private let titleField = NSTextField()
    private let subtitleField = NSTextField(labelWithString: "")
    private let textView = NSTextView(usingTextLayoutManager: true)
    private var autosaveWorkItem: DispatchWorkItem?
    private var externalChangeWorkItem: DispatchWorkItem?
    private var applyingDocumentState = false

    public convenience init(
        fileURL: URL,
        workspaceRootURL: URL,
        onClose: ((URL) -> Void)? = nil
    ) throws {
        try self.init(
            editorDocument: EditorDocument(
                fileURL: fileURL, workspaceRootURL: workspaceRootURL),
            onClose: onClose
        )
    }

    public convenience init(
        standaloneFileURL: URL,
        onClose: ((URL) -> Void)? = nil
    ) throws {
        try self.init(
            editorDocument: EditorDocument(standaloneFileURL: standaloneFileURL),
            onClose: onClose
        )
    }

    private init(
        editorDocument: EditorDocument,
        onClose: ((URL) -> Void)?
    ) {
        self.editorDocument = editorDocument
        self.onClose = onClose

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 820, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = editorDocument.title.isEmpty
            ? editorDocument.fileURL.lastPathComponent
            : editorDocument.title
        window.minSize = NSSize(width: 520, height: 360)

        super.init(window: window)

        window.delegate = self
        buildInterface(in: window)
        applyDocumentState()
        configureWritingTools()
        // The document delivers this on the main queue already.
        editorDocument.setExternalChangeHandler { [weak self] in
            self?.scheduleExternalChangeCheck()
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    public func present() {
        NSApp.activate(ignoringOtherApps: true)
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
        textView.window?.makeFirstResponder(textView)
    }

    public func textDidChange(_ notification: Notification) {
        guard !applyingDocumentState else { return }
        editorDocument.setBody(textView.string)
        scheduleAutosave()
    }

    public func controlTextDidChange(_ notification: Notification) {
        guard !applyingDocumentState else { return }
        editorDocument.setTitle(titleField.stringValue)
        window?.title = titleField.stringValue.isEmpty ? editorDocument.fileURL.lastPathComponent : titleField.stringValue
        scheduleAutosave()
    }

    public func windowWillClose(_ notification: Notification) {
        autosaveWorkItem?.cancel()
        externalChangeWorkItem?.cancel()
        if editorDocument.isDirty {
            if let recoveryURL = editorDocument.saveOrRecover() {
                NSLog(
                    "Texttext editor: save at close failed; buffer preserved at %@",
                    recoveryURL.path
                )
            }
        }
        editorDocument.setExternalChangeHandler(nil)
        onClose?(editorDocument.fileURL)
    }

    @available(macOS 15.0, *)
    public func textView(_ textView: NSTextView, writingToolsIgnoredRangesInEnclosingRange enclosingRange: NSRange) -> [NSValue] {
        MarkdownProtectedRangeFinder.protectedRanges(in: textView.string, enclosingRange: enclosingRange)
            .map { NSValue(range: $0) }
    }

    private func buildInterface(in window: NSWindow) {
        let contentView = NSView()
        contentView.translatesAutoresizingMaskIntoConstraints = false
        window.contentView = contentView

        titleField.translatesAutoresizingMaskIntoConstraints = false
        titleField.isBordered = false
        titleField.isBezeled = false
        titleField.drawsBackground = false
        titleField.font = NSFont.systemFont(ofSize: 24, weight: .semibold)
        titleField.lineBreakMode = .byTruncatingTail
        titleField.delegate = self
        titleField.isEditable = editorDocument.allowsTitleEditing
        titleField.isSelectable = true
        titleField.cell?.sendsActionOnEndEditing = false
        titleField.setAccessibilityLabel("Title")

        subtitleField.translatesAutoresizingMaskIntoConstraints = false
        subtitleField.font = NSFont.systemFont(ofSize: 12)
        subtitleField.textColor = .secondaryLabelColor
        subtitleField.lineBreakMode = .byTruncatingMiddle
        subtitleField.setAccessibilityLabel("Document status")

        textView.delegate = self
        textView.isEditable = true
        textView.isRichText = false
        textView.importsGraphics = false
        textView.allowsUndo = true
        textView.font = NSFont.monospacedSystemFont(ofSize: 14, weight: .regular)
        textView.textColor = .labelColor
        textView.backgroundColor = .textBackgroundColor
        textView.isContinuousSpellCheckingEnabled = true
        textView.isGrammarCheckingEnabled = true
        textView.isAutomaticSpellingCorrectionEnabled = true
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = true
        textView.isAutomaticLinkDetectionEnabled = true
        textView.textContainerInset = NSSize(width: 24, height: 20)
        textView.setAccessibilityLabel("Markdown body")
        textView.minSize = NSSize(width: 0, height: 0)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = true
        textView.textContainer?.containerSize = NSSize(width: 0, height: CGFloat.greatestFiniteMagnitude)

        let scrollView = NSScrollView()
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.hasVerticalScroller = true
        scrollView.drawsBackground = true
        scrollView.borderType = .noBorder
        scrollView.documentView = textView

        contentView.addSubview(titleField)
        contentView.addSubview(subtitleField)
        contentView.addSubview(scrollView)

        NSLayoutConstraint.activate([
            titleField.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 20),
            titleField.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 24),
            titleField.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -24),

            subtitleField.topAnchor.constraint(equalTo: titleField.bottomAnchor, constant: 4),
            subtitleField.leadingAnchor.constraint(equalTo: titleField.leadingAnchor),
            subtitleField.trailingAnchor.constraint(equalTo: titleField.trailingAnchor),

            scrollView.topAnchor.constraint(equalTo: subtitleField.bottomAnchor, constant: 14),
            scrollView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
        ])
    }

    private func applyDocumentState() {
        applyingDocumentState = true
        titleField.stringValue = editorDocument.title
        textView.string = editorDocument.body
        window?.title = editorDocument.title.isEmpty ? editorDocument.fileURL.lastPathComponent : editorDocument.title
        subtitleField.stringValue = editorDocument.fileURL.path
        applyingDocumentState = false
    }

    private func configureWritingTools() {
        if #available(macOS 15.0, *),
           textView.responds(to: Selector(("setWritingToolsBehavior:"))) {
            textView.writingToolsBehavior = .complete
            textView.allowedWritingToolsResultOptions = .plainText
        }
    }

    private func scheduleAutosave() {
        autosaveWorkItem?.cancel()
        subtitleField.stringValue = "Edited"
        let workItem = DispatchWorkItem { [weak self] in
            self?.saveNow()
        }
        autosaveWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0, execute: workItem)
    }

    private func saveNow() {
        do {
            try editorDocument.save()
            subtitleField.stringValue = "Saved"
        } catch {
            subtitleField.stringValue = "Save failed: \(error.localizedDescription)"
        }
    }

    private func scheduleExternalChangeCheck() {
        externalChangeWorkItem?.cancel()
        let workItem = DispatchWorkItem { [weak self] in
            self?.handleExternalChange()
        }
        externalChangeWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: workItem)
    }

    private func handleExternalChange() {
        do {
            switch try editorDocument.handleExternalChange() {
            case .unchanged:
                break
            case .reloaded:
                applyDocumentState()
                subtitleField.stringValue = "Reloaded from disk"
            case .conflictedCopy(let url):
                subtitleField.stringValue = "External version saved as \(url.lastPathComponent)"
            case .mergedIdentity:
                applyingDocumentState = true
                titleField.stringValue = editorDocument.title
                window?.title = editorDocument.title.isEmpty
                    ? editorDocument.fileURL.lastPathComponent
                    : editorDocument.title
                applyingDocumentState = false
                subtitleField.stringValue = "Synced metadata from the server"
            }
        } catch {
            subtitleField.stringValue = "External change check failed: \(error.localizedDescription)"
        }
    }
}

enum MarkdownProtectedRangeFinder {
    static func protectedRanges(in text: String, enclosingRange: NSRange) -> [NSRange] {
        let full = NSRange(location: 0, length: (text as NSString).length)
        let enclosing = enclosingRange.location == NSNotFound ? full : full.intersection(enclosingRange)
        guard let enclosing else { return [] }
        guard enclosing.length > 0 else { return [] }

        var ranges = fencedCodeRanges(in: text)
        ranges.append(contentsOf: inlineCodeRanges(in: text, excluding: ranges))
        return ranges.compactMap { $0.intersection(enclosing) }
    }

    private static func fencedCodeRanges(in text: String) -> [NSRange] {
        let nsText = text as NSString
        let length = nsText.length
        var ranges: [NSRange] = []
        var cursor = 0
        var openFence: (character: unichar, count: Int, location: Int)?

        while cursor < length {
            let lineRange = nsText.lineRange(for: NSRange(location: cursor, length: 0))
            let line = nsText.substring(with: lineRange)
            if let fence = fenceMarker(in: line) {
                if let open = openFence {
                    if fence.character == open.character, fence.count >= open.count {
                        ranges.append(NSRange(location: open.location, length: NSMaxRange(lineRange) - open.location))
                        openFence = nil
                    }
                } else {
                    openFence = (fence.character, fence.count, lineRange.location)
                }
            }
            let next = NSMaxRange(lineRange)
            guard next > cursor else { break }
            cursor = next
        }

        if let openFence {
            ranges.append(NSRange(location: openFence.location, length: length - openFence.location))
        }
        return ranges
    }

    private static func fenceMarker(in line: String) -> (character: unichar, count: Int)? {
        let nsLine = line as NSString
        var index = 0
        var spaces = 0
        while index < nsLine.length {
            let character = nsLine.character(at: index)
            if character == 32, spaces < 4 {
                spaces += 1
                index += 1
            } else {
                break
            }
        }
        guard index < nsLine.length else { return nil }
        let marker = nsLine.character(at: index)
        guard marker == 96 || marker == 126 else { return nil }
        var count = 0
        while index + count < nsLine.length, nsLine.character(at: index + count) == marker {
            count += 1
        }
        return count >= 3 ? (marker, count) : nil
    }

    private static func inlineCodeRanges(in text: String, excluding excludedRanges: [NSRange]) -> [NSRange] {
        var ranges: [NSRange] = []
        var cursor = text.startIndex
        while let start = text[cursor...].firstIndex(of: "`") {
            let startRange = NSRange(start..<text.index(after: start), in: text)
            if excludedRanges.contains(where: { NSLocationInRange(startRange.location, $0) }) {
                cursor = text.index(after: start)
                continue
            }

            var tickCount = 0
            var markerEnd = start
            while markerEnd < text.endIndex, text[markerEnd] == "`" {
                tickCount += 1
                markerEnd = text.index(after: markerEnd)
            }

            var search = markerEnd
            var foundEnd: String.Index?
            while search < text.endIndex {
                guard let candidate = text[search...].firstIndex(of: "`") else { break }
                var count = 0
                var end = candidate
                while end < text.endIndex, text[end] == "`" {
                    count += 1
                    end = text.index(after: end)
                }
                if count == tickCount {
                    foundEnd = end
                    break
                }
                search = end
            }

            guard let end = foundEnd else {
                cursor = markerEnd
                continue
            }
            let range = NSRange(start..<end, in: text)
            if !excludedRanges.contains(where: { ($0.intersection(range)?.length ?? 0) > 0 }) {
                ranges.append(range)
            }
            cursor = end
        }
        return ranges
    }
}
