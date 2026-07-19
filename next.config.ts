import type { NextConfig } from "next";

// Cross-origin dev access (a tunnel or LAN hostname) is opt-in via env so no
// personal domain lands in the repo. The wildcard covers tenant subdomains.
const devOrigin = process.env.WRITE_DEV_ORIGIN;

const nextConfig: NextConfig = {
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
