import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { rootDomainUrl } from "@/lib/site-url";
import "../styles/tokens.css";
import "../styles/broadsheet.css";
import "../styles/cards.css";
import "../styles/talk.css";
import "../styles/project.css";
import "../styles/apple.css";

// Body: Inter (an SF-alike, OFL) so every platform reads the same. Fraunces is
// kept as a legacy display fallback for older content styles.
const inter = localFont({
  src: [
    { path: "../../public/fonts/Inter-Regular.ttf", weight: "400" },
    { path: "../../public/fonts/Inter-SemiBold.ttf", weight: "600" },
  ],
  variable: "--font-body",
  display: "swap",
});

const fraunces = localFont({
  src: "../../public/fonts/Fraunces-SemiBold.ttf",
  weight: "600",
  variable: "--font-display",
  display: "swap",
});

const title = "Write";
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
    template: "%s · Write",
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
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body>{children}</body>
    </html>
  );
}
