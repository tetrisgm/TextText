// Hold a live origin to what its clients actually ask of it.
//
//   npx tsx scripts/verify-deployment.ts https://texttext.app
//   npx tsx scripts/verify-deployment.ts https://texttext.app --expect-dpl texttext-abc1234
//
// This exists because a deployment can answer every page with 200 and still be
// broken for the Mac app. On 2026-08-27 a build went live whose schema was
// ahead of the production database: every HTML route served fine, and the
// native window showed "Cannot reach https://texttext.app" because the session
// exchange threw a 500 that only a WELL-FORMED token reaches. A malformed one
// is rejected before the query, which is why hand probing missed it.
//
// So the probes below are the requests the clients make, and the rule is that
// nothing may answer 5xx. Run it after a promote, and roll back if it fails.

const BASE = (process.argv[2] ?? "https://texttext.app").replace(/\/+$/, "");
const expectIndex = process.argv.indexOf("--expect-dpl");
const EXPECT_DPL = expectIndex > 0 ? process.argv[expectIndex + 1] : "";

/** "wsk_" + 43 base64url chars: the shape that reaches the token query. */
const WELL_FORMED_UNKNOWN_TOKEN =
  "wsk_0000000000000000000000000000000000000000000";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` (${detail})` : ""}`);
  }
}

async function probe(
  path: string,
  init: RequestInit = {},
): Promise<{ code: number; text: string }> {
  try {
    const response = await fetch(`${BASE}${path}`, {
      redirect: "manual",
      headers: { "cache-control": "no-cache", ...(init.headers ?? {}) },
      ...init,
    });
    const text = await response.text().catch(() => "");
    return { code: response.status, text };
  } catch (error) {
    return { code: 0, text: error instanceof Error ? error.message : "" };
  }
}

async function main() {
  console.log(`verifying ${BASE}`);

  const home = await probe("/");
  check("the landing page answers", home.code === 200, String(home.code));

  const signin = await probe("/signin");
  check("sign-in answers", signin.code === 200, String(signin.code));

  const version = await probe("/api/app/version");
  check(
    "the Mac app's version endpoint answers with a version",
    version.code === 200 && /"version"\s*:/.test(version.text),
    `${version.code} ${version.text.slice(0, 60)}`,
  );

  const appcast = await probe("/appcast.xml");
  check("the appcast answers", appcast.code === 200, String(appcast.code));

  // THE ONE THAT MATTERS. The Mac window's first navigation is this exchange.
  // An unknown token must be refused with 401. A 5xx here means the app cannot
  // open at all, whatever the HTML routes say.
  const session = await probe("/api/app/session?next=/start", {
    method: "POST",
    headers: {
      "x-texttext-app": "1",
      authorization: `Bearer ${WELL_FORMED_UNKNOWN_TOKEN}`,
    },
  });
  check(
    "the Mac app's session exchange refuses an unknown token cleanly",
    session.code === 401,
    session.code >= 500
      ? `${session.code}: the build and the database disagree`
      : String(session.code),
  );

  // A client chunk, because a deployment can serve HTML that points at assets
  // the deployment does not have.
  const chunk = /\/_next\/static\/chunks\/[A-Za-z0-9_./-]+\.js/.exec(
    signin.text,
  )?.[0];
  if (chunk) {
    const asset = await probe(chunk);
    check("the page's own client chunk is served", asset.code === 200, String(asset.code));
  } else {
    check("the page names a client chunk", false, "no chunk in the markup");
  }

  if (EXPECT_DPL) {
    // A promote is not instant, and a stale answer looks exactly like a
    // successful one. Insist on seeing the build we meant to ship.
    const served = /dpl=([A-Za-z0-9_-]+)/.exec(signin.text)?.[1] ?? "";
    check(
      "the origin serves the deployment we promoted",
      served === EXPECT_DPL,
      `serving ${served || "no deployment id"}, expected ${EXPECT_DPL}`,
    );
  }

  console.log(failures === 0 ? "\npass" : `\n${failures} check(s) failed`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
