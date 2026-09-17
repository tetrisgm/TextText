import { describe, expect, it } from "vitest";
import { writerOf } from "../document-history-writer";

/**
 * A version's writer is shown to a person looking for text they lost, so it
 * says what happened rather than which function ran.
 */
describe("who replaced a version", () => {
  it("names the writers a person can recognise", () => {
    expect(writerOf({ action: "mcp.append_to_item", actorType: "human" })).toBe("Added to from an app");
    expect(writerOf({ action: "capture_replaced_body", actorType: "external_agent" })).toBe("A fresh capture of the page");
    expect(writerOf({ action: "collab.rotate", actorType: "system" })).toBe("Kept from an editing session");
    expect(writerOf({ action: "sync.put_file", actorType: "external_agent" })).toBe("Changed on your Mac");
  });

  it("never shows an internal identifier", () => {
    expect(writerOf({ action: "update_item_type_item", actorType: "human" })).toBe("Changed to another kind");
    expect(writerOf({ action: "some_future_writer", actorType: "human" })).toBe("Another change");
    expect(writerOf({ action: "some_future_writer", actorType: "system" })).toBe("Kept by the server");
  });
});
