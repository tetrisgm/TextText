import type { Metadata } from "next";
import { LandingFooter } from "@/components/LandingFooter";
import { LandingHeader } from "@/components/LandingHeader";
import { ReportForm } from "./ReportForm";

export const metadata: Metadata = {
  title: "Report a page",
  description: "Report published content that should not be on TextText.",
  robots: { index: false },
};

/**
 * Where the "Report this page" link on every public document lands. Works
 * signed out, because the people reading public pages are signed out, and a
 * report mechanism behind a sign-in wall is not one.
 */
export default async function ReportPage({
  searchParams,
}: {
  searchParams?: Promise<{ path?: string | string[]; doc?: string | string[] }>;
}) {
  const params = (await searchParams) ?? {};
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  // Only a site-relative path is ever echoed back, so this page cannot be used
  // to make TextText present a foreign URL as its own content.
  const rawPath = first(params.path) ?? "";
  const path = rawPath.startsWith("/") && !rawPath.startsWith("//")
    ? rawPath.slice(0, 512)
    : "";
  const doc = (first(params.doc) ?? "").slice(0, 64);

  return (
    <main className="texttext-landing texttext-legal-page">
      <LandingHeader signedIn={false} />
      <article className="texttext-legal-article">
        <p className="texttext-landing-kicker">Report</p>
        <h1>Report a page</h1>
        <p>
          If a published page hosts something that should not be here, tell us.
          A person reads every report. Reporting is anonymous unless you choose
          to leave an email address for follow up.
        </p>
        <p>
          What does not belong on TextText: content that is illegal, that
          harasses or threatens a person, that sexualizes minors, or that
          publishes someone&apos;s private information. The{" "}
          <a href="/terms">terms</a> say this too, and reported content that
          crosses them is removed.
        </p>
        <ReportForm path={path} doc={doc} />
      </article>
      <LandingFooter />
    </main>
  );
}
