import type { NextConfig } from "next";

// Cross-origin dev access (a tunnel or LAN hostname) is opt-in via env so no
// personal domain lands in the repo. The wildcard covers tenant subdomains.
const devOrigin = process.env.WRITE_DEV_ORIGIN;

const nextConfig: NextConfig = {
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
  },
};

export default nextConfig;
