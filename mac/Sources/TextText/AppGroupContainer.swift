import Foundation
import Security

/// Where this app's shared data lives, resolved the same way whichever edition
/// is running.
///
/// The Developer ID build and the Mac App Store build are the same app from two
/// channels, and only one of them can be installed at a time. They used to keep
/// their state in different places: the sandboxed Store build writes inside its
/// container, the Developer ID build writes ~/Library/Application Support, and
/// neither can read the other. Switching editions therefore signed you out and
/// showed an empty library, which is not a thing a person should experience for
/// installing the same app a different way.
///
/// The app group container is the one directory both editions can reach, so it
/// is where state belongs. The resolution below is the share inbox's, which has
/// been finding this container correctly for both editions all along.
enum AppGroupContainer {
    /// The configured app-group id, or nil when the placeholder was never
    /// substituted (a development build).
    static func identifier() -> String? {
        let envGroup = ProcessInfo.processInfo.environment["TEXTTEXT_APP_GROUP"]
        guard let groupIdentifier = envGroup
            ?? Bundle.main.object(forInfoDictionaryKey: "TextTextAppGroupIdentifier") as? String,
              !groupIdentifier.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              groupIdentifier != "TEXTTEXT_APP_GROUP" else {
            return nil
        }
        return groupIdentifier
    }

    static func containersRoot() -> URL {
        if let override = ProcessInfo.processInfo.environment["TEXTTEXT_GROUP_CONTAINERS_DIR"],
           !override.isEmpty {
            return URL(fileURLWithPath: (override as NSString).expandingTildeInPath, isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Group Containers", isDirectory: true)
    }

    /// The only two places this app's group container can be, most specific
    /// first. Reading these does not enumerate anybody else's container, which
    /// macOS blocks with a "tried to access your data from other apps" alert.
    static func candidates(for groupIdentifier: String) -> [URL] {
        let root = containersRoot()
        var candidates: [URL] = []
        if let team = teamIdentifier(), !team.isEmpty {
            candidates.append(root.appendingPathComponent("\(team).\(groupIdentifier)", isDirectory: true))
        }
        candidates.append(root.appendingPathComponent(groupIdentifier, isDirectory: true))
        return candidates
    }

    /// The container both editions agree on, or nil when there is none yet.
    ///
    /// Sandboxed (the Store edition): the system hands back the one true
    /// container, team-prefixed, the same directory the sandboxed extensions
    /// write to.
    ///
    /// Not sandboxed (the Developer ID edition): the same call returns a naive
    /// <home>/Library/Group Containers/<group id> that nothing writes to, so the
    /// two candidate paths are tried instead. The team-prefixed one is first,
    /// which is exactly the path the Store edition resolves to, and that is what
    /// makes the two editions land on the same bytes.
    static func resolve(fileManager: FileManager = .default) -> URL? {
        guard let groupIdentifier = identifier() else { return nil }
        return choose(
            systemContainer: fileManager.containerURL(
                forSecurityApplicationGroupIdentifier: groupIdentifier),
            isSandboxed: isSandboxed,
            candidates: candidates(for: groupIdentifier),
            exists: { fileManager.fileExists(atPath: $0.path) })
    }

    /// True only inside the sandboxed (Store) edition. The system sets this for
    /// every sandboxed process; the Developer ID build never sees it.
    static var isSandboxed: Bool {
        ProcessInfo.processInfo.environment["APP_SANDBOX_CONTAINER_ID"] != nil
    }

    /// Split out from `resolve` because the interesting case has no home
    /// directory to stand in for it.
    ///
    /// The system's answer is only trustworthy inside the sandbox. Outside it,
    /// `containerURL(forSecurityApplicationGroupIdentifier:)` does not consult
    /// anything: it hands back a naive <home>/Library/Group Containers/<group
    /// id>. If that directory happens to exist — and on a machine that has run
    /// an older build, it does, empty — trusting it puts the Developer ID
    /// edition's state somewhere the Store edition will never look, which is
    /// the exact split this whole type exists to close. So outside the sandbox
    /// the candidates decide, team-prefixed first, because that is the
    /// directory the sandboxed edition and the extensions actually use.
    static func choose(systemContainer: URL?, isSandboxed: Bool,
                       candidates: [URL], exists: (URL) -> Bool) -> URL? {
        if isSandboxed, let systemContainer, exists(systemContainer) {
            return systemContainer
        }
        return candidates.first(where: exists)
    }

    /// This app's own Team ID, read from its signature, so the team-prefixed
    /// container can be addressed directly instead of discovered by scanning.
    static func teamIdentifier() -> String? {
        var selfCode: SecCode?
        guard SecCodeCopySelf(SecCSFlags(), &selfCode) == errSecSuccess,
              let selfCode else { return nil }
        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(selfCode, SecCSFlags(), &staticCode) == errSecSuccess,
              let staticCode else { return nil }
        var info: CFDictionary?
        guard SecCodeCopySigningInformation(
            staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info
        ) == errSecSuccess,
            let dictionary = info as? [String: Any] else { return nil }
        return dictionary[kSecCodeInfoTeamIdentifier as String] as? String
    }
}
