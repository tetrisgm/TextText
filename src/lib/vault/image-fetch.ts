import { fetchPublicResource, isFetchableBookmarkUrl } from "@/lib/bookmark-fetch";
import { MAX_VISUAL_ASSET_BYTES, prepareVisualAsset, visualAssetFilename, type PreparedVisualAsset } from "@/lib/visual-assets";

/** Pure preparation: no uploads, document writes, credentials or account state. */
export async function preparePublicImage(sourceUrl: string, options: { signal?: AbortSignal; timeoutMs?: number; maxBytes?: number } = {}): Promise<PreparedVisualAsset & { filename: string; sourceUrl: string }> {
  let source: URL;
  try { source = new URL(sourceUrl); } catch { throw new Error("Choose a public image URL."); }
  if (sourceUrl.length > 2048 || source.username || source.password || !isFetchableBookmarkUrl(source)) throw new Error("Choose a public image URL.");
  const limit = options.maxBytes ?? MAX_VISUAL_ASSET_BYTES;
  const timeout = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_VISUAL_ASSET_BYTES || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 30_000) throw new Error("Invalid image preparation limits.");
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeout);
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const bounded = <T>(promise: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const cancel = () => { cleanup(); reject(new Error("Image preparation was interrupted or timed out.")); };
    const cleanup = () => controller.signal.removeEventListener("abort", cancel);
    promise.then(value => { cleanup(); resolve(value); }, () => { cleanup(); reject(new Error("The image could not be fetched or prepared.")); });
    if (controller.signal.aborted) { cancel(); return; }
    controller.signal.addEventListener("abort", cancel, { once: true });
  });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let response: Response | null | undefined;
  try {
    if (controller.signal.aborted) throw new Error("Image preparation was interrupted or timed out.");
    // Existing transport checks every redirect and pins sockets to checked DNS addresses.
    const request = fetchPublicResource(source, { signal: controller.signal, headers: { accept: "image/*", "user-agent": "texttext-image-import/1" } });
    void request.then(response => { if (controller.signal.aborted) void response?.body?.cancel().catch(() => {}); }, () => {});
    response = await bounded(request);
    if (!response || !response.ok || !response.body) throw new Error("A public image could not be fetched.");
    reader = response.body.getReader();
    const type = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (!type || !/^image\/(jpeg|png|webp|gif|avif)$/.test(type)) throw new Error("Use a JPEG, PNG, WebP, GIF, or AVIF image.");
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new Error("Image exceeds the allowed size.");
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const part = await bounded(reader.read());
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw new Error("Image exceeds the allowed size.");
      chunks.push(part.value);
    }
    if (!size) throw new Error("Choose a nonempty image.");
    const bytes = Buffer.concat(chunks, size);
    const prepared = await bounded(prepareVisualAsset({ name: "image", size, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + size) as ArrayBuffer }));
    if (prepared.originalContentType !== type) throw new Error("Image content does not match its declared type.");
    return { ...prepared, filename: visualAssetFilename(source.pathname, prepared.originalContentType), sourceUrl: source.href };
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener("abort", abort); controller.abort();
    if (!reader) void response?.body?.cancel().catch(() => {});
    if (reader) { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* A stalled read is already abandoned. */ } }
  }
}
