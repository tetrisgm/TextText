import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/session";
import { getAdvertisedVersion } from "@/lib/app-release";
import { LandingHeader } from "@/components/LandingHeader";

export const metadata: Metadata = {
  title: "Download Write",
  description: "Get the Write desktop app for Mac. Windows and Linux are on the way.",
};

export const dynamic = "force-dynamic";

const platforms = [
  {
    key: "mac",
    name: "Mac",
    detail: "macOS 14 Sonoma or later. Apple silicon and Intel.",
    href: "/download/Write.zip",
    cta: "Download for Mac",
    available: true,
  },
  {
    key: "windows",
    name: "Windows",
    detail: "A native Windows build is on the way.",
    href: null,
    cta: "Coming soon",
    available: false,
  },
  {
    key: "linux",
    name: "Linux",
    detail: "A Linux build is on the way.",
    href: null,
    cta: "Coming soon",
    available: false,
  },
];

export default async function DownloadPage() {
  const [user, advertised] = await Promise.all([
    getCurrentUser(),
    getAdvertisedVersion(),
  ]);

  return (
    <main className="write-landing applecms">
      <LandingHeader signedIn={Boolean(user)} />

      <section className="write-download-hero">
        <p className="write-landing-kicker">The desktop app</p>
        <h1>Download Write</h1>
        <p>
          Open Write from the Dock or the menu bar and get the full workspace,
          the same editor and folders as the web, backed by a folder of real
          Markdown files that sync both ways.
        </p>
        {advertised && (
          <p className="write-download-version">
            Latest version {advertised.version}
          </p>
        )}
      </section>

      <section className="write-download-grid" aria-label="Platforms">
        {platforms.map((platform) => (
          <article
            key={platform.key}
            className={`write-download-card${
              platform.available ? "" : " is-soon"
            }`}
          >
            <h2>{platform.name}</h2>
            <p>{platform.detail}</p>
            {platform.available && platform.href ? (
              <a className="write-landing-primary" href={platform.href}>
                {platform.cta}
              </a>
            ) : (
              <span className="write-download-soon">{platform.cta}</span>
            )}
          </article>
        ))}
      </section>

      <section className="write-download-note-block">
        <p>
          The app auto-updates itself once installed. Signing in inside the app
          links it to your workspace; your Markdown files land in a Write
          folder in your home directory.
        </p>
      </section>
    </main>
  );
}
