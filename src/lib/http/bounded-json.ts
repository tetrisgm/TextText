export type BoundedJsonResult<T> =
  { value: T } | { error: "invalid" | "too_large" };

export type BoundedTextResult = { value: string } | { error: "too_large" };

type BoundedBytesResult = { value: Uint8Array } | { error: "too_large" };

/**
 * Read one JSON request without allowing an unbounded Request.json() buffer.
 * The limit is enforced against both a declared Content-Length and the bytes
 * that actually arrive, so chunked requests cannot bypass it.
 */
export async function readBoundedJson<T>(
  request: Request,
  maximumBytes: number,
): Promise<BoundedJsonResult<T>> {
  const result = await readBoundedBytes(request, maximumBytes);
  if ("error" in result) return result;

  try {
    return {
      value: JSON.parse(new TextDecoder().decode(result.value)) as T,
    };
  } catch {
    return { error: "invalid" };
  }
}

/**
 * Read one text request with the same declared and streamed byte limit as the
 * JSON helper. An absent body remains the empty string, matching Request.text().
 */
export async function readBoundedText(
  request: Request,
  maximumBytes: number,
): Promise<BoundedTextResult> {
  const result = await readBoundedBytes(request, maximumBytes);
  return "error" in result
    ? result
    : { value: new TextDecoder().decode(result.value) };
}

async function readBoundedBytes(
  request: Request,
  maximumBytes: number,
): Promise<BoundedBytesResult> {
  const rawLength = request.headers.get("content-length");
  if (rawLength !== null) {
    const declared = Number(rawLength);
    if (Number.isFinite(declared) && declared > maximumBytes) {
      return { error: "too_large" };
    }
  }

  const reader = request.body?.getReader();
  if (!reader) return { value: new Uint8Array() };

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => {});
      return { error: "too_large" };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { value: bytes };
}
