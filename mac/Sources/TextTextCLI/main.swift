import Foundation
import TextTextCLICore

// The agent's interface to a TextText workspace. Editing is one verb; the
// others let an agent say who it is and where it is working, so it shows up in
// the document like a person. See docs/agent-interoperability.md.

let usage = """
    texttext - work with a TextText workspace

    USAGE
      texttext ls [folder]                     list documents
      texttext search <query>                  find documents by title or content
      texttext read <doc> [--section "## H"]   print content; --json adds its hash
      texttext write <doc> [--from FILE]       replace the body (stdin by default)
      texttext append <doc> [--from FILE]      append to the body
      texttext edit <doc> --section "## H"     replace one section (stdin by default)
      texttext open <doc> [--section "## H"]   open it in TextText
      texttext sections <doc>                  list the headings
      texttext new <title> [--folder F]        create a document
      texttext capture [TEXT] [--folder F]     save a thought, passage, or URL
      texttext lint [<doc>]                    check documents are well formed
      texttext do <command> [--args JSON]      run any workspace command
      texttext commands                        list the commands you may run
      texttext install                         put texttext on your PATH

    OPTIONS
      --as NAME        self-declared agent label for presence and audit
      --message TEXT   what this change is for (recorded with the change)
      --idempotency-key KEY  stable retry key for new, capture, and append
      --if-match-hash HASH   refuse a stale write or section edit
      --from FILE      read input from FILE instead of stdin
      --section NAME   address one section by heading
      --json           machine-readable output

    Documents are addressed by workspace-relative path. A bare name works when it
    matches exactly one document.
    """

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data(("texttext: " + message + "\n").utf8))
    exit(1)
}

func readInput(_ options: CLICommandLineOptions) -> String {
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

let options: CLICommandLineOptions
do {
    options = try CLICommandLineOptions.parse(
        Array(CommandLine.arguments.dropFirst()))
} catch {
    fail(String(describing: error))
}
if options.command.isEmpty || options.command == "help" {
    emit(usage)
    exit(0)
}

if let key = options.idempotencyKey,
    AgentActor.validatedIntent(key) == nil
{
    fail("--idempotency-key must be 1 to 500 characters with no control characters")
}
if let hash = options.ifMatchHash {
    if AgentActor.validatedIntent(hash) == nil {
        fail("--if-match-hash must be 1 to 500 characters with no control characters")
    }
    if options.command != "write" && options.command != "edit" {
        fail("--if-match-hash applies only to write and edit")
    }
}

// Installation must work before TextText is signed in. Resolving a workspace
// here would turn the command that makes the CLI discoverable into an
// authentication-dependent operation.
if options.command == "install" {
    let source = URL(fileURLWithPath: CommandLine.arguments[0])
        .resolvingSymlinksInPath()
    let binDirectory = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".local/bin", isDirectory: true)
    let link = binDirectory.appendingPathComponent("texttext")
    do {
        try CLIInstaller.install(source: source, destination: link)
    } catch {
        fail("could not link into ~/.local/bin: \(error)")
    }
    emit("Linked \(link.path)")
    emit("Add ~/.local/bin to your PATH if it is not there already.")
    exit(0)
}

let store: CLIWorkspace
do {
    store = try CLIWorkspace.locate()
} catch {
    fail(String(describing: error))
}

/// How long a mutation may take before the CLI explains itself.
private let slowWorkSeconds: UInt64 = 8

/// Say what is taking so long, instead of nothing at all.
///
/// A create writes into the TextText folder, and the File Provider extension
/// commits it to the workspace. `replaceItemAt` on that volume blocks until the
/// extension acknowledges, so when the workspace was returning 500s a
/// `texttext new` sat silent for three minutes and then created nothing. The
/// filesystem call cannot be interrupted, but the silence can be broken: a
/// person who knows what it is waiting on can go look at the right thing.
@MainActor
func announcingSlowWork<T>(_ work: () async throws -> T) async rethrows -> T {
    let notice = Task.detached {
        try? await Task.sleep(nanoseconds: slowWorkSeconds * 1_000_000_000)
        FileHandle.standardError.write(
            Data(
                """
                texttext: still working after \(slowWorkSeconds)s. This writes into the                 TextText folder and waits for the sync extension to commit it, which waits                 on the workspace. If the workspace is unreachable this can take minutes.
                """.utf8))
        FileHandle.standardError.write(Data("\n".utf8))
    }
    defer { notice.cancel() }
    return try await work()
}

/// Attribution wraps every mutation. Presence is a best-effort, short-lived
/// signal while the command runs; the audit label remains with the change.
@MainActor
func withActor<T>(
    _ activity: AgentActor.Activity, itemId: String?,
    _ work: () async throws -> T
) async rethrows -> T {
    guard let requestedName = options.actor else {
        return try await announcingSlowWork(work)
    }
    guard let name = AgentActor.validatedName(requestedName) else {
        fail("--as must be 1 to 120 characters with no control characters")
    }
    let intent: String?
    if options.message == nil {
        intent = nil
    } else if let valid = AgentActor.validatedIntent(options.message) {
        intent = valid
    } else {
        fail("--message must be 1 to 500 characters with no control characters")
    }
    let actor = AgentActor(
        name: name, activity: activity,
        section: options.section, message: intent,
        itemId: itemId)
    return try await CLICommandActor.$current.withValue(actor) {
        try await announcingSlowWork(work)
    }
}

@MainActor
func withPresence<T>(
    _ documentPath: String, _ reference: CLIDocumentReference,
    _ activity: AgentActor.Activity,
    _ work: () async throws -> T
) async rethrows -> T {
    try await withActor(activity, itemId: await store.itemId(at: reference)) {
        guard let actor = CLICommandActor.current else { return try await work() }
        return try await PresencePublisher().around(
            document: documentPath, actor: actor, work: work)
    }
}

do {
    switch options.command {
    case "ls":
        let entries = try await store.list(under: options.positional.first)
        if options.json {
            let data = try JSONSerialization.data(
                withJSONObject: entries, options: [.prettyPrinted, .sortedKeys])
            emit(String(decoding: data, as: UTF8.self))
        } else {
            entries.forEach { emit($0) }
        }

    case "search":
        let query = options.positional.joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { fail("usage: texttext search <query>") }
        let results = try await withActor(.open, itemId: nil) {
            try await store.search(query)
        }
        if options.json {
            let payload: [[String: Any]] = results.map { result in
                var entry: [String: Any] = [
                    "hash": result.hash,
                    "id": result.id,
                    "kind": result.kind,
                    "slug": result.slug,
                    "snippet": result.snippet,
                    "status": result.status,
                    "title": result.title,
                ]
                if let folderPath = result.folderPath {
                    entry["folder_path"] = folderPath
                }
                return entry
            }
            let data = try JSONSerialization.data(
                withJSONObject: ["query": query, "results": payload],
                options: [.prettyPrinted, .sortedKeys])
            emit(String(decoding: data, as: UTF8.self))
        } else if results.isEmpty {
            emit("No matches.")
        } else {
            for result in results {
                emit(result.title)
                let location = result.folderPath.map { " · \($0)" } ?? ""
                emit("  \(result.kind) · \(result.status)\(location) · \(result.id)")
                if !result.snippet.isEmpty { emit("  \(result.snippet)") }
            }
        }

    case "sections":
        guard let name = options.positional.first else { fail("usage: texttext sections <doc>") }
        let reference = try await store.resolve(name)
        let headings = DocumentSections.parse(try await store.readMarkdown(at: reference))
            .map { String(repeating: "#", count: $0.level) + " " + $0.title }
        if options.json {
            let data = try JSONSerialization.data(
                withJSONObject: headings, options: [.prettyPrinted])
            emit(String(decoding: data, as: UTF8.self))
        } else {
            headings.forEach { emit($0) }
        }

    case "read":
        guard let name = options.positional.first else { fail("usage: texttext read <doc>") }
        let reference = try await store.resolve(name)
        let content = try await store.readContent(at: reference)
        let markdown = content.markdown
        let output: String
        if let wanted = options.section {
            guard let section = DocumentSections.find(wanted, in: markdown) else {
                throw TextTextCLIError.sectionNotFound(
                    wanted,
                    available: DocumentSections.parse(markdown).map(\.title))
            }
            output = DocumentSections.body(of: section, in: markdown)
        } else {
            output = markdown
        }
        if options.json {
            var payload: [String: Any] = [
                "document": store.relativePath(of: reference),
                "markdown": output,
            ]
            if let hash = content.hash { payload["hash"] = hash }
            if let itemId = await store.itemId(at: reference) {
                payload["item_id"] = itemId
            }
            let data = try JSONSerialization.data(
                withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            emit(String(decoding: data, as: UTF8.self))
        } else {
            emit(output)
        }

    case "write", "append", "edit":
        guard let name = options.positional.first else {
            fail("usage: texttext \(options.command) <doc>")
        }
        let reference = try await store.resolve(name)
        let relative = store.relativePath(of: reference)
        let input = readInput(options)

        try await withPresence(relative, reference, .edit) {
            if options.command == "append" {
                try await store.appendMarkdown(
                    input, to: reference,
                    idempotencyKey: options.idempotencyKey)
                return
            }
            if options.command == "edit" {
                let current = try await store.readContent(at: reference)
                guard let wanted = options.section else {
                    fail("edit needs --section; use write to replace the whole body")
                }
                guard let section = DocumentSections.find(
                    wanted, in: current.markdown
                ) else {
                    throw TextTextCLIError.sectionNotFound(
                        wanted,
                        available: DocumentSections.parse(current.markdown).map(\.title))
                }
                try await store.replaceSectionBody(
                    input, section: section, in: reference,
                    ifMatchHash: options.ifMatchHash)
                return
            }
            try await store.writeMarkdown(
                input, to: reference, ifMatchHash: options.ifMatchHash)
        }
        if options.json {
            emit("{\"ok\":true,\"document\":\"\(relative)\"}")
        }

    case "open":
        guard let name = options.positional.first else { fail("usage: texttext open <doc>") }
        let reference = try await store.resolve(name)
        let relative = store.relativePath(of: reference)
        guard let link = await store.itemLink(for: reference) else {
            fail("\(relative) does not carry a TextText item identity")
        }
        try await withPresence(relative, reference, .open) {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
            process.arguments = [link.absoluteString]
            try process.run()
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
        // There is no item id to publish presence against until the create has
        // committed, but the command-scoped actor still reaches the authenticated
        // create request and its audit record.
        let created = try await withActor(.edit, itemId: nil) {
            try await store.create(
                title: title, body: body,
                folder: options.positional.dropFirst().first ?? options.folder,
                idempotencyKey: options.idempotencyKey)
        }
        let relative = store.relativePath(of: created)
        emit(options.json ? "{\"ok\":true,\"document\":\"\(relative)\"}" : relative)

    case "capture":
        let raw = options.positional.isEmpty
            ? readInput(options)
            : options.positional.joined(separator: " ")
        guard let capture = AgentCaptureInput(value: raw) else {
            fail("usage: texttext capture [TEXT] [--folder FOLDER]")
        }
        let retryStore: CLICaptureRetryIdentityStore?
        let retryLease: CLICaptureRetryLease?
        if options.idempotencyKey == nil, store.usesRemoteSync {
            let identityStore = try CLICaptureRetryIdentityStore.applicationSupport()
            retryStore = identityStore
            retryLease = try identityStore.claim(
                capture: raw, folder: options.folder)
        } else {
            retryStore = nil
            retryLease = nil
        }
        let captured = try await withActor(.edit, itemId: nil) {
            try await store.capture(
                capture, rawValue: raw, folder: options.folder,
                idempotencyKey: options.idempotencyKey
                    ?? retryLease?.idempotencyKey)
        }
        if let retryStore, let retryLease {
            try? retryStore.confirm(retryLease)
        }
        let relative = store.relativePath(of: captured.reference)
        let authoritative = captured.receipt
        if options.json {
            var receipt: [String: Any] = [
                "document": relative,
                "kind": authoritative.kind,
                "ok": true,
                "saved_to": authoritative.savedTo,
                "title": authoritative.title,
            ]
            if let itemId = authoritative.itemId {
                receipt["item_id"] = itemId
            }
            let data = try JSONSerialization.data(
                withJSONObject: receipt, options: [.sortedKeys])
            emit(String(decoding: data, as: UTF8.self))
        } else {
            emit("Saved \(authoritative.title) to \(authoritative.savedTo) (\(relative))")
        }

    case "commands":
        // What this executable may ask the workspace to do. The route decides,
        // and it now allows two dozen; printing them here means an agent can
        // find out rather than guess from the usage block.
        let listed = try await withActor(.open, itemId: nil) {
            try await store.availableCommands()
        }
        emit(listed)

    case "do":
        // A passthrough, deliberately. Wrapping each command in its own verb
        // would mean this executable had to be rebuilt and reinstalled every
        // time the workspace gained one, and an agent on this Mac would be
        // told it may do something it had no way to say.
        guard let name = options.positional.first, !name.isEmpty else {
            fail("usage: texttext do <command> [--args '{\"key\":\"value\"}']")
        }
        let arguments = options.args ?? "{}"
        let reply = try await withActor(.edit, itemId: nil) {
            try await store.runCommand(name, argumentsJSON: arguments)
        }
        emit(reply)

    case "lint":
        // Keep the URL `resolve` returned. Round-tripping it through
        // relativePath and back onto the root broke every absolute path
        // outside the workspace: relativePath passes such a path through
        // unchanged, so re-appending it produced "<root>//tmp/...". A hook
        // lints whatever file was just written, which is exactly that case.
        let targets: [CLIDocumentReference]
        if let name = options.positional.first {
            targets = [try await store.resolve(name)]
        } else {
            targets = try await store.references()
        }
        var findings: [LintFinding] = []
        for target in targets {
            findings += await store.lint(target)
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

    default:
        fail("unknown command \(options.command)\n\n" + usage)
    }
} catch {
    fail(String(describing: error))
}
