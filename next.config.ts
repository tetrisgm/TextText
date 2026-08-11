import type { NextConfig } from "next";

// Cross-origin dev access (a tunnel or LAN hostname) is opt-in via env so no
// personal domain lands in the repo. The wildcard covers tenant subdomains.
const devOrigin = process.env.TEXTTEXT_DEV_ORIGIN;

const nextConfig: NextConfig = {
  // Live client evaluations use an isolated build directory so a stopped
  // evaluator cannot leave stale development route manifests for normal work.
  distDir: process.env.TEXTTEXT_NEXT_DIST_DIR ?? ".next",
  // Server Actions are deployment-specific. Give every build a stable identity
  // so Next can reject version-skewed requests with a hard navigation instead
  // of submitting an action id to the wrong deployment. The in-app assistant
  // uses stable JSON routes, but editor actions still benefit from this guard.
  deploymentId:
    process.env.NEXT_DEPLOYMENT_ID ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.VERCEL_DEPLOYMENT_ID,
  allowedDevOrigins: devOrigin ? [devOrigin, `*.${devOrigin}`] : [],
  devIndicators: false,
  async headers() {
    if (process.env.NODE_ENV !== "development") return [];

    return [
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
    optimizePackageImports: [
      "@tiptap/core",
      "@tiptap/react",
      "@tiptap/starter-kit",
      "@tiptap/pm",
      "@tiptap/extension-collaboration",
      "@tiptap/extension-collaboration-cursor",
      "@tiptap/extension-image",
      "@tiptap/extension-link",
      "@tiptap/extension-placeholder",
      "@tiptap/extension-task-item",
      "@tiptap/extension-task-list",
      "tiptap-markdown",
      "embla-carousel-react",
    ],
  },
};

export default nextConfig;
