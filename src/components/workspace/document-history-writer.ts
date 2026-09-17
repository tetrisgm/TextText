/**
 * Who replaced a version, in the words someone looking for lost text uses.
 *
 * Kept apart from the dialog so it stays a plain function: the name shown here
 * is the one thing in the history a person reads before deciding what to put
 * back, and it should never be an internal identifier.
 */
const WRITER: Record<string, string> = {
  save_document: "Edited here",
  save_post: "Edited here",
  "collab.materialize": "Edited here",
  "sync.put_file": "Changed on your Mac",
  "sync.patch_file": "Renamed or moved on your Mac",
  move_item_file: "Renamed or moved",
  "collab.rotate": "Kept from an editing session",
  restore_revision: "A restore",
  capture_replaced_body: "A fresh capture of the page",
  "mcp.append_to_item": "Added to from an app",
  update_item_type_item: "Changed to another kind",
  "reading.apply_source_revision": "An update from the source",
  "reading.extract_full_text": "The full text, fetched",
};

export function writerOf(version: { action: string; actorType: string }): string {
  const known = WRITER[version.action];
  if (known) return known;
  if (version.actorType === "ai") return "The assistant";
  if (version.actorType === "external_agent") return "A connected agent";
  if (version.actorType === "system") return "Kept by the server";
  return "Another change";
}
