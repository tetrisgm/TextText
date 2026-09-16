import { clientLogin } from "@/lib/reading/reader-api.server";

export const dynamic = "force-dynamic";

/**
 * Google Reader ClientLogin. The password is a TextText API token; the email
 * is accepted and ignored. Answers in the three-line form clients parse.
 */
async function handle(request: Request) {
  let password = "";
  const contentType = request.headers.get("content-type") ?? "";
  if (request.method === "POST" && contentType.includes("form")) {
    const form = await request.formData();
    password = String(form.get("Passwd") ?? "");
  } else {
    const url = new URL(request.url);
    password = url.searchParams.get("Passwd") ?? "";
  }
  const login = password ? await clientLogin(password) : null;
  if (!login) return new Response("Error=BadAuthentication\n", { status: 403, headers: { "content-type": "text/plain" } });
  return new Response(`SID=${login.auth}\nLSID=${login.auth}\nAuth=${login.auth}\n`, { headers: { "content-type": "text/plain", "cache-control": "no-store" } });
}

export { handle as GET, handle as POST };
