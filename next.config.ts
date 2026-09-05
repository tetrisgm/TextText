import type { NextConfig } from "next";

// Cross-origin dev access (a tunnel or LAN hostname) is opt-in via env so no
// personal domain lands in the repo. The wildcard covers tenant subdomains.
const devOrigin = process.env.TEXTTEXT_DEV_ORIGIN;
const tsconfigPath = process.env.TEXTTEXT_NEXT_TSCONFIG_PATH;

/**
 * Which build this is, for both halves of the app.
 *
 * `deploymentId` below already stamps it for Server Action skew, but nothing
 * could ASK what was running. A Mac window keeps the bundle it loaded, so a
 * deploy never reached an open app: a fix shipped hours earlier looked broken
 * because the person was still running the code from before it. Baking the
 * same value into the client and into /api/app/build lets the running page
 * compare itself against what the origin serves now.
 */
const buildId =
  process.env.NEXT_DEPLOYMENT_ID ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  process.env.VERCEL_DEPLOYMENT_ID ??
  "development";

const nextConfig: NextConfig = {
  // Live client evaluations use an isolated build directory so a stopped
  // evaluator cannot leave stale development route manifests for normal work.
  distDir: process.env.TEXTTEXT_NEXT_DIST_DIR ?? ".next",
  // Opt-in maps for attributing chunk weight in a probe build; never on by
  // default, so production ships without them.
  productionBrowserSourceMaps: process.env.TEXTTEXT_SOURCE_MAPS === "1",
  // Live evaluators can point Next at a disposable config. This keeps their
  // generated route-type includes out of the developer's real tsconfig.json.
  ...(tsconfigPath ? { typescript: { tsconfigPath } } : {}),
  // Server Actions are deployment-specific. Give every build a stable identity
  // so Next can reject version-skewed requests with a hard navigation instead
  // of submitting an action id to the wrong deployment. The in-app assistant
  // uses stable JSON routes, but editor actions still benefit from this guard.
  deploymentId:
    process.env.NEXT_DEPLOYMENT_ID ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.VERCEL_DEPLOYMENT_ID,
  // Inlined at build time, so the client and the server agree on which build
  // they came from without either reading the runtime environment.
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  allowedDevOrigins: devOrigin ? [devOrigin, `*.${devOrigin}`] : [],
  devIndicators: false,
  // Yjs guards against loading more than one copy in the same JavaScript
  // realm. Turbopack otherwise embeds it independently in several server
  // route and SSR chunks, which makes page-data workers evaluate the guard
  // more than once even though npm has only one physical Yjs installation.
  // Keep Yjs and its awareness peer external together so every server import
  // resolves through Node's single module cache. Client bundles are unchanged.
  serverExternalPackages: ["yjs", "y-protocols"],
  async headers() {
    // Chromium disables the JS self-profiling API (`new Profiler()`) unless
    // the document itself opts in with this header. Opting in costs nothing
    // until a profiler is started and makes real keystroke/interaction
    // profiles collectable in the running app instead of guessed at.
    const profiling = {
      source: "/:path*",
      headers: [{ key: "Document-Policy", value: "js-profiling" }],
    };
    if (process.env.NODE_ENV !== "development") return [profiling];

    return [
      profiling,
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, max-age=0",
          },
        ],
      },
    ];
  },
  experimental: {
    // Bake the deployment id into the build instead of reading it back from the
    // environment at request time.
    //
    // This is not a preference. Next auto-enables runtimeServerDeploymentId
    // during a production build whenever NEXT_DEPLOYMENT_ID is set and the
    // build targets Vercel (server/config.js), and the server then THROWS on
    // every request if that variable is absent at runtime
    // (server/base-server.js, error E970). release/ship.sh sets the variable to
    // stamp the build, `vercel deploy --prebuilt` ships the output, and nothing
    // puts the variable in the runtime environment, so 0.170 deployed a site
    // where every dynamic route answered 500: sign-in, the demo, every tenant
    // page, the appcast, and the Mac app's version endpoint. Static pages kept
    // serving, which is what made it look healthy from the front page.
    //
    // Setting it false explicitly keeps the auto-enable from firing. Version
    // skew protection is unaffected: the id is still stamped per build, it is
    // just inlined rather than looked up.
    runtimeServerDeploymentId: false,
    proxyClientMaxBodySize: "55mb",
  },
};

export default nextConfig;
