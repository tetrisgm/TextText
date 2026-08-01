import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { rootDomainUrl } from "@/lib/site-url";
import "../styles/tokens.css";
import "../styles/broadsheet.css";
import "../styles/cards.css";
import "../styles/talk.css";
import "../styles/project.css";
import "../styles/apple.css";
import "../styles/workspace.css";

const fraunces = localFont({
  src: "../../public/fonts/Fraunces-SemiBold.ttf",
  weight: "600",
  variable: "--font-display",
  display: "swap",
});

const title = "TextText";
const description =
  "Folders of Markdown for publishing, notes, and agent workflows.";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1d1d1f" },
  ],
};

export const metadata: Metadata = {
  metadataBase: rootDomainUrl(),
  applicationName: title,
  title: {
    default: title,
    template: "%s · TextText",
  },
  description,
  manifest: "/manifest.webmanifest",
  openGraph: {
    title,
    description,
    siteName: title,
    type: "website",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={fraunces.variable}>
      <body>{children}</body>
    </html>
  );
}
