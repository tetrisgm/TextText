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
    var folderPath: String
    var folderStatus: String?
    var lastSyncLine: String
    var finderStatus: FileProviderStatusSnapshot
    var busy: Bool
    var activity: [String]
    var isDefaultForMarkdown: Bool
}

/// A small native status window: link state (with the device-link code when
/// one is pending), the Finder location and detailed sync state, recent
/// activity, and Sign in / Sign out. Frame autosaved.
final class StatusWindowController: NSWindowController {
    struct Actions {
        var signIn: () -> Void = {}
        var signOut: () -> Void = {}
        var cancelLink: () -> Void = {}
        var reopenApproval: () -> Void = {}
        var openFolder: () -> Void = {}
        var syncNow: () -> Void = {}
        var makeDefaultMarkdown: () -> Void = {}
    }

    private let actions: Actions

    private let accountLabel = NSTextField(labelWithString: "")
    private let accountDetailLabel = NSTextField(labelWithString: "")
    private let codeLabel = NSTextField(labelWithString: "")
    private let linkHintLabel = NSTextField(labelWithString: "")
    private let accountButton = NSButton(title: "Sign In", target: nil, action: nil)
    private let reopenButton = NSButton(title: "Open Approval Page", target: nil, action: nil)
    private let folderLabel = NSTextField(labelWithString: "")
    private let folderStatusLabel = NSTextField(labelWithString: "")
    private let openButton = NSButton(title: "Open", target: nil, action: nil)
    private let finderStatusImage = NSImageView()
    private let finderStatusLabel = NSTextField(labelWithString: "")
    private let finderStatusDetailLabel = NSTextField(labelWithString: "")
    private let syncLabel = NSTextField(labelWithString: "")
    private let syncButton = NSButton(title: "Sync Now", target: nil, action: nil)
    private let markdownLabel = NSTextField(labelWithString: "Open .md files with Texttext")
    private let markdownButton = NSButton(title: "Use Texttext", target: nil, action: nil)
    private let spinner = NSProgressIndicator()
    private let activityView = NSTextView()

    private var linking = false
    private var linked = false
    private var linkFailed = false

    init(actions: Actions) {
        self.actions = actions
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 460, height: 480),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false
        )
        window.title = appName
        window.minSize = NSSize(width: 400, height: 360)
        super.init(window: window)
        window.setFrameAutosaveName("WriteStatusWindow")
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

        folderLabel.font = .systemFont(ofSize: 12)
        folderLabel.lineBreakMode = .byTruncatingMiddle
        folderLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        folderStatusLabel.font = .systemFont(ofSize: 11)
        folderStatusLabel.textColor = .secondaryLabelColor
        openButton.target = self
        openButton.action = #selector(openFolderAction)

        finderStatusImage.imageScaling = .scaleProportionallyDown
        finderStatusImage.setContentHuggingPriority(.required, for: .horizontal)
        finderStatusLabel.font = .systemFont(ofSize: 12, weight: .medium)
        finderStatusDetailLabel.font = .systemFont(ofSize: 11)
        finderStatusDetailLabel.textColor = .secondaryLabelColor
        finderStatusDetailLabel.maximumNumberOfLines = 2
        finderStatusDetailLabel.lineBreakMode = .byWordWrapping

        syncLabel.font = .systemFont(ofSize: 12)
        syncLabel.textColor = .secondaryLabelColor
        syncButton.target = self
        syncButton.action = #selector(syncNowAction)
        markdownLabel.font = .systemFont(ofSize: 12)
        markdownButton.target = self
        markdownButton.action = #selector(markdownAction)
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isDisplayedWhenStopped = false

        activityView.isEditable = false
        activityView.isRichText = false
        activityView.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        activityView.textContainerInset = NSSize(width: 6, height: 6)
        activityView.autoresizingMask = [.width]
        let scroll = NSScrollView()
        scroll.documentView = activityView
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.setContentHuggingPriority(.defaultLow, for: .vertical)

        let accountRow = NSStackView(views: [accountLabel, NSView(), reopenButton, accountButton])
        accountRow.orientation = .horizontal

        let folderTitle = sectionTitle("Finder location")
        let folderRow = NSStackView(views: [folderLabel, NSView(), openButton])
        folderRow.orientation = .horizontal

        let syncRow = NSStackView(views: [syncLabel, spinner, NSView(), syncButton])
        syncRow.orientation = .horizontal

        let finderText = NSStackView(views: [finderStatusLabel, finderStatusDetailLabel])
        finderText.orientation = .vertical
        finderText.alignment = .leading
        finderText.spacing = 2
        let finderStatusRow = NSStackView(views: [finderStatusImage, finderText, NSView()])
        finderStatusRow.orientation = .horizontal
        finderStatusRow.alignment = .centerY
        finderStatusRow.spacing = 9

        let markdownRow = NSStackView(views: [markdownLabel, NSView(), markdownButton])
        markdownRow.orientation = .horizontal

        let stack = NSStackView(views: [
            accountRow, accountDetailLabel, codeLabel, linkHintLabel,
            separator(), folderTitle, folderRow, folderStatusLabel,
            separator(), sectionTitle("Sync"), finderStatusRow, syncRow,
            separator(), sectionTitle("Files"), markdownRow,
            separator(), sectionTitle("Recent activity"), scroll,
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
            folderRow.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -32),
            finderStatusRow.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -32),
            syncRow.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -32),
            markdownRow.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -32),
            codeLabel.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -32),
            linkHintLabel.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -32),
            scroll.widthAnchor.constraint(equalTo: stack.widthAnchor, constant: -32),
            scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 120),
            finderStatusImage.widthAnchor.constraint(equalToConstant: 22),
            finderStatusImage.heightAnchor.constraint(equalToConstant: 22),
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
        linked = model.linked
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

        if model.linking {
            accountButton.title = "Cancel"
        } else if model.linkFailed {
            accountButton.title = "Try Again"
        } else if model.linked {
            accountButton.title = "Sign Out"
        } else {
            accountButton.title = "Sign In"
        }

        folderLabel.stringValue = model.folderPath
        folderStatusLabel.stringValue = model.folderStatus ?? ""
        folderStatusLabel.isHidden = (model.folderStatus ?? "").isEmpty
        finderStatusLabel.stringValue = model.finderStatus.title
        finderStatusDetailLabel.stringValue = model.finderStatus.detail
        let symbolConfiguration = NSImage.SymbolConfiguration(
            pointSize: 17, weight: .medium)
        finderStatusImage.image = NSImage(
            systemSymbolName: model.finderStatus.symbolName,
            accessibilityDescription: model.finderStatus.title
        )?.withSymbolConfiguration(symbolConfiguration)
        finderStatusImage.contentTintColor = switch model.finderStatus.severity {
        case .neutral: .secondaryLabelColor
        case .healthy: .systemGreen
        case .working: .systemBlue
        case .warning: .systemOrange
        }
        syncLabel.stringValue = model.lastSyncLine
        syncButton.isEnabled = model.linked && !model.busy
        if model.busy { spinner.startAnimation(nil) } else { spinner.stopAnimation(nil) }

        if model.isDefaultForMarkdown {
            markdownLabel.stringValue = "Texttext opens .md files"
            markdownButton.title = "Default"
            markdownButton.isEnabled = false
        } else {
            markdownLabel.stringValue = "Open .md files with Texttext"
            markdownButton.title = "Use Texttext"
            markdownButton.isEnabled = true
        }

        let text = model.activity.joined(separator: "\n")
        if activityView.string != text {
            activityView.string = text
            activityView.scrollToEndOfDocument(nil)
        }
    }

    // MARK: Actions

    @objc private func accountAction() {
        if linking { actions.cancelLink() }
        else if linkFailed { actions.signIn() } // Try Again mints a fresh code
        else if linked { actions.signOut() }
        else { actions.signIn() }
    }

    @objc private func reopenAction() { actions.reopenApproval() }

    @objc private func openFolderAction() { actions.openFolder() }
    @objc private func syncNowAction() { actions.syncNow() }
    @objc private func markdownAction() { actions.makeDefaultMarkdown() }
}
