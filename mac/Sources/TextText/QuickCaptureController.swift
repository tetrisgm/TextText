import AppKit

private final class QuickCapturePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

enum QuickCaptureKeyAction: Equatable {
    case dismiss
    case forward
    case newline
    case save

    static func resolve(
        keyCode: UInt16,
        modifiers: NSEvent.ModifierFlags,
        hasMarkedText: Bool
    ) -> QuickCaptureKeyAction {
        if hasMarkedText { return .forward }
        if keyCode == 53 { return .dismiss }
        guard keyCode == 36 || keyCode == 76 else { return .forward }
        let flags = modifiers.intersection(.deviceIndependentFlagsMask)
        return flags.contains(.shift) ? .newline : .save
    }
}

/// Shared by the floating quick-capture panel and the main window's launch
/// capture surface, so Return/Shift-Return/Esc mean the same thing on both.
final class QuickCaptureTextView: NSTextView {
    var save: (() -> Void)?
    var dismiss: (() -> Void)?
    var placeholder = ""

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard string.isEmpty, !placeholder.isEmpty else { return }
        let style = NSMutableParagraphStyle()
        style.lineSpacing = 4
        NSAttributedString(
            string: placeholder,
            attributes: [
                .font: font ?? NSFont.systemFont(ofSize: 16),
                .foregroundColor: NSColor.placeholderTextColor,
                .paragraphStyle: style,
            ]
        ).draw(at: NSPoint(
            x: textContainerInset.width + 5,
            y: textContainerInset.height
        ))
    }

    override func didChangeText() {
        super.didChangeText()
        needsDisplay = true
    }

    override func keyDown(with event: NSEvent) {
        switch QuickCaptureKeyAction.resolve(
            keyCode: event.keyCode,
            modifiers: event.modifierFlags,
            hasMarkedText: hasMarkedText()
        ) {
        case .dismiss:
            dismiss?()
        case .save:
            save?()
        case .forward, .newline:
            super.keyDown(with: event)
        }
    }
}

/// A reusable, keyboard-first capture surface. It owns no sync behavior: save
/// succeeds only after AppDelegate has durably enqueued the bytes.
final class QuickCaptureController: NSWindowController, NSWindowDelegate {
    private let textView = QuickCaptureTextView()
    private let statusLabel = NSTextField(labelWithString: "")
    private let onSave: (QuickCaptureIntent) throws -> Void
    private var hideWorkItem: DispatchWorkItem?

    init(onSave: @escaping (QuickCaptureIntent) throws -> Void) {
        self.onSave = onSave
        let panel = QuickCapturePanel(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 300),
            styleMask: [.titled, .closable, .fullSizeContentView, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.title = "Quick capture"
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isMovableByWindowBackground = true
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.hidesOnDeactivate = false
        panel.animationBehavior = .none
        panel.isReleasedWhenClosed = false
        super.init(window: panel)
        panel.delegate = self
        buildContent()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    func present() {
        guard let window else { return }
        hideWorkItem?.cancel()
        statusLabel.stringValue = ""
        statusLabel.textColor = .secondaryLabelColor
        textView.isEditable = true
        window.center()
        window.alphaValue = 0
        showWindow(nil)
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(textView)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.18
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            window.animator().alphaValue = 1
        }
    }

    private func buildContent() {
        guard let content = window?.contentView else { return }

        textView.isRichText = false
        textView.importsGraphics = false
        textView.allowsUndo = true
        textView.drawsBackground = false
        textView.font = .systemFont(ofSize: 16, weight: .regular)
        textView.textColor = .labelColor
        textView.insertionPointColor = .labelColor
        textView.textContainerInset = NSSize(width: 18, height: 18)
        textView.placeholder = "Save a thought, note, link, or AI answer"
        textView.save = { [weak self] in self?.save() }
        textView.dismiss = { [weak self] in self?.dismiss() }

        let scrollView = NSScrollView()
        scrollView.documentView = textView
        scrollView.drawsBackground = false
        scrollView.hasVerticalScroller = true
        scrollView.scrollerStyle = .overlay
        scrollView.borderType = .noBorder
        scrollView.translatesAutoresizingMaskIntoConstraints = false

        statusLabel.font = .systemFont(ofSize: 11, weight: .medium)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.lineBreakMode = .byTruncatingTail
        statusLabel.translatesAutoresizingMaskIntoConstraints = false

        let shortcutLabel = NSTextField(
            labelWithString: "Save ↩    New line ⇧↩    Close Esc")
        shortcutLabel.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        shortcutLabel.textColor = .secondaryLabelColor
        shortcutLabel.alignment = .right
        shortcutLabel.translatesAutoresizingMaskIntoConstraints = false

        let separator = NSBox()
        separator.boxType = .separator
        separator.translatesAutoresizingMaskIntoConstraints = false

        content.addSubview(scrollView)
        content.addSubview(separator)
        content.addSubview(statusLabel)
        content.addSubview(shortcutLabel)

        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: content.topAnchor, constant: 24),
            scrollView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: separator.topAnchor),
            separator.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            separator.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            separator.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -36),
            statusLabel.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 14),
            statusLabel.centerYAnchor.constraint(equalTo: shortcutLabel.centerYAnchor),
            statusLabel.trailingAnchor.constraint(lessThanOrEqualTo: shortcutLabel.leadingAnchor, constant: -12),
            shortcutLabel.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -14),
            shortcutLabel.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -11),
        ])
    }

    private func save() {
        guard !textView.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            NSSound.beep()
            return
        }
        guard let capture = QuickCaptureIntent(textView.string) else {
            NSSound.beep()
            return
        }
        do {
            try onSave(capture)
            textView.string = ""
            textView.needsDisplay = true
            textView.isEditable = false
            statusLabel.textColor = .systemGreen
            statusLabel.stringValue = "Queued safely"
            let work = DispatchWorkItem { [weak self] in self?.hide() }
            hideWorkItem = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.65, execute: work)
        } catch {
            statusLabel.textColor = .systemRed
            statusLabel.stringValue = "Failed to queue. Your text is still here."
            NSSound.beep()
        }
    }

    private func dismiss() {
        hideWorkItem?.cancel()
        textView.string = ""
        textView.needsDisplay = true
        statusLabel.stringValue = ""
        hide()
    }

    private func hide() {
        guard let window else { return }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.18
            context.timingFunction = CAMediaTimingFunction(name: .easeIn)
            window.animator().alphaValue = 0
        } completionHandler: {
            window.orderOut(nil)
            window.alphaValue = 1
        }
    }

    func windowWillClose(_ notification: Notification) {
        hideWorkItem?.cancel()
        textView.string = ""
        textView.needsDisplay = true
        statusLabel.stringValue = ""
    }
}

/// A small, sandbox-safe recovery surface for captures that exhausted their
/// automatic retries. It reads and restores the existing app-owned dead-letter
/// records without relying on Finder or the File Provider extension.
final class QuickCaptureRecoveryController: NSWindowController,
    NSTableViewDataSource, NSTableViewDelegate
{
    private let loadRecords: () -> [QuickCaptureRecord]
    private let retryAll: () throws -> Int
    private let retryOne: (String) throws -> Bool
    private let discardOne: (String) throws -> Bool
    private var records: [QuickCaptureRecord] = []
    private let tableView = NSTableView()
    private let previewTextView = NSTextView()
    private let summaryLabel = NSTextField(labelWithString: "")
    private let statusLabel = NSTextField(labelWithString: "")
    private let copyButton = NSButton(title: "Copy capture", target: nil, action: nil)
    private let retrySelectedButton = NSButton(
        title: "Retry selected", target: nil, action: nil)
    private let discardButton = NSButton(
        title: "Discard selected", target: nil, action: nil)
    private let retryButton = NSButton(title: "Retry all", target: nil, action: nil)

    init(
        loadRecords: @escaping () -> [QuickCaptureRecord],
        retryOne: @escaping (String) throws -> Bool,
        discardOne: @escaping (String) throws -> Bool,
        retryAll: @escaping () throws -> Int
    ) {
        self.loadRecords = loadRecords
        self.retryOne = retryOne
        self.discardOne = discardOne
        self.retryAll = retryAll
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 640, height: 500),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Failed captures"
        window.minSize = NSSize(width: 560, height: 400)
        window.center()
        super.init(window: window)
        window.setFrameAutosaveName("TextTextQuickCaptureRecoveryWindow")
        buildContent()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    func present() {
        reload()
        NSApp.activate(ignoringOtherApps: true)
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
    }

    private func buildContent() {
        guard let content = window?.contentView else { return }

        let titleLabel = NSTextField(labelWithString: "Recover failed captures")
        titleLabel.font = .systemFont(ofSize: 16, weight: .semibold)
        summaryLabel.font = .systemFont(ofSize: 12)
        summaryLabel.textColor = .secondaryLabelColor
        statusLabel.font = .systemFont(ofSize: 11)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.lineBreakMode = .byTruncatingTail

        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("capture"))
        column.title = "Capture"
        column.width = 500
        column.resizingMask = .autoresizingMask
        tableView.addTableColumn(column)
        tableView.headerView = nil
        tableView.rowHeight = 54
        tableView.intercellSpacing = NSSize(width: 0, height: 1)
        tableView.usesAlternatingRowBackgroundColors = true
        tableView.allowsMultipleSelection = false
        tableView.dataSource = self
        tableView.delegate = self

        let scrollView = NSScrollView()
        scrollView.documentView = tableView
        scrollView.hasVerticalScroller = true
        scrollView.borderType = .bezelBorder

        previewTextView.isEditable = false
        previewTextView.isSelectable = true
        previewTextView.isRichText = false
        previewTextView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        previewTextView.textColor = .labelColor
        previewTextView.drawsBackground = false
        previewTextView.textContainerInset = NSSize(width: 8, height: 8)
        let previewScrollView = NSScrollView()
        previewScrollView.documentView = previewTextView
        previewScrollView.hasVerticalScroller = true
        previewScrollView.borderType = .bezelBorder

        copyButton.target = self
        copyButton.action = #selector(copySelectedCapture)
        copyButton.isEnabled = false
        retrySelectedButton.target = self
        retrySelectedButton.action = #selector(retrySelectedCapture)
        retrySelectedButton.isEnabled = false
        discardButton.target = self
        discardButton.action = #selector(discardSelectedCapture)
        discardButton.isEnabled = false
        retryButton.target = self
        retryButton.action = #selector(retryFailedCaptures)

        let buttons = NSStackView(views: [
            statusLabel, NSView(), copyButton, retrySelectedButton,
            discardButton, retryButton,
        ])
        buttons.orientation = .horizontal
        buttons.alignment = .centerY
        buttons.spacing = 8

        let stack = NSStackView(views: [
            titleLabel, summaryLabel, scrollView, previewScrollView, buttons,
        ])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        stack.edgeInsets = NSEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)

        scrollView.translatesAutoresizingMaskIntoConstraints = false
        previewScrollView.translatesAutoresizingMaskIntoConstraints = false
        buttons.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: content.topAnchor),
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            scrollView.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -32),
            scrollView.heightAnchor.constraint(greaterThanOrEqualToConstant: 140),
            previewScrollView.widthAnchor.constraint(
                equalTo: stack.widthAnchor, constant: -32),
            previewScrollView.heightAnchor.constraint(greaterThanOrEqualToConstant: 100),
            buttons.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -32),
        ])
    }

    private func reload() {
        records = loadRecords()
        tableView.reloadData()
        copyButton.isEnabled = false
        retrySelectedButton.isEnabled = false
        discardButton.isEnabled = false
        previewTextView.string = "Select a failed capture to review its exact text."
        retryButton.isEnabled = !records.isEmpty
        summaryLabel.stringValue = records.isEmpty
            ? "No readable failed captures remain."
            : "Nothing was deleted. Copy a capture or put every item back in the retry queue."
    }

    func numberOfRows(in tableView: NSTableView) -> Int { records.count }

    func tableView(
        _ tableView: NSTableView,
        viewFor tableColumn: NSTableColumn?,
        row: Int
    ) -> NSView? {
        let identifier = NSUserInterfaceItemIdentifier("QuickCaptureRecoveryCell")
        let cell: NSTableCellView
        if let reused = tableView.makeView(withIdentifier: identifier, owner: self)
            as? NSTableCellView
        {
            cell = reused
        } else {
            cell = NSTableCellView()
            cell.identifier = identifier
            let label = NSTextField(wrappingLabelWithString: "")
            label.translatesAutoresizingMaskIntoConstraints = false
            label.maximumNumberOfLines = 2
            cell.textField = label
            cell.addSubview(label)
            NSLayoutConstraint.activate([
                label.leadingAnchor.constraint(equalTo: cell.leadingAnchor, constant: 8),
                label.trailingAnchor.constraint(equalTo: cell.trailingAnchor, constant: -8),
                label.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
            ])
        }
        let record = records[row]
        let detail = record.lastError ?? "The server did not accept this capture."
        cell.textField?.attributedStringValue = recoveryCellText(
            title: record.title, detail: detail)
        return cell
    }

    func tableViewSelectionDidChange(_ notification: Notification) {
        let row = tableView.selectedRow
        let selected = records.indices.contains(row)
        copyButton.isEnabled = selected
        retrySelectedButton.isEnabled = selected
        discardButton.isEnabled = selected
        previewTextView.string = selected
            ? records[row].raw
            : "Select a failed capture to review its exact text."
    }

    @objc private func copySelectedCapture() {
        let row = tableView.selectedRow
        guard records.indices.contains(row) else { return }
        let record = records[row]
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(record.raw, forType: .string)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.stringValue = "Copied"
    }

    @objc private func retrySelectedCapture() {
        let row = tableView.selectedRow
        guard records.indices.contains(row) else { return }
        do {
            guard try retryOne(records[row].id) else {
                statusLabel.stringValue = "This capture is no longer available"
                reload()
                return
            }
            statusLabel.textColor = .systemGreen
            statusLabel.stringValue = "Queued safely"
            reload()
        } catch {
            statusLabel.textColor = .systemRed
            statusLabel.stringValue = "Could not queue the capture"
            NSSound.beep()
        }
    }

    @objc private func discardSelectedCapture() {
        let row = tableView.selectedRow
        guard records.indices.contains(row) else { return }
        let record = records[row]
        let alert = NSAlert()
        alert.messageText = "Discard this failed capture?"
        alert.informativeText = "This removes the only recovery copy from TextText."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Discard")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        do {
            guard try discardOne(record.id) else {
                statusLabel.stringValue = "This capture is no longer available"
                reload()
                return
            }
            statusLabel.textColor = .secondaryLabelColor
            statusLabel.stringValue = "Discarded"
            reload()
        } catch {
            statusLabel.textColor = .systemRed
            statusLabel.stringValue = "Could not discard the capture"
            NSSound.beep()
        }
    }

    @objc private func retryFailedCaptures() {
        do {
            let count = try retryAll()
            if count == 0 {
                statusLabel.textColor = .secondaryLabelColor
                statusLabel.stringValue = "No readable captures to retry"
            } else {
                statusLabel.textColor = .systemGreen
                statusLabel.stringValue = count == 1
                    ? "Queued 1 capture safely"
                    : "Queued \(count) captures safely"
            }
            reload()
        } catch {
            statusLabel.textColor = .systemRed
            statusLabel.stringValue = "Could not queue the captures"
            NSSound.beep()
        }
    }

    private func recoveryCellText(title: String, detail: String) -> NSAttributedString {
        let value = NSMutableAttributedString(
            string: title,
            attributes: [
                .font: NSFont.systemFont(ofSize: 13, weight: .medium),
                .foregroundColor: NSColor.labelColor,
            ])
        value.append(NSAttributedString(
            string: "\n\(detail)",
            attributes: [
                .font: NSFont.systemFont(ofSize: 11),
                .foregroundColor: NSColor.secondaryLabelColor,
            ]))
        return value
    }
}
