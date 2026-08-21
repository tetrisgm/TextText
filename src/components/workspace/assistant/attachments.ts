import { nativeOcr } from "@/lib/ai/native-ocr";
import type { AssistantAttachment } from "./AssistantSidebar";

export const ASSISTANT_ATTACHMENT_ACCEPT = "image/*,.txt,.md,.markdown";
export const ASSISTANT_TEXT_ATTACHMENT_ACCEPT = ".txt,.md,.markdown";

export type NativeOcrCapabilities = {
  ocr?: boolean;
};

export function assistantAttachmentAccept(
  capabilities: NativeOcrCapabilities | null,
): string {
  return capabilities?.ocr
    ? ASSISTANT_ATTACHMENT_ACCEPT
    : ASSISTANT_TEXT_ATTACHMENT_ACCEPT;
}

const MAX_ATTACHMENT_CONTEXT_LENGTH = 7_000;

type Ocr = (imageBase64: string) => Promise<{ text: string }>;

export function formatAssistantSubmission(
  text: string,
  attachments: readonly AssistantAttachment[],
): string {
  const trimmed = text.trim();
  const contextNames = attachments
    .filter((attachment) => attachment.workspaceItemId)
    .map((attachment) => attachment.name);
  const attachmentNames = attachments
    .filter((attachment) => !attachment.workspaceItemId)
    .map((attachment) => attachment.name);
  const details = [
    contextNames.length ? `Context: ${contextNames.join(", ")}` : "",
    attachmentNames.length ? `Attached: ${attachmentNames.join(", ")}` : "",
  ].filter(Boolean);
  if (details.length === 0) return trimmed;
  if (!trimmed && contextNames.length === 0) {
    return `Review attached: ${attachmentNames.join(", ")}`;
  }
  if (!trimmed && attachmentNames.length === 0) {
    return `Review with context: ${contextNames.join(", ")}`;
  }
  if (!trimmed) return `Review ${details.join("; ")}`;
  return `${trimmed}\n\n${details.join("\n")}`;
}

function fileExtension(name: string): string {
  return name.split(".").at(-1)?.toLowerCase() ?? "";
}

function attachmentKind(
  attachment: AssistantAttachment,
): "image" | "text" | "unsupported" {
  if (attachment.type?.startsWith("image/")) return "image";
  if (attachment.type?.startsWith("text/")) return "text";
  const extension = fileExtension(attachment.name);
  if (["md", "markdown", "txt"].includes(extension)) return "text";
  return "unsupported";
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return window.btoa(binary);
}

async function attachmentText(
  attachment: AssistantAttachment,
  ocr: Ocr,
): Promise<string> {
  if (!attachment.file) {
    throw new Error(`Reattach ${attachment.name} so the assistant can read it.`);
  }

  const kind = attachmentKind(attachment);
  if (kind === "text") return await attachment.file.text();
  if (kind === "image") {
    const imageBase64 = arrayBufferToBase64(await attachment.file.arrayBuffer());
    const result = await ocr(imageBase64);
    return result.text.trim() || "No text was found in this image.";
  }
  throw new Error(`${attachment.name} is not a supported attachment.`);
}

export async function buildNativeAssistantPrompt(
  text: string,
  attachments: readonly AssistantAttachment[],
  ocr: Ocr = nativeOcr,
): Promise<{ displayText: string; prompt: string }> {
  const trimmed = text.trim();
  const displayText = formatAssistantSubmission(text, attachments);

  if (attachments.length === 0) {
    return { displayText, prompt: trimmed };
  }

  let remaining = MAX_ATTACHMENT_CONTEXT_LENGTH;
  const sections: string[] = [];
  for (const attachment of attachments) {
    const content = await attachmentText(attachment, ocr);
    const excerpt = content.slice(0, remaining);
    sections.push(`[Attachment: ${attachment.name}]\n${excerpt}`);
    remaining -= excerpt.length;
    if (remaining <= 0) break;
  }

  return {
    displayText,
    prompt: `${trimmed || "Review the attached content."}\n\n${sections.join("\n\n")}`,
  };
}
