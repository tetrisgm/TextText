import Foundation

#if canImport(AppKit)
import AppKit

@objc(ShareViewController)
public final class ShareViewController: NSViewController {
    private let actionPicker = NSPopUpButton()
    private let titleField = NSTextField()
    private let targetField = NSTextField()
    private let previewLabel = NSTextField(labelWithString: "Loading...")
    private let postButton = NSButton(title: "Post", target: nil, action: nil)
    private let cancelButton = NSButton(title: "Cancel", target: nil, action: nil)
    private var content = ShareExtractedContent()

    public override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 420, height: 210))
        buildView()
    }

    public override func viewDidLoad() {
        super.viewDidLoad()
        loadSharedContent()
    }

    private func buildView() {
        for action in ShareAction.allCases {
            actionPicker.addItem(withTitle: action.title)
        }
        actionPicker.target = self
        actionPicker.action = #selector(actionChanged)

        titleField.placeholderString = "Title"
        targetField.placeholderString = "Target textTextId"
        targetField.isHidden = true

        previewLabel.lineBreakMode = .byTruncatingMiddle
        previewLabel.maximumNumberOfLines = 1
        previewLabel.textColor = .secondaryLabelColor

        postButton.target = self
        postButton.action = #selector(post)
        postButton.keyEquivalent = "\r"
        cancelButton.target = self
        cancelButton.action = #selector(cancel)

        let buttons = NSStackView(views: [cancelButton, postButton])
        buttons.orientation = .horizontal
        buttons.alignment = .trailing
        buttons.distribution = .gravityAreas
        buttons.spacing = 8

        let stack = NSStackView(views: [
            actionPicker,
            titleField,
            targetField,
            previewLabel,
            buttons,
        ])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)

        actionPicker.widthAnchor.constraint(equalToConstant: 220).isActive = true
        titleField.widthAnchor.constraint(equalToConstant: 360).isActive = true
        targetField.widthAnchor.constraint(equalToConstant: 360).isActive = true
        previewLabel.widthAnchor.constraint(equalToConstant: 360).isActive = true
        buttons.widthAnchor.constraint(equalToConstant: 360).isActive = true
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(lessThanOrEqualTo: view.bottomAnchor, constant: -24),
        ])
    }

    private func loadSharedContent() {
        #if canImport(UniformTypeIdentifiers)
        ShareContentExtractor.extract(from: extensionContext) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let content):
                self.content = content
                self.titleField.stringValue = content.suggestedTitle
                self.previewLabel.stringValue = content.previewLine
                self.select(action: content.defaultAction)
            case .failure(let error):
                self.fail(error)
            }
        }
        #else
        content = ShareExtractedContent()
        titleField.stringValue = content.suggestedTitle
        previewLabel.stringValue = content.previewLine
        #endif
    }

    private var selectedAction: ShareAction {
        let index = actionPicker.indexOfSelectedItem
        guard ShareAction.allCases.indices.contains(index) else { return .newNote }
        return ShareAction.allCases[index]
    }

    private func select(action: ShareAction) {
        guard let index = ShareAction.allCases.firstIndex(of: action) else { return }
        actionPicker.selectItem(at: index)
        actionChanged()
    }

    @objc private func actionChanged() {
        targetField.isHidden = selectedAction != .appendToDocument
    }

    @objc private func post() {
        do {
            let container = try ShareExtensionInboxDestination.containerURL()
            try ShareInboxPoster.write(
                action: selectedAction,
                title: titleField.stringValue,
                content: content,
                targetTextTextId: targetField.stringValue,
                containerURL: container
            )
            extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        } catch {
            fail(error)
        }
    }

    @objc private func cancel() {
        let error = NSError(
            domain: NSCocoaErrorDomain,
            code: NSUserCancelledError,
            userInfo: [NSLocalizedDescriptionKey: "Share cancelled"]
        )
        extensionContext?.cancelRequest(withError: error)
    }

    private func fail(_ error: Error) {
        let alert = NSAlert(error: error)
        alert.runModal()
        extensionContext?.cancelRequest(withError: error)
    }
}
#endif
