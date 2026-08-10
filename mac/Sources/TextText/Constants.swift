import Foundation

/// The app's display name, read from the bundle. Falls back to "TextText" for
/// `swift run` dev builds with no bundle.
let appName = (Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String)
    ?? (Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String)
    ?? "TextText"

let appVersion = (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "dev"

/// Committed product fallback. The product origin is injected at
/// release time (TEXTTEXT_PRODUCT_ORIGIN rewrites SUFeedURL on the staged plist;
/// the app derives its server origin from SUFeedURL) and in dev via the
/// TEXTTEXT_SERVER env var. Never commit a real domain here.
let placeholderProductOrigin = "https://TextText.app"

/// Where a build with no release plist points. A bundle assembled by
/// `mac/scripts/build-app.sh` always carries SUFeedURL; `swift run` never does.
/// Falling through to the product origin in that case means a dev run silently
/// reads and writes the LIVE workspace, which looks exactly like the app being
/// broken and is how an afternoon disappears.
let devDefaultOrigin = "http://localhost:3000"

/// Server origin resolution, most specific first:
///   1. TEXTTEXT_SERVER env (dev override, any origin)
///   2. the linked credential's serverOrigin (the token belongs to it)
///   3. the origin of SUFeedURL in the running bundle (release builds carry
///      the real product origin there via the build script's plist override)
///   4. no SUFeedURL means this is not a release build: the local server
///   5. the committed product fallback, for a release bundle with a bad feed
func resolveServerOrigin(credentials: Credentials?) -> URL {
    if let raw = ProcessInfo.processInfo.environment["TEXTTEXT_SERVER"],
       let url = URL(string: raw), url.host != nil {
        return logOriginOnce(url, "TEXTTEXT_SERVER")
    }
    if let credentials, let url = URL(string: credentials.serverOrigin), url.host != nil {
        return logOriginOnce(url, "linked credential")
    }
    // The origin this build was stamped with. Checked before SUFeedURL so that
    // a bundle without an updater - a store build - still knows its server.
    if let stamped = Bundle.main.object(forInfoDictionaryKey: "TextTextServerOrigin") as? String,
       let url = URL(string: stamped), url.host != nil {
        return logOriginOnce(url, "product origin")
    }
    let feed = Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") as? String
    if let feed, let feedURL = URL(string: feed), let scheme = feedURL.scheme,
       let host = feedURL.host {
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.port = feedURL.port
        if let url = components.url { return logOriginOnce(url, "release feed") }
    }
    if feed == nil, let url = URL(string: devDefaultOrigin) {
        return logOriginOnce(url, "dev build, no release feed")
    }
    return logOriginOnce(URL(string: placeholderProductOrigin)!, "product fallback")
}

/// Say once, on stderr, which server this run is talking to. Silence here is
/// what let a dev launch look like a broken app instead of a wrong origin.
private nonisolated(unsafe) var loggedOrigin = false
private func logOriginOnce(_ url: URL, _ reason: String) -> URL {
    if !loggedOrigin {
        loggedOrigin = true
        FileHandle.standardError.write(
            Data("TextText server origin: \(url.absoluteString) (\(reason))\n".utf8)
        )
    }
    return url
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
