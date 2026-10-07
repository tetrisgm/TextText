import AppKit

/// Everything the status window shows, computed by the AppDelegate.
struct StatusModel {
    var accountLine: String        // "Linked as My Blog" / "Not linked" / a failure headline
    var accountDetail: String?     // token name + server, small print
    var linkCode: String?          // shown big while waiting for approval
    var linkHint: String?          // "Confirm this code in your browser"
    var linked: Bool
    var linking: Bool
    var linkFailed: Bool           // expired/failed: the button becomes Try Again
    var waitingApproval: Bool      // pending code: offer to reopen the SAME page
    var isDefaultForMarkdown: Bool
}

/// A small native status window: link state (with the device-link code when
/// one is pending), file association, and account actions.
final class StatusWindowController: NSWindowController {
    struct Actions {
        var signIn: () -> Void = {}
        var cancelLink: () -> Void = {}
        var reopenApproval: () -> Void = {}
        var makeDefaultMarkdown: () -> Void = {}
    }

    private let actions: Actions

    private let accountLabel = NSTextField(labelWithString: "")
    private let accountDetailLabel = NSTextField(labelWithString: "")
    private let codeLabel = NSTextField(labelWithString: "")
    private let linkHintLabel = NSTextField(labelWithString: "")
    private let accountButton = NSButton(title: "Sign In", target: nil, action: nil)
    private let reopenButton = NSButton(title: "Open Approval Page", target: nil, action: nil)
    private let markdownLabel = NSTextField(labelWithString: "Open .md files with TextText")
    private let markdownButton = NSButton(title: "Use TextText", target: nil, action: nil)

    private var linking = false
    private var linkFailed = false

    init(actions: Actions) {
        self.actions = actions
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 460, height: 240),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered, defer: false
        )
        window.title = appName
        super.init(window: window)
        window.center()
        buildContent()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    // MARK: Layout

    private func buildContent() {
        guard let content = window?.contentView else { return }

        accountLabel.font = .systemFont(ofSize: 15, weight: .semibold)
        accountDetailLabel.font = .systemFont(ofSize: 11)
        accountDetailLabel.textColor = .secondaryLabelColor

        codeLabel.font = .monospacedSystemFont(ofSize: 28, weight: .medium)
        codeLabel.alignment = .center
        codeLabel.isSelectable = true
        linkHintLabel.font = .systemFont(ofSize: 11)
        linkHintLabel.textColor = .secondaryLabelColor
        linkHintLabel.alignment = .center

        accountButton.target = self
        accountButton.action = #selector(accountAction)
        reopenButton.target = self
        reopenButton.action = #selector(reopenAction)
        reopenButton.isHidden = true

        markdownLabel.font = .systemFont(ofSize: 12)
        markdownButton.target = self
        markdownButton.action = #selector(markdownAction)

        let accountRow = NSStackView(views: [accountLabel, NSView(), reopenButton, accountButton])
        accountRow.orientation = .horizontal

        let markdownRow = NSStackView(views: [markdownLabel, NSView(), markdownButton])
        markdownRow.orientation = .horizontal

        let stack = NSStackView(views: [
            accountRow, accountDetailLabel, codeLabel, linkHintLabel,
            separator(), sectionTitle("Files"), markdownRow,
        ])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        stack.edgeInsets = NSEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: content.topAnchor),
            stack.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            accountRow.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -32),
            markdownRow.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -32),
            codeLabel.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -32),
            linkHintLabel.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -32),
        ])
    }

    private func sectionTitle(_ text: String) -> NSTextField {
        let label = NSTextField(labelWithString: text.uppercased())
        label.font = .systemFont(ofSize: 10, weight: .semibold)
        label.textColor = .tertiaryLabelColor
        return label
    }

    private func separator() -> NSBox {
        let box = NSBox()
        box.boxType = .separator
        return box
    }

    // MARK: Refresh

    func refresh(_ model: StatusModel) {
        linking = model.linking
        linkFailed = model.linkFailed

        accountLabel.stringValue = model.accountLine
        accountLabel.textColor = model.linkFailed ? .systemRed : .labelColor
        accountDetailLabel.stringValue = model.accountDetail ?? ""
        accountDetailLabel.isHidden = (model.accountDetail ?? "").isEmpty

        codeLabel.stringValue = model.linkCode ?? ""
        codeLabel.isHidden = model.linkCode == nil
        linkHintLabel.stringValue = model.linkHint ?? ""
        linkHintLabel.isHidden = model.linkHint == nil

        reopenButton.isHidden = !model.waitingApproval
        accountButton.isHidden = model.linked && !model.linking && !model.linkFailed

        if model.linking {
            accountButton.title = "Cancel"
        } else if model.linkFailed {
            accountButton.title = "Try Again"
        } else {
            accountButton.title = "Sign In"
        }

        if model.isDefaultForMarkdown {
            markdownLabel.stringValue = "TextText opens .md files"
            markdownButton.title = "Default"
            markdownButton.isEnabled = false
        } else {
            markdownLabel.stringValue = "Open .md files with TextText"
            markdownButton.title = "Use TextText"
            markdownButton.isEnabled = true
        }

    }

    // MARK: Actions

    @objc private func accountAction() {
        if linking { actions.cancelLink() }
        else if linkFailed { actions.signIn() } // Try Again mints a fresh code
        else { actions.signIn() }
    }

    @objc private func reopenAction() { actions.reopenApproval() }

    @objc private func markdownAction() { actions.makeDefaultMarkdown() }
}
