import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/session";
import { getAdvertisedVersion } from "@/lib/app-release";
import { LandingHeader } from "@/components/LandingHeader";
import { LandingFooter } from "@/components/LandingFooter";

export const metadata: Metadata = {
  title: "Download TextText",
  description:
    "Get the TextText desktop app for Apple silicon Macs. Windows and Linux are on the way.",
};

export const dynamic = "force-dynamic";

const platforms = [
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
  const macAvailable = Boolean(advertised);

  return (
    <main className="texttext-landing">
      <LandingHeader signedIn={Boolean(user)} />

      <section className="texttext-download-hero">
        <p className="texttext-landing-kicker">The desktop app</p>
        <h1>Download TextText</h1>
        <p>
          Download the Mac app for Apple silicon, open TextText, and sign in when
          it launches. You get the same editor and folders as the web, backed
          by Markdown files that sync both ways.
        </p>
        {advertised && (
          <p className="texttext-download-version">
            Latest version {advertised.version}
          </p>
        )}
      </section>

      <section
        className="texttext-download-steps"
        aria-label="Download, open TextText, sign in"
      >
        <ol>
          <li>
            <span>1</span>
            <strong>Download</strong>
          </li>
          <li>
            <span>2</span>
            <strong>Open TextText</strong>
          </li>
          <li>
            <span>3</span>
            <strong>Sign in</strong>
          </li>
        </ol>
        <p>You sign in when you open it.</p>
      </section>

      <section className="texttext-download-grid" aria-label="Platforms">
        <article className="texttext-download-card">
          <h2>Mac, Apple silicon</h2>
          <p>macOS 14 Sonoma or later. Requires an Apple silicon Mac.</p>
          {macAvailable ? (
            <a className="texttext-landing-primary" href="/download/TextText.zip">
              Download for Apple silicon
            </a>
          ) : (
            <button
              className="texttext-landing-primary texttext-download-disabled"
              type="button"
              disabled
            >
              Download for Apple silicon
            </button>
          )}
          <p className="texttext-download-card-note">
            Signed and notarized by Apple; macOS asks once.
          </p>
        </article>
        {platforms.map((platform) => (
          <article
            key={platform.key}
            className={`texttext-download-card${
              platform.available ? "" : " is-soon"
            }`}
          >
            <h2>{platform.name}</h2>
            <p>{platform.detail}</p>
            {platform.available && platform.href ? (
              <a className="texttext-landing-primary" href={platform.href}>
                {platform.cta}
              </a>
            ) : (
              <span className="texttext-download-soon">{platform.cta}</span>
            )}
          </article>
        ))}
      </section>

      <section className="texttext-download-note-block">
        <p>
          Open the zip, launch TextText, and keep it in Applications if you want
          it there. The app auto-updates itself once installed; your Markdown
          files land in a TextText folder in your home directory.
        </p>
      </section>
      <LandingFooter />
    </main>
  );
}
