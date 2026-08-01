import AppKit
import UniformTypeIdentifiers

/// Making TextText the default app for Markdown files. The bundle declares it can
/// open `net.daringfireball.markdown` (Info.plist), so the user can flip the
/// system default to TextText from the status window with one click.
///
/// On modern macOS the Launch Services role-handler set is a silent no-op
/// (returns success but does not change the binding); the sanctioned
/// `NSWorkspace.setDefaultApplication` is required. It shows the system's
/// confirmation prompt, which is the intended flow (macOS requires user consent
/// to change a default handler). The completion fires once the user responds.
enum MarkdownDefaultHandler {
    /// The type `.md` files resolve to (net.daringfireball.markdown once the
    /// bundle's imported UTI is registered), with sane fallbacks.
    static var contentType: UTType {
        UTType(filenameExtension: "md")
            ?? UTType("net.daringfireball.markdown")
            ?? .plainText
    }

    /// True when TextText is already the default handler for Markdown.
    static func isDefault() -> Bool {
        guard let current = NSWorkspace.shared.urlForApplication(toOpen: contentType),
              let id = Bundle(url: current)?.bundleIdentifier else {
            return false
        }
        return id == Bundle.main.bundleIdentifier
    }

    /// Ask the system to make TextText the default for Markdown. macOS shows its
    /// own confirmation prompt; `completion` fires when the user responds (nil =
    /// now default, error = declined or failed).
    static func makeDefault(completion: @escaping (Error?) -> Void) {
        let type = contentType
        Task {
            do {
                // The Swift name of `setDefaultApplicationAtURL:toOpenContentType:`
                // is `setDefaultApplication(at:toOpen:)` with a UTType argument.
                try await NSWorkspace.shared.setDefaultApplication(
                    at: Bundle.main.bundleURL, toOpen: type)
                await MainActor.run { completion(nil) }
            } catch {
                await MainActor.run { completion(error) }
            }
        }
    }
}
