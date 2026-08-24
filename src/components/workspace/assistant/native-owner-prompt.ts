const MAX_NATIVE_OWNER_PROMPT_SUFFIX = 32_000;

/** Keeps owner-authored authority outside every fenced document-content block. */
export function appendNativeOwnerPrompt(
  nativeTurn: string,
  ownerPrompt: unknown,
): string {
  if (typeof ownerPrompt !== "string") return nativeTurn;
  const bounded = ownerPrompt.trim().slice(0, MAX_NATIVE_OWNER_PROMPT_SUFFIX);
  return bounded ? `${nativeTurn}\n\n${bounded}` : nativeTurn;
}
