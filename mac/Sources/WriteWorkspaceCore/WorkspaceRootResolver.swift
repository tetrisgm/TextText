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

    public func resolve() -> WorkspaceLocation {
        if let overrideRoot {
            return WorkspaceLocation(
                url: overrideRoot,
                kind: .injected,
                iCloudAvailable: isICloudDriveAvailable(),
                statusMessage: "Using injected Write workspace"
            )
        }

        let cloudRoot = Self.iCloudDriveWriteRoot(fileManager: fileManager)
        if isICloudDriveAvailable() {
            return WorkspaceLocation(
                url: cloudRoot,
                kind: .iCloudDrive,
                iCloudAvailable: true,
                statusMessage: "Using iCloud Drive Write workspace"
            )
        }

        return WorkspaceLocation(
            url: Self.documentsFallbackWriteRoot(fileManager: fileManager),
            kind: .documentsFallback,
            iCloudAvailable: false,
            statusMessage: "iCloud Drive is unavailable; using ~/Write Local on this Mac"
        )
    }

    public static func iCloudDriveWriteRoot(fileManager: FileManager = .default) -> URL {
        fileManager.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Mobile Documents/com~apple~CloudDocs/Write", isDirectory: true)
    }

    public static func documentsFallbackWriteRoot(fileManager: FileManager = .default) -> URL {
        fileManager.homeDirectoryForCurrentUser.appendingPathComponent("Write Local", isDirectory: true)
    }

    private func isICloudDriveAvailable() -> Bool {
        fileManager.ubiquityIdentityToken != nil
    }
}
