import { createTransport } from "nodemailer";

/**
 * Tells a human a report exists. Best effort by design: the report is already
 * in content_reports, which is the system of record, and a mail outage must
 * never turn a reader's report into an error page. Uses the same SMTP
 * submission URL the sign-in emails use, so there is no second mail
 * configuration to rot.
 */
export async function sendContentReportEmail(input: {
  path: string;
  reason: string;
  reporterEmail?: string;
  reportId: string;
}): Promise<boolean> {
  const server = process.env.AUTH_EMAIL_SERVER;
  const from = process.env.AUTH_EMAIL_FROM ?? "TextText <noreply@TextText.app>";
  if (!server) return false;
  try {
    const transport = createTransport(server);
    await transport.sendMail({
      to: "security@TextText.app",
      from,
      subject: `Content report: ${input.path}`,
      text: [
        `A reader reported a published page.`,
        ``,
        `Page:   https://texttext.app${input.path}`,
        `Report: ${input.reportId}`,
        input.reporterEmail ? `From:   ${input.reporterEmail}` : `From:   (not left)`,
        ``,
        `Reason:`,
        input.reason,
        ``,
        `Open reports: SELECT * FROM content_reports WHERE status = 'open' ORDER BY created_at;`,
      ].join("\n"),
    });
    return true;
  } catch (error) {
    console.warn("content report email failed; the report row is saved", error);
    return false;
  }
}
