#if TEXTTEXT_STRESS_ACTOR
import AppKit
import Darwin
import Foundation
import WebKit
import TextTextFileProviderKit
import TextTextWorkspaceCore

// Mailbox actor for sync/stress/coordinator.mjs (role mac-app). This is the Mac
// counterpart of windows/TextText.LiveAcceptance/Stress.cs.
//
// The coordinator's JSONL stdin/stdout is relayed by mac/scripts/stress-native.py
// through numbered request files (req-000001.json ...) in a fresh session
// directory; this runner answers each with the matching numbered reply file
// (rep-000001.json ...). Serial: request n+1 is only handled after reply n
// exists, so AppKit's run loop stays responsive and nothing blocks on a pipe.
//
// Everything that touches the document goes through the production
// LocalVaultWindowController: the bundled LocalVault entry, the real StateStore
// credential, the configured workspace root, the production connection and
// collaboration engine, and the production flush. Edits are typed into the real
// WKWebView through the native text input pipeline. Nothing here appends through
// the CLI, mutates Yjs, writes the TextPack, or talks to the server on its own.
//
// Building. This whole file and the `--stress` entry in main.swift are compiled
// only when the TEXTTEXT_STRESS_ACTOR condition is defined, so ordinary product
// builds (mac/scripts/build-app.sh, release/ship.sh) contain none of it:
//
//   swift build -c release --triple arm64-apple-macosx14.0 --package-path mac \
//       -Xswiftc -DTEXTTEXT_STRESS_ACTOR --product TextTextApp
//
// The runner needs a real .app bundle (LocalVault resources, Info.plist, app
// group entitlement for the shared state directory). The build scripts are not
// changed by this feature; assemble the actor bundle by hand from a normal local
// build: copy that .app to a private location, replace Contents/MacOS/TextText
// with the flagged executable above, and re-sign it with the same identity and
// entitlements. Never install the actor bundle to /Applications and never ship
// it; it is a disposable test executable that the relay script points at
// explicitly.
//
// Invocation (always through mac/scripts/stress-native.py, never by hand):
//
//   <actor.app>/Contents/MacOS/TextText --stress <config.json> <session-dir>
//
// config.json: { "file": "/abs/.../Six-client acceptance X.textpack",
//                "itemId": "<uuid>", "workspaceId": "<id>",
//                "title": "Six-client acceptance X", "totalMinutes": 20 }
enum NativeStressActor {
    static let bundleIdentifierOfInstalledApp = "app.texttext.mac"
    static let roleServed = "mac-app"
    static let titlePrefix = "Six-client acceptance "
    static let maxRequestBytes = 256 * 1024
    static let maxText = 64 * 1024
    static let maxEditText = 1024
    static let observeBound: TimeInterval = 30
    static let editBound: TimeInterval = 15
    static let readyBound: TimeInterval = 45
    nonisolated(unsafe) static var retainedDelegate: Delegate?

    struct Config: Decodable {
        let file: String
        let itemId: String
        let workspaceId: String
        let title: String
        let totalMinutes: Int?
    }

    struct Validated {
        let fileURL: URL
        let relativePath: String
        let root: URL
        let itemId: String
        let workspaceId: String
        let title: String
        let totalMinutes: Int
    }

    struct Failure: LocalizedError {
        let message: String
        init(_ message: String) { self.message = message }
        var errorDescription: String? { message }
    }

    /// Entry from main.swift: `--stress <config> <session>`. Never returns.
    static func run(arguments: [String]) -> Never {
        do {
            guard arguments.count == 4, arguments[1] == "--stress" else {
                throw Failure("usage: TextText --stress <config.json> <session-dir>")
            }
            let session = URL(fileURLWithPath: arguments[3], isDirectory: true)
            let validated = try validate(configPath: arguments[2], session: session)
            try refuseConcurrentNativeProcesses()
            let lock = try acquireLock()
            let app = NSApplication.shared
            _ = app.setActivationPolicy(.regular)
            let delegate = Delegate(validated: validated, session: session, lock: lock)
            retainedDelegate = delegate   // NSApplication.delegate is unowned
            app.delegate = delegate
            app.run()
            exit(1)
        } catch {
            FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
            exit(1)
        }
    }

    // MARK: Preflight (no UI yet)

    static func validate(configPath: String, session: URL) throws -> Validated {
        guard configPath.hasPrefix("/"), session.path.hasPrefix("/") else { throw Failure("Config and session must be absolute paths.") }
        let attributes = try FileManager.default.attributesOfItem(atPath: configPath)
        guard (attributes[.size] as? NSNumber)?.intValue ?? Int.max <= 16 * 1024 else { throw Failure("Stress config is too large.") }
        let config = try JSONDecoder().decode(Config.self, from: Data(contentsOf: URL(fileURLWithPath: configPath)))
        let totalMinutes = config.totalMinutes ?? 20
        let fileURL = URL(fileURLWithPath: config.file)
        let stem = fileURL.deletingPathExtension().lastPathComponent
        guard config.file.hasPrefix("/"), fileURL.pathExtension.lowercased() == "textpack",
              config.title.hasPrefix(titlePrefix), config.title.count <= 200, stem == config.title,
              UUID(uuidString: config.itemId) != nil,
              config.workspaceId.range(of: "^[a-zA-Z0-9_-]{1,80}$", options: .regularExpression) != nil,
              (1...120).contains(totalMinutes) else {
            throw Failure("Invalid stress config: absolute .textpack file, UUID itemId, workspaceId, title starting '\(titlePrefix)' equal to the file name, totalMinutes 1..120.")
        }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: session.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            throw Failure("Stress session directory must be an existing absolute directory created by the relay.")
        }
        let existing = try FileManager.default.contentsOfDirectory(atPath: session.path)
        guard !existing.contains(where: { $0.hasPrefix("rep-") || $0 == "events.jsonl" || $0 == "result.json" }) else {
            throw Failure("Stress session directory was already used; use a new session directory.")
        }
        // The same credential and root the product uses; nothing is overridden.
        guard StateStore().loadCredentials() != nil else { throw Failure("TextText is not signed in on this Mac; the actor never obtains credentials.") }
        guard let configuration = try LocalVaultConfiguration.load() else { throw Failure("No workspace folder is configured; the actor never selects a root.") }
        let root = try configuration.resolvingRoot()
        let scoped = root.startAccessingSecurityScopedResource()
        defer { if scoped { root.stopAccessingSecurityScopedResource() } }
        let rootPath = root.standardizedFileURL.resolvingSymlinksInPath().path + "/"
        let filePath = fileURL.standardizedFileURL.resolvingSymlinksInPath().path
        guard filePath.hasPrefix(rootPath) else { throw Failure("Test file is not inside the configured workspace root; workspace selection was not changed.") }
        guard let binding = try PortableWorkspaceBinding.read(root: root), binding.workspaceId == config.workspaceId else {
            throw Failure("Configured workspace root is not bound to the fixture workspace.")
        }
        let relativePath = String(filePath.dropFirst(rootPath.count))
        let document = try LocalVaultDocumentStore(root: root).read(path: relativePath)
        guard MarkdownIdentityCodec.extract(from: document.contents.markdown)?.itemId.lowercased() == config.itemId.lowercased() else {
            throw Failure("Test file identity mismatch.")
        }
        return Validated(fileURL: fileURL, relativePath: relativePath, root: root, itemId: config.itemId,
                         workspaceId: config.workspaceId, title: config.title, totalMinutes: totalMinutes)
    }

    /// Two native editors on one device journal would corrupt the acceptance
    /// evidence. The orchestrator closes the installed app first; this refuses
    /// to proceed if it, or another copy of this actor, is still running.
    static func refuseConcurrentNativeProcesses() throws {
        var identifiers = [bundleIdentifierOfInstalledApp]
        if let own = Bundle.main.bundleIdentifier, own != bundleIdentifierOfInstalledApp { identifiers.append(own) }
        for identifier in identifiers {
            let others = NSRunningApplication.runningApplications(withBundleIdentifier: identifier)
                .filter { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }
            if !others.isEmpty { throw Failure("Close TextText before running the stress actor; two native writers must not share its device journal.") }
        }
    }

    /// Advisory lock in the app's own state directory (mode 0600, never removed).
    static func acquireLock() throws -> Int32 {
        let path = StateStore().baseDir.appendingPathComponent("stress-native.lock").path
        let fd = open(path, O_CREAT | O_RDWR | O_CLOEXEC, 0o600)
        guard fd >= 0 else { throw Failure("Cannot open the stress actor lock file.") }
        guard flock(fd, LOCK_EX | LOCK_NB) == 0 else { close(fd); throw Failure("Another stress actor holds the native lock; refusing to share the device journal.") }
        return fd
    }

    static func hostName() -> String {
        var buffer = [CChar](repeating: 0, count: 256)
        guard gethostname(&buffer, buffer.count - 1) == 0 else { return "" }
        return String(cString: buffer)
    }

    // MARK: App lifecycle

    final class Delegate: NSObject, NSApplicationDelegate {
        let validated: Validated
        let session: URL
        let lock: Int32
        var runner: NativeStressRunner?
        init(validated: Validated, session: URL, lock: Int32) { self.validated = validated; self.session = session; self.lock = lock }

        func applicationDidFinishLaunching(_ notification: Notification) {
            guard let entry = LocalVaultWindowController.entryURL else {
                FileHandle.standardError.write(Data("The local editor is missing from this build.\n".utf8)); exit(1)
            }
            let store = StateStore()
            // AppDelegate normally installs the device-local journal base before
            // constructing the workspace controller. Reproduce that bootstrap.
            LocalVaultDeviceState.configure(base: store.baseDir)
            // Identical to AppDelegate.openLocalVaultAction: the production controller,
            // bundled entry, configured root (loaded by the controller itself) and the
            // real credential provider. It connects and syncs on its own.
            let controller = LocalVaultWindowController(entry: entry, credentials: {
                guard let account = store.loadCredentials() else { return nil }
                return (resolveServerOrigin(credentials: account), account.token)
            })
            let runner = NativeStressRunner(controller: controller, validated: validated, session: session)
            self.runner = runner
            Task { @MainActor in
                let code = await runner.main()
                controller.shutdown()
                exit(code)
            }
        }
        func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
            // Cmd-Q or a system quit during a run: flush through production first.
            guard let runner else { return .terminateNow }
            Task { @MainActor in
                _ = await runner.flush()
                runner.finish()
                exit(runner.failure == nil ? 0 : 1)
            }
            return .terminateCancel
        }
        func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    }
}

@MainActor
final class NativeStressRunner {
    private let controller: LocalVaultWindowController
    private let webView: WKWebView
    private let config: NativeStressActor.Validated
    private let session: URL
    private let log: FileHandle
    private let sessionId = "editor-" + UUID().uuidString.lowercased()
    private let adapterName: String
    private let deadline: Date
    private(set) var failure: String?
    private var opened = false
    private var flushed: Bool?
    private var reloads = 0
    private var finished = false
    private static let marker = try! NSRegularExpression(pattern: #"\[(mac|pc)-(app|web|cli) r(\d+) [a-z]+\d+\]"#)
    private static let editId = try! NSRegularExpression(pattern: #"^r\d{1,5}-mac-app$"#)

    init(controller: LocalVaultWindowController, validated: NativeStressActor.Validated, session: URL) {
        self.controller = controller
        // LocalVaultWindowController installs its WKWebView as the window content view.
        self.webView = (controller.window?.contentView as? WKWebView) ?? WKWebView()
        self.config = validated
        self.session = session
        self.deadline = Date().addingTimeInterval(TimeInterval(validated.totalMinutes * 60))
        let logURL = session.appendingPathComponent("events.jsonl")
        FileManager.default.createFile(atPath: logURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
        self.log = (try? FileHandle(forWritingTo: logURL)) ?? FileHandle.standardError
        let version = (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev")
            + "+" + (Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0")
        self.adapterName = "native-localvault/\(version)"
    }

    // MARK: Logging and replies (never credentials, never file paths from the config)

    private func record(_ value: [String: Any]) {
        var line: [String: Any] = ["utc": ISO8601DateFormatter().string(from: Date())]
        line["value"] = value
        guard let data = try? JSONSerialization.data(withJSONObject: line, options: [.sortedKeys]) else { return }
        log.write(data); log.write(Data("\n".utf8))
    }

    func fail(_ message: String) {
        if failure == nil { failure = message }
        record(["kind": "failure", "message": message])
    }

    private func reply(_ seq: Int, _ message: [String: Any]) throws {
        let final = session.appendingPathComponent(String(format: "rep-%06d.json", seq))
        let temporary = session.appendingPathComponent(String(format: "rep-%06d.json.tmp", seq))
        let data = try JSONSerialization.data(withJSONObject: message, options: [.sortedKeys])
        try data.write(to: temporary, options: .atomic)
        try FileManager.default.moveItem(at: temporary, to: final)
        record(["kind": "reply", "seq": seq, "type": message["type"] as? String ?? ""])
    }

    /// Writes result.json once. Safe to call from every exit path.
    func finish() {
        guard !finished else { return }
        finished = true
        let result: [String: Any] = ["ok": failure == nil && flushed == true, "flushed": flushed ?? false,
                                     "error": failure as Any? ?? NSNull(), "itemId": config.itemId]
        if let data = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]) {
            try? data.write(to: session.appendingPathComponent("result.json"), options: .atomic)
        }
    }

    // MARK: Main loop

    func main() async -> Int32 {
        record(["kind": "start", "itemId": config.itemId, "workspaceId": config.workspaceId,
                "adapter": "production LocalVaultWindowController + WKWebView native input", "mockedTransport": false,
                "nativeVersion": adapterName])
        do {
            try await loop()
        } catch {
            fail(error.localizedDescription)
            if let surface = try? await evaluate("JSON.stringify({heading:document.querySelector('.vault-context-location h2')?.textContent,notices:[...document.querySelectorAll('[role=alert],.vault-notice')].map(x=>x.textContent),editor:!!document.querySelector('[aria-label=\"Document body\"]')?.isContentEditable})") {
                record(["kind": "failure-surface", "state": String(surface.prefix(4096))])
            }
        }
        // Production flush-on-close. A failed flush keeps journals and the failure recorded.
        let ok = await flush()
        finish()
        return failure == nil && ok ? 0 : 1
    }

    private func loop() async throws {
        var seq = 1
        while Date() < deadline {
            guard let request = try await nextRequest(seq) else { break }
            let type = request["type"] as? String ?? ""
            let round = request["round"] as? Int ?? 0
            record(["kind": "request", "seq": seq, "type": type, "round": round])
            if type == "shutdown" {
                let ok = await flush()
                try reply(seq, ["type": "shutdown-ack", "ok": ok && failure == nil])
                return
            }
            let response: [String: Any]
            if let failed = failure {
                response = ["type": "error", "round": round, "message": "Adapter already failed: " + failed]
            } else {
                do { response = try await handle(type: type, round: round, request: request) }
                catch {
                    fail(error.localizedDescription)
                    if let surface = try? await evaluate("JSON.stringify({heading:document.querySelector('.vault-context-location h2')?.textContent,buttons:[...document.querySelectorAll('button')].map(x=>x.getAttribute('aria-label')||x.textContent?.trim()).filter(Boolean).slice(0,30),visibleText:document.body.innerText.slice(-700),editor:!!document.querySelector('[aria-label=\"Document body\"]')?.isContentEditable,collab:document.querySelector('[data-collaboration-state]')?.getAttribute('data-collaboration-state')})") {
                        record(["kind": "failure-surface", "state": String(surface.prefix(4096))])
                    }
                    response = ["type": "error", "round": round, "message": error.localizedDescription]
                }
            }
            try reply(seq, response)
            seq += 1
        }
        if Date() >= deadline { fail("Stress adapter total time limit reached.") }
    }

    private func nextRequest(_ seq: Int) async throws -> [String: Any]? {
        let path = session.appendingPathComponent(String(format: "req-%06d.json", seq))
        while Date() < deadline {
            if let attributes = try? FileManager.default.attributesOfItem(atPath: path.path) {
                guard (attributes[.size] as? NSNumber)?.intValue ?? Int.max <= NativeStressActor.maxRequestBytes else {
                    throw NativeStressActor.Failure("Request \(seq) exceeds the message bound.")
                }
                if let data = try? Data(contentsOf: path) {
                    guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                        throw NativeStressActor.Failure("Request \(seq) is not valid JSON.")
                    }
                    return object
                }
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        return nil
    }

    private func handle(type: String, round: Int, request: [String: Any]) async throws -> [String: Any] {
        switch type {
        case "hello":
            guard request["role"] as? String == NativeStressActor.roleServed else { throw NativeStressActor.Failure("This native adapter only serves the \(NativeStressActor.roleServed) role.") }
            guard request["mode"] as? String == "real" else { throw NativeStressActor.Failure("The native adapter only runs real mode; it cannot simulate.") }
            let fixture = request["fixture"] as? [String: Any] ?? [:]
            guard fixture["itemId"] as? String == config.itemId, fixture["workspaceId"] as? String == config.workspaceId else {
                throw NativeStressActor.Failure("Coordinator fixture does not match the configured test item and workspace.")
            }
            try await open()
            return ["type": "attest", "round": 0, "mode": "real", "workspaceId": config.workspaceId, "itemId": config.itemId,
                    "machineId": NativeStressActor.hostName(), "adapter": adapterName]
        case "prepare":
            try await requireSelected()
            return ["type": "ready", "round": round]
        case "edit":
            try await requireSelected()
            guard let edit = request["edit"] as? [String: Any], edit["op"] as? String == "append" else { throw NativeStressActor.Failure("Only append edits are supported.") }
            let id = edit["id"] as? String ?? ""
            let text = edit["text"] as? String ?? ""
            guard Self.editId.firstMatch(in: id, range: NSRange(id.startIndex..., in: id)) != nil,
                  !text.isEmpty, text.count <= NativeStressActor.maxEditText, !text.contains("\n"), !text.contains("\r") else {
                throw NativeStressActor.Failure("Edit id or text is out of bounds for this adapter.")
            }
            try await append(id: id, text: text)
            return ["type": "applied", "round": round, "editId": id]
        case "observe":
            try await requireSelected()
            let raw = request["expectedEditIds"] as? [Any] ?? []
            guard raw.count <= 10_000 else { throw NativeStressActor.Failure("Expected edit id list is out of bounds.") }
            let expected = raw.compactMap { $0 as? String }.filter { $0.count <= 64 }.sorted()
            let (text, editIds) = try await observe(expected: expected)
            let continuous = try await evaluate("window.texttextStressContinuity?.removed === false") == "true"
            let sessionSeen = try await evaluate("window.texttextStressSession ?? null")
            let sessionPresent = sessionSeen == "\"\(sessionId)\""
            if !continuous || !sessionPresent { reloads += 1 }
            record(["kind": "observed", "round": round, "continuous": continuous, "sessionPresent": sessionPresent, "reloads": reloads, "editIds": editIds])
            return ["type": "state", "round": round, "text": text, "editIds": editIds, "editor": ["sessionId": sessionId, "reloads": reloads]]
        default:
            throw NativeStressActor.Failure("Unsupported coordinator message type.")
        }
    }

    // MARK: Production editor

    /// Evaluates JavaScript in the page and returns its JSON-serialised value.
    /// Only reads DOM state, places the caret, and clicks the production edit
    /// action; it never writes document content.
    private func evaluate(_ script: String) async throws -> String {
        let wrapped = "JSON.stringify((()=>{ return (\(script)); })() ?? null)"
        return try await withCheckedThrowingContinuation { continuation in
            webView.evaluateJavaScript(wrapped) { value, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: value as? String ?? "null") }
            }
        }
    }

    private func until(_ message: String, bound: TimeInterval = NativeStressActor.readyBound, _ condition: () async throws -> Bool) async throws {
        let end = Date().addingTimeInterval(bound)
        while Date() < end && Date() < deadline {
            if try await condition() { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        throw NativeStressActor.Failure(message)
    }

    private var expectedTitle: String { Self.json(config.title) }
    private var expectedItem: String { Self.json(config.itemId.lowercased()) }
    private static func json(_ value: String) -> String {
        String(data: try! JSONSerialization.data(withJSONObject: [value]), encoding: .utf8)!.dropFirst().dropLast().description
    }

    /// Ported from Stress.cs Open: production ready, same root, activation through
    /// the production openFile path, real editor, shared document.
    private func open() async throws {
        guard !opened else { throw NativeStressActor.Failure("Duplicate hello.") }
        let saved = StateStore().loadCredentials()
        let portable = try? PortableWorkspaceBinding.read(root: config.root)
        let local = try? LocalVaultSync.binding(root: config.root)
        record(["kind": "binding-preflight", "savedCredential": saved != nil,
                "originMatchesPortable": saved.map { resolveServerOrigin(credentials: $0) == portable?.origin } ?? false,
                "workspaceMatchesPortable": portable?.workspaceId == config.workspaceId,
                "workspaceMatchesLocal": local?.workspaceId == config.workspaceId,
                "rootReadable": FileManager.default.isReadableFile(atPath: config.root.path)])
        controller.present()
        try await until("Production editor did not become ready with its saved sign-in.") {
            try await self.evaluate("typeof window.texttextOpenFile === 'function'") == "true"
        }
        record(["kind": "workspace-ready"])
        guard controller.openFile(config.fileURL) else { throw NativeStressActor.Failure("Production refused to open the test file; the controller root differs from the configured workspace.") }
        try await until("Production file activation did not open the test item.") {
            try await self.evaluate("document.querySelector('.vault-context-location h2')?.textContent?.trim() === \(self.expectedTitle)") == "true"
        }
        try await until("Test reader did not expose its edit action.") {
            try await self.evaluate("!!document.querySelector('button[aria-label=\"Edit card\"]') || !!document.querySelector('[aria-label=\"Document body\"]')?.isContentEditable") == "true"
        }
        _ = try await evaluate("(document.querySelector('button[aria-label=\"Edit card\"]')?.click(), true)")
        try await until("Test item did not enter the real document editor.") {
            try await self.evaluate("!!document.querySelector('[aria-label=\"Document body\"]')?.isContentEditable") == "true"
        }
        try await until("Test editor did not join the shared document; a local-only editor cannot pass six-client readiness.") {
            try await self.evaluate("(()=>{const shared=document.querySelector('[data-collaboration-state=\"ready\"]');return (shared?.dataset.collaborationItem||'').toLowerCase() === \(self.expectedItem) && !!shared.querySelector('[aria-label=\"Document body\"]')?.isContentEditable})()") == "true"
        }
        // Page-global session marker and a MutationObserver on the original editor
        // node; both vanish on any reload or editor remount and are checked each observe.
        _ = try await evaluate("(()=>{const initial=document.querySelector('[aria-label=\"Document body\"]');window.texttextStressSession=\(Self.json(sessionId));window.texttextStressContinuity={removed:false};const observer=new MutationObserver(()=>{if(!initial.isConnected){window.texttextStressContinuity.removed=true;observer.disconnect()}});observer.observe(document.body,{childList:true,subtree:true});return true})()")
        opened = true
        record(["kind": "ready", "itemId": config.itemId, "sessionId": sessionId])
    }

    private func requireSelected() async throws {
        guard opened else { throw NativeStressActor.Failure("Editor is not open; hello must succeed first.") }
        let ok = try await evaluate("(()=>{const shared=document.querySelector('[data-collaboration-item]');return document.querySelector('.vault-context-location h2')?.textContent?.trim() === \(expectedTitle) && ['ready','saving'].includes(shared?.dataset.collaborationState) && (shared?.dataset.collaborationItem||'').toLowerCase() === \(expectedItem) && !!shared.querySelector('[aria-label=\"Document body\"]')?.isContentEditable})()")
        guard ok == "true" else { throw NativeStressActor.Failure("Editor is no longer on the dedicated test item in the shared document.") }
        guard Date() < deadline else { throw NativeStressActor.Failure("Stress adapter total time limit reached.") }
    }

    /// Actual visible body text, after re-validating the title. `nil` when the editor is absent.
    private func body() async throws -> String? {
        let raw = try await evaluate("({title:document.querySelector('.vault-context-location h2')?.textContent?.trim()??null,body:document.querySelector('[aria-label=\"Document body\"]')?.textContent??null})")
        guard let parsed = try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any] else { throw NativeStressActor.Failure("Editor snapshot was not readable.") }
        guard parsed["title"] as? String == config.title else { throw NativeStressActor.Failure("Editor navigated away from the dedicated test item.") }
        return parsed["body"] as? String
    }

    private static func occurrences(of needle: String, in text: String) -> Int {
        text.components(separatedBy: needle).count - 1
    }

    private func append(id: String, text: String) async throws {
        guard let before = try await body() else { throw NativeStressActor.Failure("Test editor body is not present.") }
        guard !before.contains(text) else { throw NativeStressActor.Failure("Edit text already present before input: " + id) }
        // Real contenteditable focus and a collapsed selection at the end (selection
        // only, no content mutation), then the exact text through native input.
        let focused = try await evaluate("(()=>{const e=document.querySelector('[aria-label=\"Document body\"]');if(!e||!e.isContentEditable)return false;e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);const s=window.getSelection();s.removeAllRanges();s.addRange(r);return true})()")
        guard focused == "true" else { throw NativeStressActor.Failure("Could not place the caret in the document body.") }
        let path = try insertNatively(text)
        record(["kind": "input", "editId": id, "path": path])
        let end = Date().addingTimeInterval(NativeStressActor.editBound)
        while true {
            if let current = try await body(), Self.occurrences(of: text, in: current) == 1 { return }
            guard Date() < end else { throw NativeStressActor.Failure("Inserted text did not appear exactly once in the visible editor: " + id) }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
    }

    /// Native text entry into the production WKWebView. Preferred: the view's
    /// NSTextInputClient `insertText(_:replacementRange:)`, which WebKit routes
    /// through its real editing command pipeline (the same path an input method
    /// or dictation uses). If the running WebKit does not expose that
    /// conformance, synthesized NSEvent key presses are sent through the
    /// application instead. Both paths need this window to be key and the app
    /// active; the orchestrator must leave the GUI session unlocked.
    private func insertNatively(_ text: String) throws -> String {
        guard let window = controller.window else { throw NativeStressActor.Failure("The editor window is gone.") }
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        guard window.makeFirstResponder(webView) else { throw NativeStressActor.Failure("The web view refused first responder.") }
        if let client = webView as? NSTextInputClient {
            client.insertText(text, replacementRange: NSRange(location: NSNotFound, length: 0))
            return "NSTextInputClient.insertText"
        }
        for scalar in text.unicodeScalars {
            let character = String(scalar)
            for kind in [NSEvent.EventType.keyDown, .keyUp] {
                guard let event = NSEvent.keyEvent(with: kind, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                                   windowNumber: window.windowNumber, context: nil, characters: character,
                                                   charactersIgnoringModifiers: character, isARepeat: false, keyCode: 0) else {
                    throw NativeStressActor.Failure("Could not synthesize a keyboard event.")
                }
                NSApp.sendEvent(event)
            }
        }
        return "NSEvent keyboard"
    }

    /// Sample until the marker-derived edit IDs equal the expected set and the text
    /// is stable, at most 30 s; report what was actually seen either way.
    private func observe(expected: [String]) async throws -> (String, [String]) {
        let end = Date().addingTimeInterval(NativeStressActor.observeBound)
        var last = "", ids: [String] = [], stable = 0
        while true {
            if let current = try await body() {
                guard current.utf16.count <= NativeStressActor.maxText else { throw NativeStressActor.Failure("Visible editor text exceeds the protocol bound.") }
                ids = Self.editIds(in: current)
                stable = current == last ? stable + 1 : 0
                last = current
                if stable >= 2 && ids == expected { break }
            }
            guard Date() < end else { record(["kind": "observe-timeout", "stable": stable, "expected": expected.count, "actual": ids.count]); break }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
        return (last, ids)
    }

    private static func editIds(in text: String) -> [String] {
        let range = NSRange(text.startIndex..., in: text)
        var seen = Set<String>()
        for match in marker.matches(in: text, range: range) {
            guard let machine = Range(match.range(at: 1), in: text), let client = Range(match.range(at: 2), in: text),
                  let round = Range(match.range(at: 3), in: text) else { continue }
            seen.insert("r\(text[round])-\(text[machine])-\(text[client])")
        }
        return seen.sorted()
    }

    /// Idempotent: the production flush (window.texttextFlushForSignOut through
    /// LocalVaultWindowController.flushForSignOut) runs once, on shutdown or on the
    /// way out after a failure.
    func flush() async -> Bool {
        if let flushed { return flushed }
        guard opened else { flushed = true; return true }
        let ok = await withCheckedContinuation { continuation in controller.flushForSignOut { continuation.resume(returning: $0) } }
        flushed = ok
        record(["kind": "flush", "ok": ok])
        if !ok { fail("Production editor flush failed; recovery state retained.") }
        return ok
    }
}
#endif
