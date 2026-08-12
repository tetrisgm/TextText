import { request as httpRequest } from "node:http";

export type PublicLiveResponse = Pick<Response, "ok" | "status" | "text"> & {
  headers: Pick<Headers, "get">;
};

/** Reach a public workspace URL without relying on wildcard-localhost DNS. */
export async function requestPublicLiveUrl(
  pageUrl: string,
  localOrigin: string,
): Promise<PublicLiveResponse> {
  const publicUrl = new URL(pageUrl);
  if (!publicUrl.hostname.endsWith(".localhost")) {
    return fetch(publicUrl, { redirect: "manual" });
  }

  const origin = new URL(localOrigin);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: "127.0.0.1",
        port: origin.port,
        path: `${publicUrl.pathname}${publicUrl.search}`,
        headers: { host: publicUrl.host },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => {
          const status = response.statusCode ?? 0;
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({
            ok: status >= 200 && status < 300,
            status,
            headers: {
              get: (name: string) => {
                const value = response.headers[name.toLowerCase()];
                return Array.isArray(value) ? value.join(", ") : value ?? null;
              },
            },
            text: async () => body,
          });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}
