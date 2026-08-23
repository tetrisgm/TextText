import { nativeOcr } from "@/lib/ai/native-ocr";
import type { AssistantAttachment } from "./AssistantSidebar";
import type { CloudAssistantAttachment } from "@/lib/ai/cloud-client";

export const ASSISTANT_ATTACHMENT_ACCEPT = "image/*,.txt,.md,.markdown";
export const ASSISTANT_TEXT_ATTACHMENT_ACCEPT = ".txt,.md,.markdown";

export type NativeOcrCapabilities = {
  ocr?: boolean;
  /** Hosted providers can receive image parts directly over HTTPS. */
  vision?: boolean;
};

export function assistantAttachmentAccept(
  capabilities: NativeOcrCapabilities | null,
): string {
  return capabilities?.ocr || capabilities?.vision
    ? ASSISTANT_ATTACHMENT_ACCEPT
    : ASSISTANT_TEXT_ATTACHMENT_ACCEPT;
}

const MAX_ATTACHMENT_CONTEXT_LENGTH = 7_000;
const MAX_CLOUD_TEXT_ATTACHMENT_BYTES = 1_000_000;
// Base64 expands binary data by roughly one third, so keep the raw image below
// the bounded JSON request budget while leaving room for the prompt and context.
const MAX_CLOUD_IMAGE_ATTACHMENT_BYTES = 700_000;

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

/**
 * Browser and Store builds can safely send bounded text and image attachments
 * through the already-configured provider request. Native OCR remains useful
 * for the standalone agent, while hosted vision uses ordinary HTTPS upload.
 */
export async function buildCloudAssistantPrompt(
  text: string,
  attachments: readonly AssistantAttachment[],
): Promise<string> {
  const files = attachments.filter((attachment) => !attachment.workspaceItemId);
  if (files.length === 0) return text.trim();

  let remaining = MAX_ATTACHMENT_CONTEXT_LENGTH;
  const sections: string[] = [];
  for (const attachment of files) {
    const kind = attachmentKind(attachment);
    if (kind === "image") {
      sections.push(`[Image attachment: ${attachment.name}]`);
      continue;
    }
    if (kind !== "text") {
      throw new Error(
        `${attachment.name} is not a supported attachment. Use a text file or image.`,
      );
    }
    if (!attachment.file) {
      throw new Error(`Reattach ${attachment.name} so the assistant can read it.`);
    }
    if (attachment.file.size > MAX_CLOUD_TEXT_ATTACHMENT_BYTES) {
      throw new Error(
        `${attachment.name} is too large. Keep text attachments under 1 MB.`,
      );
    }
    const content = (await attachment.file.text()).slice(0, remaining);
    sections.push(`[Attachment: ${attachment.name}]\n${content}`);
    remaining -= content.length;
    if (remaining <= 0) break;
  }

  return `${text.trim() || "Review the attached content."}\n\n${sections.join("\n\n")}`;
}

/**
 * Prepare image parts for the hosted provider. The server receives a bounded
 * data URL over HTTPS and passes it to the provider as a multimodal user part;
 * no localhost bridge or App Store-only capability is involved.
 */
export async function buildCloudAssistantAttachments(
  attachments: readonly AssistantAttachment[],
): Promise<CloudAssistantAttachment[]> {
  const images = attachments.filter(
    (attachment) =>
      !attachment.workspaceItemId && attachmentKind(attachment) === "image",
  );
  const prepared: CloudAssistantAttachment[] = [];
  for (const attachment of images) {
    if (!attachment.file) {
      throw new Error(`Reattach ${attachment.name} so the assistant can read it.`);
    }
    if (attachment.file.size > MAX_CLOUD_IMAGE_ATTACHMENT_BYTES) {
      throw new Error(
        `${attachment.name} is too large. Keep image attachments under 700 KB.`,
      );
    }
    const mediaType = attachment.file.type.startsWith("image/")
      ? attachment.file.type
      : "image/png";
    prepared.push({
      name: attachment.name,
      mediaType,
      dataUrl: `data:${mediaType};base64,${arrayBufferToBase64(
        await attachment.file.arrayBuffer(),
      )}`,
    });
  }
  return prepared;
}
