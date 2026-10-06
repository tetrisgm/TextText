import AppKit

/// The local editor is unavailable until this installation has an account.
/// A returning account may still work offline with its saved device credential.
final class AccountGateWindowController: NSWindowController {
    var onSignIn: (() -> Void)?
    var onOtherSignIn: (() -> Void)?

    private let status = NSTextField(wrappingLabelWithString: "")

    init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 900, height: 620),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Sign in · TextText"
        window.minSize = NSSize(width: 560, height: 400)
        window.center()
        super.init(window: window)

        guard let content = window.contentView else { return }
        let brand = NSTextField(labelWithString: "TextText")
        brand.font = .systemFont(ofSize: 16, weight: .semibold)
        brand.textColor = .secondaryLabelColor

        let title = NSTextField(labelWithString: "Sign in to TextText")
        title.font = .systemFont(ofSize: 30, weight: .bold)

        let explanation = NSTextField(wrappingLabelWithString:
            "Sign in to open your workspace on this Mac. Your TextPack files stay in your chosen folder and remain available offline after sign-in.")
        explanation.font = .systemFont(ofSize: 14)
        explanation.textColor = .secondaryLabelColor

        #if TEXTTEXT_STORE
        let button = NSButton(title: "Continue with Apple", target: self, action: #selector(beginSignIn))
        let otherButton = NSButton(title: "Other sign-in methods", target: self, action: #selector(beginOtherSignIn))
        otherButton.bezelStyle = .rounded
        #else
        let button = NSButton(title: "Continue to sign in", target: self, action: #selector(beginSignIn))
        #endif
        button.bezelStyle = .rounded
        button.keyEquivalent = "\r"

        status.font = .systemFont(ofSize: 12)
        status.textColor = .secondaryLabelColor
        status.isHidden = true

        #if TEXTTEXT_STORE
        let stack = NSStackView(views: [brand, title, explanation, button, otherButton, status])
        #else
        let stack = NSStackView(views: [brand, title, explanation, button, status])
        #endif
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 18
        stack.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: content.centerYAnchor),
            stack.widthAnchor.constraint(equalToConstant: 400),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: content.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: content.trailingAnchor, constant: -32),
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }

    func present() {
        NSApp.activate(ignoringOtherApps: true)
        showWindow(nil)
        window?.makeKeyAndOrderFront(nil)
    }

    func setStatus(_ message: String?, failed: Bool = false) {
        status.stringValue = message ?? ""
        status.textColor = failed ? .systemRed : .secondaryLabelColor
        status.isHidden = message == nil
    }

    @objc private func beginSignIn() { onSignIn?() }
    @objc private func beginOtherSignIn() { onOtherSignIn?() }
}
