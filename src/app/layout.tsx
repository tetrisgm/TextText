import type { Metadata } from "next";
import localFont from "next/font/local";
import "../styles/tokens.css";
import "../styles/broadsheet.css";
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

export const metadata: Metadata = {
  title: "Write",
  description:
    "A blog that reads like a broadsheet. Apple-grade writing and publishing.",
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
