"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Not-found pages get no route params, so the blog home link is derived from
// the URL. Path-based access (/t/{handle}/...) links back to /t/{handle};
// host-based tenants ({handle}.domain) live at the root, so "/" is home.
export default function TenantNotFound() {
  const pathname = usePathname() ?? "";
  const match = pathname.match(/^\/t\/([^/]+)/);
  const homeHref = match ? `/t/${match[1]}` : "/";

  return (
    <main className="not-found-page">
      <Image
        className="not-found-gif"
        src="/travolta-looking-around.gif"
        alt="John Travolta as Vincent Vega looking around a room, finding nothing"
        width={480}
        height={204}
        priority
        unoptimized
      />
      <h1 className="not-found-title">This page does not exist.</h1>
      <Link className="not-found-home-link" href={homeHref}>
        Back to the blog
      </Link>
    </main>
  );
}
