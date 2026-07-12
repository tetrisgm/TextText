import AppKit
import CoreServices
import UniformTypeIdentifiers

/// Making Write the default app for Markdown files. The bundle declares it can
/// open `net.daringfireball.markdown` (Info.plist), so the user can flip the
/// system default to Write from the status window with one click, the way a
/// browser offers to become the default browser.
///
/// Uses the Launch Services role-handler API. It is marked deprecated in favour
/// of NSWorkspace.setDefaultApplication, but that async replacement's Swift
/// overloads resolve inconsistently across SDKs; this call is synchronous,
/// prompt-free, and stable.
enum MarkdownDefaultHandler {
    /// The identifier of the type `.md` files resolve to (net.daringfireball.markdown
    /// once the bundle's imported UTI is registered), with sane fallbacks.
    static var contentTypeIdentifier: String {
        (UTType(filenameExtension: "md")
            ?? UTType("net.daringfireball.markdown")
            ?? .plainText).identifier
    }

    /// True when Write is already the default handler for Markdown.
    static func isDefault() -> Bool {
        guard let bundleID = Bundle.main.bundleIdentifier else { return false }
        let current = LSCopyDefaultRoleHandlerForContentType(
            contentTypeIdentifier as CFString, .all)?.takeRetainedValue() as String?
        return current?.caseInsensitiveCompare(bundleID) == .orderedSame
    }

    /// Set Write as the default handler for Markdown. No prompt: Launch Services
    /// just updates the binding.
    static func makeDefault(completion: @escaping (Error?) -> Void) {
        guard let bundleID = Bundle.main.bundleIdentifier else {
            completion(NSError(domain: NSCocoaErrorDomain, code: -1))
            return
        }
        let status = LSSetDefaultRoleHandlerForContentType(
            contentTypeIdentifier as CFString, .all, bundleID as CFString)
        completion(status == noErr ? nil : NSError(
            domain: NSOSStatusErrorDomain, code: Int(status)))
    }
}
