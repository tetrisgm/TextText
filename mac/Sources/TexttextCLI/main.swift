import Foundation
import TexttextCLICore

// The agent's interface to a Texttext workspace. Editing is one verb; the
// others let an agent say who it is and where it is working, so it shows up in
// the document like a person. See docs/agent-interoperability.md.

let usage = """
texttext - work with a Texttext workspace

USAGE
  texttext ls [folder]                     list documents
  texttext read <doc> [--section "## H"]   print the body, or one section
  texttext write <doc> [--from FILE]       replace the body (stdin by default)
  texttext append <doc> [--from FILE]      append to the body
  texttext edit <doc> --section "## H"     replace one section (stdin by default)
  texttext open <doc> [--section "## H"]   open it in Texttext
  texttext sections <doc>                  list the headings
  texttext new <title> [--folder F]        create a document
  texttext lint [<doc>]                    check documents are well formed
  texttext install                         put texttext on your PATH

OPTIONS
  --as NAME        who is working (shown in the document while it runs)
  --message TEXT   what this change is for (recorded with the change)
  --from FILE      read input from FILE instead of stdin
  --section NAME   address one section by heading
  --json           machine-readable output

Documents are addressed by workspace-relative path. A bare name works when it
matches exactly one document.
"""

struct Options {
    var command = ""
    var positional: [String] = []
    var section: String?
    var from: String?
    var actor: String?
    var message: String?
    var folder: String?
    var json = false
}

func parse(_ arguments: [String]) -> Options {
    var options = Options()
    var rest = arguments
    if let first = rest.first, !first.hasPrefix("-") {
        options.command = first
        rest.removeFirst()
    }
    var index = 0
    while index < rest.count {
        let argument = rest[index]
        func value() -> String? {
            index += 1
            return index < rest.count ? rest[index] : nil
        }
        switch argument {
        case "--section", "-s": options.section = value()
        case "--from", "-f": options.from = value()
        case "--as": options.actor = value()
        case "--message", "-m": options.message = value()
        case "--folder": options.folder = value()
        case "--json": options.json = true
        case "--help", "-h": options.command = "help"
        default:
            if !argument.hasPrefix("-") { options.positional.append(argument) }
        }
        index += 1
    }
    return options
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(("texttext: " + message + "\n").utf8))
    exit(1)
}

func readInput(_ options: Options) -> String {
    if let from = options.from {
        guard let data = FileManager.default.contents(atPath: from),
              let text = String(data: data, encoding: .utf8)
        else { fail("could not read \(from)") }
        return text
    }
    let data = FileHandle.standardInput.readDataToEndOfFile()
    return String(data: data, encoding: .utf8) ?? ""
}

func emit(_ text: String) {
    FileHandle.standardOutput.write(Data((text + "\n").utf8))
}

let options = parse(Array(CommandLine.arguments.dropFirst()))
if options.command.isEmpty || options.command == "help" {
    emit(usage)
    exit(0)
}

let store: DocumentStore
do {
    store = try DocumentStore.locate()
} catch {
    fail(String(describing: error))
}

/// Presence wraps every mutation, so an agent shows up in the document simply by
/// doing its work.
func withPresence<T>(
    _ documentPath: String, _ url: URL, _ activity: AgentActor.Activity,
    _ work: () throws -> T
) rethrows -> T {
    guard let name = options.actor else { return try work() }
    let actor = AgentActor(
        name: name, activity: activity,
        section: options.section, message: options.message,
        itemId: store.itemId(at: url))
    return try PresencePublisher().around(document: documentPath, actor: actor, work: work)
}

do {
    switch options.command {
    case "ls":
        let entries = try store.list(under: options.positional.first)
        if options.json {
            let data = try JSONSerialization.data(
                withJSONObject: entries, options: [.prettyPrinted, .sortedKeys])
            emit(String(decoding: data, as: UTF8.self))
        } else {
            entries.forEach { emit($0) }
        }

    case "sections":
        guard let name = options.positional.first else { fail("usage: texttext sections <doc>") }
        let url = try store.resolve(name)
        let headings = DocumentSections.parse(try store.readMarkdown(at: url))
            .map { String(repeating: "#", count: $0.level) + " " + $0.title }
        if options.json {
            let data = try JSONSerialization.data(withJSONObject: headings, options: [.prettyPrinted])
            emit(String(decoding: data, as: UTF8.self))
        } else {
            headings.forEach { emit($0) }
        }

    case "read":
        guard let name = options.positional.first else { fail("usage: texttext read <doc>") }
        let url = try store.resolve(name)
        let markdown = try store.readMarkdown(at: url)
        if let wanted = options.section {
            guard let section = DocumentSections.find(wanted, in: markdown) else {
                throw TexttextCLIError.sectionNotFound(
                    wanted,
                    available: DocumentSections.parse(markdown).map(\.title))
            }
            emit(DocumentSections.body(of: section, in: markdown))
        } else {
            emit(markdown)
        }

    case "write", "append", "edit":
        guard let name = options.positional.first else {
            fail("usage: texttext \(options.command) <doc>")
        }
        let url = try store.resolve(name)
        let relative = store.relativePath(of: url)
        let input = readInput(options)

        try withPresence(relative, url, .edit) {
            let current = try store.readMarkdown(at: url)
            let updated: String
            switch options.command {
            case "write":
                updated = input
            case "append":
                let separator = current.hasSuffix("\n") ? "" : "\n"
                updated = current + separator + input
            default:
                guard let wanted = options.section else {
                    fail("edit needs --section; use write to replace the whole body")
                }
                guard let section = DocumentSections.find(wanted, in: current) else {
                    throw TexttextCLIError.sectionNotFound(
                        wanted,
                        available: DocumentSections.parse(current).map(\.title))
                }
                updated = DocumentSections.replaceBody(
                    of: section, in: current, with: input)
            }
            try store.writeMarkdown(updated, to: url)
        }
        if options.json {
            emit("{\"ok\":true,\"document\":\"\(relative)\"}")
        }

    case "open":
        guard let name = options.positional.first else { fail("usage: texttext open <doc>") }
        let url = try store.resolve(name)
        let relative = store.relativePath(of: url)
        var link = "write-app://open?path=" + (relative
            .addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? relative)
        if let section = options.section,
           let encoded = section.addingPercentEncoding(withAllowedCharacters: .alphanumerics)
        {
            link += "&section=" + encoded
        }
        withPresence(relative, url, .open) {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
            process.arguments = [link]
            try? process.run()
            process.waitUntilExit()
        }

    case "new":
        guard let title = options.positional.first else {
            fail("usage: texttext new <title> [--folder FOLDER]")
        }
        // A body on stdin is optional: `texttext new "Notes" < draft.md` works,
        // and so does creating an empty document to fill in later.
        let body: String = {
            if options.from != nil { return readInput(options) }
            return isatty(FileHandle.standardInput.fileDescriptor) == 1
                ? "" : readInput(options)
        }()
        let created = try store.create(
            title: title, body: body,
            folder: options.positional.dropFirst().first ?? options.folder)
        let relative = store.relativePath(of: created)
        emit(options.json ? "{\"ok\":true,\"document\":\"\(relative)\"}" : relative)

    case "lint":
        let targets: [String]
        if let name = options.positional.first {
            targets = [store.relativePath(of: try store.resolve(name))]
        } else {
            targets = try store.list()
        }
        var findings: [LintFinding] = []
        for relative in targets {
            findings += DocumentLinter.check(
                store.root.appendingPathComponent(relative), named: relative)
        }
        if options.json {
            let payload = findings.map { ["document": $0.document, "problem": $0.problem] }
            let data = try JSONSerialization.data(
                withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            emit(String(decoding: data, as: UTF8.self))
        } else if findings.isEmpty {
            emit("\(targets.count) document(s) OK")
        } else {
            findings.forEach { emit($0.description) }
        }
        // A nonzero exit is what lets a hook block an agent on a broken document.
        if !findings.isEmpty { exit(1) }

    case "install":
        let source = URL(fileURLWithPath: CommandLine.arguments[0])
            .resolvingSymlinksInPath()
        let binDirectory = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".local/bin", isDirectory: true)
        let link = binDirectory.appendingPathComponent("texttext")
        do {
            try FileManager.default.createDirectory(
                at: binDirectory, withIntermediateDirectories: true)
            try? FileManager.default.removeItem(at: link)
            try FileManager.default.createSymbolicLink(
                at: link, withDestinationURL: source)
        } catch {
            fail("could not link into ~/.local/bin: \(error)")
        }
        emit("Linked \(link.path)")
        emit("Add ~/.local/bin to your PATH if it is not there already.")

    default:
        fail("unknown command \(options.command)\n\n" + usage)
    }
} catch {
    fail(String(describing: error))
}
