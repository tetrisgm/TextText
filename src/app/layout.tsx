import type { Metadata } from "next";
import localFont from "next/font/local";
import { ROOT_DOMAIN } from "@/lib/tenants";
import "../styles/tokens.css";
import "../styles/broadsheet.css";
import "../styles/cards.css";
import "../styles/talk.css";
import "../styles/project.css";
import "../styles/apple.css";

// Body: Inter (an SF-alike, OFL) so every platform reads the same. Display:
// Fraunces SemiBold, the Broadsheet's serif voice. Both self-hosted.
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
  "A calm publishing home for articles, projects, and talks with broadsheet type and clean editing.";

function rootUrl(): URL {
  const root = ROOT_DOMAIN.replace(/^https?:\/\//, "");
  const protocol = root.startsWith("localhost") || root.startsWith("127.")
    ? "http"
    : "https";
  return new URL(`${protocol}://${root}`);
}

export const metadata: Metadata = {
  metadataBase: rootUrl(),
  applicationName: title,
  title,
  description,
  openGraph: {
    title,
    description,
    siteName: title,
    type: "website",
    url: "/",
  },
  twitter: {
    card: "summary",
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
