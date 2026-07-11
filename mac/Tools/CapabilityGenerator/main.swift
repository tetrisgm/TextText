import Foundation
import WriteCapabilitySpec

struct Arguments {
    var manifestPath = "mac/Resources/AppCapabilities.yaml"
    var outputRoot = "."
}

func parseArguments(_ raw: [String]) throws -> Arguments {
    var args = Arguments()
    var index = 0
    while index < raw.count {
        let flag = raw[index]
        switch flag {
        case "--manifest":
            index += 1
            guard index < raw.count else { throw CapabilityManifestError.invalidValue("Missing value for --manifest") }
            args.manifestPath = raw[index]
        case "--output-root":
            index += 1
            guard index < raw.count else { throw CapabilityManifestError.invalidValue("Missing value for --output-root") }
            args.outputRoot = raw[index]
        case "--help", "-h":
            print("Usage: capability-generator --manifest mac/Resources/AppCapabilities.yaml --output-root .")
            exit(0)
        default:
            throw CapabilityManifestError.invalidValue("Unknown argument \(flag)")
        }
        index += 1
    }
    return args
}

func writeIfChanged(_ contents: String, to url: URL) throws {
    let data = Data(contents.utf8)
    if let existing = try? Data(contentsOf: url), existing == data { return }
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try data.write(to: url, options: .atomic)
}

do {
    let arguments = try parseArguments(Array(CommandLine.arguments.dropFirst()))
    let manifestURL = URL(fileURLWithPath: arguments.manifestPath)
    let manifestText = try String(contentsOf: manifestURL, encoding: .utf8)
    let manifest = try CapabilityManifestYAML.parse(manifestText)
    let outputRoot = URL(fileURLWithPath: arguments.outputRoot, isDirectory: true)
    for file in CapabilityGeneratorRenderer.renderOutputs(manifest: manifest) {
        try writeIfChanged(file.contents, to: outputRoot.appendingPathComponent(file.relativePath))
        print("wrote \(file.relativePath)")
    }
} catch {
    fputs("capability-generator: \(error.localizedDescription)\n", stderr)
    exit(1)
}
