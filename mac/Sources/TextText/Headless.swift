import Foundation
import TextTextWorkspaceCore

/// TEXTTEXT_HEADLESS=1: no UI, one real sync pass through the exact engine the
/// app runs, a one-line JSON summary on stdout, exit 0/1. This is the CI
/// verify hook and the seed of a future CLI.
///
///   TEXTTEXT_HEADLESS=1 TEXTTEXT_TOKEN=wsk_... TEXTTEXT_SERVER=http://localhost:3000 \
///   TEXTTEXT_SYNC_ROOT=/tmp/texttext-sync swift run --package-path mac
///
/// TEXTTEXT_STATE_DIR is honored too (StateStore), so CI can isolate the index.
enum Headless {
    static func run() -> Int32 {
        let env = ProcessInfo.processInfo.environment
        guard let token = env["TEXTTEXT_TOKEN"], !token.isEmpty,
              let server = env["TEXTTEXT_SERVER"], let origin = URL(string: server), origin.host != nil,
              let rootPath = env["TEXTTEXT_SYNC_ROOT"], !rootPath.isEmpty else {
            FileHandle.standardError.write(Data(
                "TEXTTEXT_HEADLESS=1 requires TEXTTEXT_TOKEN, TEXTTEXT_SERVER, and TEXTTEXT_SYNC_ROOT\n".utf8))
            return 1
        }

        let store = StateStore()
        let engine = SyncEngine(store: store)
        engine.makeClient = { ServerClient(origin: origin, token: token) }
        engine.syncRootProvider = {
            URL(fileURLWithPath: (rootPath as NSString).expandingTildeInPath, isDirectory: true)
        }
        engine.workspaceLocationProvider = {
            WorkspaceRootResolver(overrideRoot: URL(
                fileURLWithPath: (rootPath as NSString).expandingTildeInPath,
                isDirectory: true
            )).resolve()
        }
        engine.callbackQueue = nil // no runloop here; deliver inline
        engine.onActivity = { message in
            FileHandle.standardError.write(Data("\(message)\n".utf8))
        }

        let summary = engine.runOnePassBlocking()
        print("{\"pulled\":\(summary.pulled),\"pushed\":\(summary.pushed),\"conflicts\":\(summary.conflicts),\"errors\":\(summary.errors)}")
        return summary.errors == 0 ? 0 : 1
    }
}
