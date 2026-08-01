import Foundation

public enum WorkspaceStorageKind: String, Codable, Equatable {
    case injected
    case iCloudDrive
    case documentsFallback
}

public struct WorkspaceLocation: Equatable {
    public var url: URL
    public var kind: WorkspaceStorageKind
    public var iCloudAvailable: Bool
    public var statusMessage: String

    public init(url: URL, kind: WorkspaceStorageKind, iCloudAvailable: Bool, statusMessage: String) {
        self.url = url
        self.kind = kind
        self.iCloudAvailable = iCloudAvailable
        self.statusMessage = statusMessage
    }
}

public struct WorkspaceRootResolver {
    public var overrideRoot: URL?
    public var fileManager: FileManager

    public init(overrideRoot: URL? = nil, fileManager: FileManager = .default) {
        self.overrideRoot = overrideRoot
        self.fileManager = fileManager
    }

    static func environmentOverrideRoot() -> URL? {
        guard let path = ProcessInfo.processInfo.environment["TEXTTEXT_SYNC_ROOT"],
              !path.isEmpty else { return nil }
        return URL(fileURLWithPath: (path as NSString).expandingTildeInPath, isDirectory: true)
    }

    public func resolve() -> WorkspaceLocation {
        // TEXTTEXT_SYNC_ROOT isolates the workspace for headless smokes and tests,
        // exactly as TEXTTEXT_STATE_DIR isolates state. Without it the app always
        // resolves the real iCloud Drive/TextText folder, so a smoke that omits it
        // is NOT isolated (it reads and can write the real workspace).
        let root = overrideRoot ?? Self.environmentOverrideRoot()
        if let root {
            return WorkspaceLocation(
                url: root,
                kind: .injected,
                iCloudAvailable: isICloudDriveAvailable(),
                statusMessage: "Using injected TextText workspace"
            )
        }

        let cloudRoot = Self.iCloudDriveWriteRoot(fileManager: fileManager)
        if isICloudDriveAvailable() {
            return WorkspaceLocation(
                url: cloudRoot,
                kind: .iCloudDrive,
                iCloudAvailable: true,
                statusMessage: "Using iCloud Drive TextText workspace"
            )
        }

        return WorkspaceLocation(
            url: Self.documentsFallbackWriteRoot(fileManager: fileManager),
            kind: .documentsFallback,
            iCloudAvailable: false,
            statusMessage: "iCloud Drive is unavailable; using ~/TextText Local on this Mac"
        )
    }

    public static func iCloudDriveWriteRoot(fileManager: FileManager = .default) -> URL {
        fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Mobile Documents/com~apple~CloudDocs/TextText", isDirectory: true)
    }

    public static func documentsFallbackWriteRoot(fileManager: FileManager = .default) -> URL {
        fileManager.homeDirectoryForCurrentUser.appendingPathComponent("TextText Local", isDirectory: true)
    }

    private func isICloudDriveAvailable() -> Bool {
        fileManager.ubiquityIdentityToken != nil
    }
}
