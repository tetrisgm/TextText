import Foundation

/// The app's display name, read from the bundle. Falls back to "Texttext" for
/// `swift run` dev builds with no bundle.
let appName = (Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String)
    ?? (Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String)
    ?? "Texttext"

let appVersion = (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "dev"

/// Committed product fallback. The product origin is injected at
/// release time (WRITE_PRODUCT_ORIGIN rewrites SUFeedURL on the staged plist;
/// the app derives its server origin from SUFeedURL) and in dev via the
/// WRITE_SERVER env var. Never commit a real domain here.
let placeholderProductOrigin = "https://texttext.app"

/// Server origin resolution, most specific first:
///   1. WRITE_SERVER env (dev: http://localhost:3000)
///   2. the linked credential's serverOrigin (the token belongs to it)
///   3. the origin of SUFeedURL in the running bundle (release builds carry
///      the real product origin there via the build script's plist override)
///   4. the committed product fallback
func resolveServerOrigin(credentials: Credentials?) -> URL {
    if let raw = ProcessInfo.processInfo.environment["WRITE_SERVER"],
       let url = URL(string: raw), url.host != nil {
        return url
    }
    if let credentials, let url = URL(string: credentials.serverOrigin), url.host != nil {
        return url
    }
    if let feed = Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") as? String,
       let feedURL = URL(string: feed), let scheme = feedURL.scheme, let host = feedURL.host {
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.port = feedURL.port
        if let url = components.url { return url }
    }
    return URL(string: placeholderProductOrigin)!
}

/// True when dotted version a is strictly greater than b, component-wise
/// (the partyparty rule: a rolled-back server marker must never re-trigger
/// update checks forever). Non-numeric versions fall back to string
/// inequality, erring toward a harmless extra Sparkle check.
func versionNewer(_ a: String, _ b: String) -> Bool {
    if a.isEmpty { return false }
    func parse(_ v: String) -> [Int]? {
        var out: [Int] = []
        for part in v.split(separator: ".", omittingEmptySubsequences: false) {
            guard let n = Int(part) else { return nil }
            out.append(n)
        }
        return out
    }
    guard let pa = parse(a), let pb = parse(b) else { return a != b }
    for i in 0..<max(pa.count, pb.count) {
        let x = i < pa.count ? pa[i] : 0
        let y = i < pb.count ? pb[i] : 0
        if x != y { return x > y }
    }
    return false
}
