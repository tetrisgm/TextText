// Isolate the live-client cover workflow from the public internet. The only
// intercepted address is the reserved fixture URL, and its bytes come from a
// checked-in local image. All other DNS and fetch requests keep their normal
// behavior.
if (process.env.TEXTTEXT_LOCAL_ASSET_FIXTURE === "1") {
  const fs = require("node:fs");
  const path = require("node:path");
  const dns = require("node:dns/promises");
  const { syncBuiltinESMExports } = require("node:module");

  const fixtureUrl = "https://texttext-asset-fixture.invalid/cover.png";
  const fixtureHost = new URL(fixtureUrl).hostname;
  const fixtureBytes = fs.readFileSync(
    path.join(__dirname, "fixtures", "live-eval-cover.png"),
  );
  const publicFixtureAddress = { address: "93.184.216.34", family: 4 };
  const originalLookup = dns.lookup.bind(dns);

  dns.lookup = function lookup(hostname, options, callback) {
    if (String(hostname).toLowerCase() !== fixtureHost) {
      return originalLookup(hostname, options, callback);
    }
    const normalizedOptions = typeof options === "object" ? options : {};
    const result = normalizedOptions.all
      ? [publicFixtureAddress]
      : publicFixtureAddress;
    if (typeof callback === "function") {
      queueMicrotask(() => {
        if (normalizedOptions.all) callback(null, result);
        else callback(null, result.address, result.family);
      });
      return;
    }
    return Promise.resolve(result);
  };
  syncBuiltinESMExports();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function fetchWithLocalAssetFixture(input, init) {
    const requestUrl =
      typeof input === "string" || input instanceof URL
        ? new URL(input)
        : new URL(input.url);
    if (requestUrl.href !== fixtureUrl) {
      return originalFetch.call(globalThis, input, init);
    }
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (method !== "GET") return new Response("Method not allowed", { status: 405 });
    return new Response(fixtureBytes, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "content-length": String(fixtureBytes.byteLength),
      },
    });
  };
}
