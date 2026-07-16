// Client for the cloud assistant fallback (POST /api/ai). Used on the plain web
// when the on-device bridge is unavailable and the owner has enabled the cloud
// rung (AI_GATEWAY_API_KEY set on the server). Local-first is preserved: this is
// only reached after the on-device capability probe reports unavailable.
//
// MVP: a single text turn (no attachments/OCR yet), non-streaming.

export type CloudAssistantContext = {
  level?: string;
  folderPath?: string;
  postId?: string;
};

export type CloudAssistantOutcome =
  | { text: string }
  | { disabled: true };

export async function cloudAssistantTurn(
  prompt: string,
  context?: CloudAssistantContext,
): Promise<CloudAssistantOutcome> {
  const response = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: prompt }],
      context,
    }),
  });
  // 404 is the off-by-default gate: the owner has not enabled the cloud rung.
  if (response.status === 404) return { disabled: true };
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(data?.error || "The assistant could not finish that.");
  }
  const data = (await response.json()) as { text?: unknown };
  return { text: typeof data.text === "string" ? data.text : "" };
}
