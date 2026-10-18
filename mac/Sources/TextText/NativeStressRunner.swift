#if TEXTTEXT_STRESS_ACTOR
import AppKit
import CryptoKit
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
        let identityReceipt: String?
    }

    struct Validated {
        let fileURL: URL
        let relativePath: String
        let root: URL
        let itemId: String
        let workspaceId: String
        let title: String
        let totalMinutes: Int
        let identityReceipt: String?
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
                         workspaceId: config.workspaceId, title: config.title, totalMinutes: totalMinutes, identityReceipt: config.identityReceipt)
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
            let controller = LocalVaultWindowController(entry: entry, root: validated.root, verifiedCredentials: {
                guard let account = store.loadCredentials() else { return nil }
                return LocalVaultAccountCredential(origin: resolveServerOrigin(credentials: account), token: account.token, accountId: account.accountId)
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
    private let capturedWindowAccount: LocalVaultAccountCredential?
    private let deadline: Date
    private(set) var failure: String?
    private var historyProgress: [String: Any]?
    private var inputProgress: [String: Any]?
    private var opened = false
    private var transportOffline = false
    private var flushed: Bool?
    private var reloads = 0
    private var finished = false
    private static let marker = try! NSRegularExpression(pattern: #"\[(mac|pc)-(app|web|cli) r(\d+) [a-z]+\d+\]"#)
    private static let editId = try! NSRegularExpression(pattern: #"^r\d{1,5}-mac-app$"#)

    init(controller: LocalVaultWindowController, validated: NativeStressActor.Validated, session: URL) {
        self.controller = controller
        self.capturedWindowAccount = try? controller.stressVerifiedAccount(expectedRoot: validated.root)
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
                    if let surface = try? await evaluate("JSON.stringify({heading:document.querySelector('.vault-context-location h2')?.textContent,buttons:[...document.querySelectorAll('button')].map(x=>x.getAttribute('aria-label')||x.textContent?.trim()).filter(Boolean).slice(0,30),notices:[...document.querySelectorAll('[role=alert],.vault-notice')].map(x=>x.textContent?.trim()).filter(Boolean).slice(0,8),visibleTextStart:document.body.innerText.slice(0,1000),editor:!!document.querySelector('[aria-label=\"Document body\"]')?.isContentEditable,collab:document.querySelector('[data-collaboration-state]')?.getAttribute('data-collaboration-state')})") {
                        record(["kind": "failure-surface", "state": String(surface.prefix(4096))])
                    }
                    var errorResponse: [String: Any] = ["type": "error", "round": round, "message": error.localizedDescription]
                    if let historyProgress { errorResponse["historyProgress"] = historyProgress }
                    if let inputProgress { errorResponse["inputProgress"] = inputProgress }
                    response = errorResponse
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
        _ = try requireActorAccount()
        switch type {
        case "hello":
            guard request["role"] as? String == NativeStressActor.roleServed else { throw NativeStressActor.Failure("This native adapter only serves the \(NativeStressActor.roleServed) role.") }
            guard request["mode"] as? String == "real" else { throw NativeStressActor.Failure("The native adapter only runs real mode; it cannot simulate.") }
            let fixture = request["fixture"] as? [String: Any] ?? [:]
            guard fixture["itemId"] as? String == config.itemId, fixture["workspaceId"] as? String == config.workspaceId else {
                throw NativeStressActor.Failure("Coordinator fixture does not match the configured test item and workspace.")
            }
            try await open()
            let mailboxName = session.lastPathComponent
            guard mailboxName.range(of: #"^gen-[0-9]{4}$"#, options: .regularExpression) != nil,
                  let generation = Int(mailboxName.dropFirst(4)), (1...9999).contains(generation) else {
                throw NativeStressActor.Failure("The actor requires a fresh relay-owned generation mailbox.")
            }
            var result: [String: Any] = ["type": "attest", "round": 0, "mode": "real", "workspaceId": config.workspaceId, "itemId": config.itemId,
                    "machineId": NativeStressActor.hostName(), "adapter": adapterName, "sessionId": sessionId, "generation": generation]
            if request["identitySchema"] as? Int == 1 { result["identity"] = try observedIdentity() }
            return result
        case "prepare":
            try await requireSelected()
            if request["select"] as? String == "Existing fixture text." {
                let selected = try await evaluate("(()=>{const e=document.querySelector('[aria-label=\"Document body\"]');if(!e?.isContentEditable||e.textContent.split('Existing fixture text.').length!==2)return false;const w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const i=n.textContent.indexOf('Existing fixture text.');if(i<0)continue;e.focus();const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+22);const s=window.getSelection();s.removeAllRanges();s.addRange(r);return s.toString()==='Existing fixture text.'}return false})()")
                guard selected == "true" else { throw NativeStressActor.Failure("Replacement target could not be selected.") }
            }
            return ["type": "ready", "round": round]
        case "edit":
            try await requireSelected()
            guard let edit = request["edit"] as? [String: Any], let operation = edit["op"] as? String,
                  operation == "append" || operation == "insert-start" || operation == "replace-selection" else { throw NativeStressActor.Failure("Unsupported edit operation.") }
            let id = edit["id"] as? String ?? ""
            let text = edit["text"] as? String ?? ""
            guard Self.editId.firstMatch(in: id, range: NSRange(id.startIndex..., in: id)) != nil,
                  !text.isEmpty, text.count <= NativeStressActor.maxEditText, !text.contains("\n"), !text.contains("\r") else {
                throw NativeStressActor.Failure("Edit id or text is out of bounds for this adapter.")
            }
            inputProgress = nil
            historyProgress = nil
            if let history = edit["undoRedo"] {
                guard history as? Bool == true, operation == "append", edit["inputSequence"] == nil else { throw NativeStressActor.Failure("Invalid history operation.") }
                let completed = try await exerciseHistory(id: id, text: text)
                historyProgress = nil
                return ["type": "applied", "round": round, "editId": id, "historyProgress": completed]
            }
            if let sequence = edit["inputSequence"] {
                guard operation == "append", let sequence = sequence as? [String: Any],
                      let chunks = sequence["chunks"] as? [String], (2...16).contains(chunks.count),
                      Set(chunks).count == chunks.count, chunks.joined() == text,
                      chunks.allSatisfy({ (1...50).contains($0.unicodeScalars.count) && !$0.contains("\n") && !$0.contains("\r") }),
                      let interval = sequence["intervalMs"] as? Int, (10...250).contains(interval) else {
                    throw NativeStressActor.Failure("Invalid bounded input sequence.")
                }
                var acknowledgments: [[String: Any]] = []
                var prefix = ""
                let started = ProcessInfo.processInfo.systemUptime
                inputProgress = ["editId": id, "chunks": acknowledgments, "acceptedPrefix": prefix]
                for (index, chunk) in chunks.enumerated() {
                    guard ProcessInfo.processInfo.systemUptime - started < 15 else { throw NativeStressActor.Failure("Input sequence deadline exceeded.") }
                    try await requireSelected()
                    guard try await evaluate("window.texttextStressContinuity?.removed === false && window.texttextStressSession === \(Self.json(sessionId))") == "true" else { throw NativeStressActor.Failure("Editor replaced during input sequence.") }
                    inputProgress = ["editId": id, "chunks": acknowledgments, "acceptedPrefix": prefix, "attemptedChunk": ["ordinal": index + 1, "text": chunk]]
                    try await insert(id: id, text: chunk, start: false, replacing: false, deadlineUptime: started + 15)
                    guard try await evaluate("window.texttextStressContinuity?.removed === false && window.texttextStressSession === \(Self.json(sessionId))") == "true" else { throw NativeStressActor.Failure("Editor replaced during input sequence.") }
                    let elapsed = (ProcessInfo.processInfo.systemUptime - started) * 1000
                    guard elapsed <= 15000 else { throw NativeStressActor.Failure("Input sequence deadline exceeded.") }
                    prefix += chunk
                    acknowledgments.append(["ordinal": index + 1, "text": chunk, "visible": true, "elapsedMs": elapsed])
                    inputProgress = ["editId": id, "chunks": acknowledgments, "acceptedPrefix": prefix]
                    record(["kind": "input-chunk", "editId": id, "ordinal": index + 1, "elapsedMs": elapsed])
                    if index + 1 < chunks.count { try await Task.sleep(nanoseconds: UInt64(interval) * 1_000_000) }
                }
                let completed = inputProgress!
                inputProgress = nil
                return ["type": "applied", "round": round, "editId": id, "inputProgress": completed]
            }
            try await insert(id: id, text: text, start: operation == "insert-start", replacing: operation == "replace-selection")
            return ["type": "applied", "round": round, "editId": id]
        case "transport":
            guard opened, let online = request["online"] as? Bool else {
                throw NativeStressActor.Failure("Transport fault requires an open editor and a boolean online state.")
            }
            // This changes only the private actor's production collaboration bridge;
            // the editor, filesystem watcher and local recovery journal keep running.
            controller.setStressCollaborationOffline(!online)
            transportOffline = !online
            if online {
                _ = try await evaluate("([...document.querySelectorAll('.vault-notice button')].find(b=>b.textContent?.trim()==='Retry')?.click(), true)")
                try await until("The test editor did not rejoin after collaboration transport was restored.") {
                    try await self.evaluate("(()=>{const e=document.querySelector('[data-collaboration-item]');return ['ready','saving'].includes(e?.dataset.collaborationState)&&!!e.querySelector('[aria-label=\"Document body\"]')?.isContentEditable})()") == "true"
                }
            }
            let state = try await evaluate("(()=>{const e=document.querySelector('[data-collaboration-item]');return e?.dataset.collaborationState||null})()")
            record(["kind": "transport", "round": round, "online": online, "editorState": state])
            return ["type": "transport", "round": round, "online": online, "state": state]
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

    @discardableResult private func requireActorAccount() throws -> LocalVaultAccountCredential {
        let current = try controller.stressVerifiedAccount(expectedRoot: config.root)
        guard let capturedWindowAccount, capturedWindowAccount.accountId != nil, capturedWindowAccount.sameAccount(as: current),
              let saved = StateStore().loadCredentials(), let accountId = saved.accountId else {
            throw NativeStressActor.Failure("The test window has no unchanged verified account lifetime.")
        }
        let stored = LocalVaultAccountCredential(origin: resolveServerOrigin(credentials: saved), token: saved.token, accountId: accountId)
        guard current.sameAccount(as: stored) else {
            throw NativeStressActor.Failure("The test window account differs from the current signed-in account.")
        }
        return current
    }

    private func evidenceBytes(_ url: URL, limit: Int) throws -> Data {
        let canonical = url.standardizedFileURL.resolvingSymlinksInPath()
        let before = try FileManager.default.attributesOfItem(atPath: canonical.path)
        guard before[.type] as? FileAttributeType == .typeRegular,
              let size = before[.size] as? NSNumber, size.intValue <= limit else { throw NativeStressActor.Failure("Artifact identity is outside its bound.") }
        let bytes = try Data(contentsOf: canonical)
        let after = try FileManager.default.attributesOfItem(atPath: canonical.path)
        guard bytes.count == size.intValue, before[.systemFileNumber] as? NSNumber == after[.systemFileNumber] as? NSNumber,
              before[.size] as? NSNumber == after[.size] as? NSNumber,
              before[.modificationDate] as? Date == after[.modificationDate] as? Date else { throw NativeStressActor.Failure("Artifact changed while observing identity.") }
        return bytes
    }
    private func identityDigest(_ bytes: Data) -> String { SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined() }
    private func observedIdentity() throws -> [String: Any] {
        let credential = try requireActorAccount()
        guard let receiptPath = config.identityReceipt, receiptPath.hasPrefix("/"),
              let executable = Bundle.main.executableURL, let resources = Bundle.main.resourceURL,
              let account = credential.accountId,
              account.range(of: #"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$"#, options: .regularExpression) != nil,
              let version = Bundle(for: WKWebView.self).object(forInfoDictionaryKey: "CFBundleVersion") as? String, !version.isEmpty else {
            throw NativeStressActor.Failure("Observed build, WebKit or verified account identity unavailable.")
        }
        let bytes = try evidenceBytes(URL(fileURLWithPath: receiptPath), limit: 64 * 1024)
        guard let receipt = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              receipt["schemaVersion"] as? Int == 1, receipt["role"] as? String == "mac-app",
              let commit = receipt["sourceCommit"] as? String, commit.range(of: #"^[a-f0-9]{40}$"#, options: .regularExpression) != nil,
              let sourceReceipt = receipt["sourceReceiptSha256"] as? String, sourceReceipt.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil,
              let inputs = receipt["sourceInputSha256"] as? String, inputs.range(of: #"^[a-f0-9]{64}$"#, options: .regularExpression) != nil,
              let expected = receipt["artifacts"] as? [String: String] else { throw NativeStressActor.Failure("Sealed private build identity receipt invalid.") }
        let ui = resources.appendingPathComponent("LocalVault", isDirectory: true)
        guard webView.url?.standardizedFileURL.path == ui.appendingPathComponent("index.html").standardizedFileURL.path else { throw NativeStressActor.Failure("Loaded UI differs from the native bundle.") }
        var artifacts = ["nativeExecutable": identityDigest(try evidenceBytes(executable, limit: 256 * 1024 * 1024))]
        for name in ["app.js", "app.css", "index.html", "mirror-policy.js", "mirror-policy.json"] {
            artifacts["localUI/" + name] = identityDigest(try evidenceBytes(ui.appendingPathComponent(name), limit: 32 * 1024 * 1024))
        }
        guard artifacts == expected else { throw NativeStressActor.Failure("Loaded native and UI artifacts differ from the sealed source receipt.") }
        let origin = credential.origin
        guard origin.scheme == "https", origin.user == nil, origin.password == nil, origin.query == nil, origin.fragment == nil, (origin.path.isEmpty || origin.path == "/"),
              let host = origin.host else { throw NativeStressActor.Failure("Verified account origin invalid.") }
        let authority = "https://" + host.lowercased() + (origin.port.flatMap { $0 == 443 ? nil : ":" + String($0) } ?? "")
        let scope = identityDigest(Data(("texttext-account-v1\0" + authority + "\0" + account).utf8))
        return ["schemaVersion": 1, "role": "mac-app", "platform": "darwin", "artifactKind": "private-acceptance",
                "principalKind": "authenticated-account", "principalScopeHash": scope,
                "runtimeName": "WebKit", "runtimeVersion": version, "sourceCommit": commit,
                "sourceReceiptSha256": sourceReceipt, "artifacts": artifacts]
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
        _ = try requireActorAccount()
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
        try await Task.sleep(for: .seconds(1))
        if try await evaluate("!!document.querySelector('[aria-label=\"Document body\"]')?.isContentEditable") != "true" {
            _ = try await evaluate("(document.querySelector('button[aria-label=\"Edit card\"]')?.click(), true)")
        }
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
        _ = try requireActorAccount()
        guard opened else { throw NativeStressActor.Failure("Editor is not open; hello must succeed first.") }
        let allowedStates = transportOffline ? "['ready','saving','offline','reconnecting','error']" : "['ready','saving']"
        let ok = try await evaluate("(()=>{const shared=document.querySelector('[data-collaboration-item]');return document.querySelector('.vault-context-location h2')?.textContent?.trim() === \(expectedTitle) && \(allowedStates).includes(shared?.dataset.collaborationState) && (shared?.dataset.collaborationItem||'').toLowerCase() === \(expectedItem) && !!shared.querySelector('[aria-label=\"Document body\"]')?.isContentEditable})()")
        guard ok == "true" else { throw NativeStressActor.Failure("Editor is no longer on the dedicated test item in the shared document.") }
        guard Date() < deadline else { throw NativeStressActor.Failure("Stress adapter total time limit reached.") }
    }

    /// Actual visible body text, after re-validating the title. `nil` when the editor is absent.
    private func body() async throws -> String? {
        _ = try requireActorAccount()
        let raw = try await evaluate("({title:document.querySelector('.vault-context-location h2')?.textContent?.trim()??null,body:document.querySelector('[aria-label=\"Document body\"]')?.textContent??null})")
        guard let parsed = try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any] else { throw NativeStressActor.Failure("Editor snapshot was not readable.") }
        guard parsed["title"] as? String == config.title else { throw NativeStressActor.Failure("Editor navigated away from the dedicated test item.") }
        return parsed["body"] as? String
    }

    private static func occurrences(of needle: String, in text: String) -> Int {
        text.components(separatedBy: needle).count - 1
    }

    private func insert(id: String, text: String, start: Bool, replacing: Bool, deadlineUptime: TimeInterval? = nil) async throws {
        guard let before = try await body() else { throw NativeStressActor.Failure("Test editor body is not present.") }
        guard !before.contains(text) else { throw NativeStressActor.Failure("Edit text already present before input: " + id) }
        // Real contenteditable focus and a collapsed selection at the end (selection
        // only, no content mutation), then the exact text through native input.
        let focused = try await evaluate(replacing
            ? "window.getSelection()?.toString()==='Existing fixture text.'"
            : "(()=>{const e=document.querySelector('[aria-label=\"Document body\"]');if(!e||!e.isContentEditable)return false;e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(\(start ? "true" : "false"));const s=window.getSelection();s.removeAllRanges();s.addRange(r);return true})()")
        guard focused == "true" else { throw NativeStressActor.Failure("Could not place the caret in the document body.") }
        let path = try insertNatively(text)
        record(["kind": "input", "editId": id, "path": path])
        let end = deadlineUptime ?? (ProcessInfo.processInfo.systemUptime + NativeStressActor.editBound)
        while true {
            if let current = try await body(), Self.occurrences(of: text, in: current) == 1 { return }
            guard ProcessInfo.processInfo.systemUptime < end else { throw NativeStressActor.Failure("Inserted text did not appear exactly once in the visible editor: " + id) }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
    }

    private func exerciseHistory(id: String, text: String) async throws -> [String: Any] {
        let start = ProcessInfo.processInfo.systemUptime
        try await Task.sleep(nanoseconds: 450_000_000) // Product captureTimeout is 400ms.
        guard let baseline = try await body(), !baseline.contains(text) else { throw NativeStressActor.Failure("History baseline unavailable or marker already present.") }
        var preserved = baseline
        var stages: [[String: Any]] = []
        for (index, stage) in ["insert", "undo", "redo"].enumerated() {
            if index > 0 { try await Task.sleep(nanoseconds: 1_000_000) }
            try await requireSelected()
            historyProgress = ["editId": id, "stages": stages, "attemptedStage": stage]
            if index == 0 { try await insert(id: id, text: text, start: false, replacing: false, deadlineUptime: start + 15) }
            else { try historyKey(redo: index == 2) }
            while true {
                let elapsed = (ProcessInfo.processInfo.systemUptime - start) * 1000
                guard elapsed <= 15000 else { throw NativeStressActor.Failure("History visibility or preservation deadline exceeded.") }
                if let current = try await body(), Self.occurrences(of: text, in: current) == (index == 1 ? 0 : 1) {
                    let stripped = current.replacingOccurrences(of: text, with: "")
                    var remaining = Array(preserved.unicodeScalars)[...]
                    for scalar in stripped.unicodeScalars where remaining.first == scalar { remaining = remaining.dropFirst() }
                    if remaining.isEmpty {
                        stages.append(["stage": stage, "editId": id, "text": text, "ownOccurrences": index == 1 ? 0 : 1, "preservedVisibleContent": true, "elapsedMs": elapsed])
                        preserved = stripped
                        historyProgress = ["editId": id, "stages": stages]
                        break
                    }
                }
                try await Task.sleep(nanoseconds: 25_000_000)
            }
        }
        return ["editId": id, "stages": stages]
    }

    private func historyKey(redo: Bool) throws {
        guard let window = controller.window else { throw NativeStressActor.Failure("History window unavailable.") }
        NSApp.activate(ignoringOtherApps: true); window.makeKeyAndOrderFront(nil)
        guard window.makeFirstResponder(webView) else { throw NativeStressActor.Failure("History editor refused first responder.") }
        let flags: NSEvent.ModifierFlags = redo ? [.command, .shift] : [.command]
        for kind in [NSEvent.EventType.keyDown, .keyUp] {
            guard let event = NSEvent.keyEvent(with: kind, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: window.windowNumber, context: nil, characters: redo ? "Z" : "z", charactersIgnoringModifiers: "z", isARepeat: false, keyCode: 6) else { throw NativeStressActor.Failure("History keyboard event unavailable.") }
            NSApp.sendEvent(event)
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
