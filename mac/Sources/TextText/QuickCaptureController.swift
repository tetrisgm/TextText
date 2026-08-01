import AppKit

private final class QuickCapturePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

private final class QuickCaptureTextView: NSTextView {
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
        if event.keyCode == 53 {
            dismiss?()
            return
        }
        if event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            .contains(.command), event.keyCode == 36 || event.keyCode == 76 {
            save?()
            return
        }
        super.keyDown(with: event)
    }
}

/// A reusable, keyboard-first capture surface. It owns no sync behavior: save
/// succeeds only after AppDelegate has durably enqueued the bytes.
final class QuickCaptureController: NSWindowController, NSWindowDelegate {
    private let textView = QuickCaptureTextView()
    private let statusLabel = NSTextField(labelWithString: "")
    private let onSave: (QuickCaptureContent) throws -> Void

    init(onSave: @escaping (QuickCaptureContent) throws -> Void) {
        self.onSave = onSave
        let panel = QuickCapturePanel(
            contentRect: NSRect(x: 0, y: 0, width: 520, height: 300),
            styleMask: [.titled, .closable, .fullSizeContentView, .nonactivatingPanel, .hudWindow],
            backing: .buffered,
            defer: false
        )
        panel.title = "New note"
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
        statusLabel.stringValue = ""
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
        textView.placeholder = "Title\nStart writing"
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
        statusLabel.textColor = .systemRed
        statusLabel.lineBreakMode = .byTruncatingTail
        statusLabel.translatesAutoresizingMaskIntoConstraints = false

        let shortcutLabel = NSTextField(labelWithString: "Save ⌘↩    Close Esc")
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
        let content = QuickCaptureContent.parse(textView.string)
        do {
            try onSave(content)
            textView.string = ""
            textView.needsDisplay = true
            statusLabel.stringValue = ""
            hide()
        } catch {
            statusLabel.stringValue = "Could not save"
            NSSound.beep()
        }
    }

    private func dismiss() {
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
        textView.string = ""
        textView.needsDisplay = true
        statusLabel.stringValue = ""
    }
}
