import Foundation

public enum CLIInstallerError: Error, CustomStringConvertible, Equatable {
    case destinationOwnedBySomethingElse(String)

    public var description: String {
        switch self {
        case .destinationOwnedBySomethingElse(let path):
            return "\(path) already exists and is not this TextText helper; move it yourself before installing"
        }
    }
}

public enum CLIInstaller {
    /// Install one symlink without ever deleting a command owned by another
    /// tool. An existing path is replaceable only when it is already a symlink
    /// to this exact bundled helper.
    public static func install(
        source: URL, destination: URL,
        fileManager: FileManager = .default
    ) throws {
        let source = source.standardizedFileURL.resolvingSymlinksInPath()
        let directory = destination.deletingLastPathComponent()
        try fileManager.createDirectory(
            at: directory, withIntermediateDirectories: true)

        if fileManager.fileExists(atPath: destination.path)
            || (try? destination.resourceValues(forKeys: [.isSymbolicLinkKey]))?
                .isSymbolicLink == true
        {
            let values = try destination.resourceValues(forKeys: [.isSymbolicLinkKey])
            guard values.isSymbolicLink == true else {
                throw CLIInstallerError.destinationOwnedBySomethingElse(
                    destination.path)
            }
            let rawTarget = try fileManager.destinationOfSymbolicLink(
                atPath: destination.path)
            let target = rawTarget.hasPrefix("/")
                ? URL(fileURLWithPath: rawTarget)
                : directory.appendingPathComponent(rawTarget)
            guard
                target.standardizedFileURL.resolvingSymlinksInPath().path
                    == source.path
            else {
                throw CLIInstallerError.destinationOwnedBySomethingElse(
                    destination.path)
            }
            try fileManager.removeItem(at: destination)
        }

        try fileManager.createSymbolicLink(
            at: destination, withDestinationURL: source)
    }
}
