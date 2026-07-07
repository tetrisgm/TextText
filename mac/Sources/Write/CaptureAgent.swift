import Foundation

/// Bookmark capture agent: drains GET /api/sync/v1/captures on this Mac,
/// loading each pending URL in an offscreen WKWebView to produce the
/// readable extraction, the original page HTML, and a full screenshot, then
/// PUTs the result to /api/sync/v1/captures/{id} as multipart/form-data
/// (fields: meta JSON, readable text, screenshot PNG, html file).
///
/// SKELETON: wiring is in place (AppDelegate starts it and pokes it after
/// every remote change); the WKWebView capture implementation lands next.
/// Keep this class self-contained (own URLSession, no ServerClient edits).
final class CaptureAgent {
    private let store: StateStore
    var onActivity: ((String) -> Void)?

    init(store: StateStore) {
        self.store = store
    }

    /// Begin watching for pending captures (called once at launch).
    func start() {
        // Implementation: initial poke after launch.
        poke()
    }

    /// Check for pending captures now (called after each remote change).
    func poke() {
        // Implementation pending: GET /captures, capture each entry with an
        // offscreen WKWebView, PUT results. Until then this is a no-op so
        // the app behaves exactly as before.
    }
}
