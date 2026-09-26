import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readAssistantComposerDraft,
  resetAssistantComposerDraftsForTests,
  saveAssistantCustomizationDraft,
  type AssistantCustomizationDraft,
} from "@/components/workspace/assistant/composer-store";
import { studioTimelineFrom, addStudioRevision } from "../../item-type-studio-state";
import { ITEM_TYPE_STARTERS } from "@/lib/presentation/item-type-blueprint";

const storage = (map: Map<string, string>) => ({
  get length() { return map.size; },
  key: (index: number) => [...map.keys()][index] ?? null,
  getItem: (key: string) => map.get(key) ?? null,
  setItem: (key: string, value: string) => map.set(key, value),
  removeItem: (key: string) => map.delete(key),
});

afterEach(() => {
  resetAssistantComposerDraftsForTests();
  vi.unstubAllGlobals();
});

describe("assistant composer drafts", () => {
  it("restores text independently for each selected context", () => {
    const values = new Map([
      ["texttext:assistant-composer:local:item:one", "Question for one"],
      ["texttext:assistant-composer:local:item:two", "Question for two"],
    ]);
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
      },
    });

    expect(readAssistantComposerDraft("local:item:one")).toEqual({
      attachments: [],
      text: "Question for one",
    });
    expect(readAssistantComposerDraft("local:item:two")).toEqual({
      attachments: [],
      text: "Question for two",
    });
  });

  it("restores the exact customization and immutable target after closing without crossing owners", () => {
    const session = new Map<string, string>();
    const local = new Map<string, string>();
    vi.stubGlobal("window", { sessionStorage: storage(session), localStorage: storage(local) });
    const blueprint = ITEM_TYPE_STARTERS[0].blueprint;
    const timeline = addStudioRevision(studioTimelineFrom(blueprint), {
      label: "AI refinement", source: "ai", blueprint: { ...blueprint, name: "My refinement" }, request: "  Keep source visible.\n",
    });
    const draft: AssistantCustomizationDraft = {
      version: 1, workspaceId: "blog-one", targetPostId: "selected-item", expectedRevision: 17,
      initialTemplate: { id: "existing-look", version: 3 },
      editing: { templateId: "existing-look", baseVersion: 3, blueprint },
      prompt: "  Make this a research reader.\n", followUp: "Make the commentary narrower.", timeline,
      folderPath: "", targetScope: "item", saveMode: "version", applyToExisting: false,
      pendingItemLook: { id: "saved-look", version: 4 }, saveRequestId: "a1861364-8c93-4cc9-a31d-3468abae01f6",
      saveIntent: { blueprint, editing: { templateId: "existing-look", baseVersion: 3, blueprint },
        folderPath: "", targetScope: "item", saveMode: "version", applyToExisting: false },
    };
    const ownerKey = "writer:opaque-owner-a:customize:blog-one:selected-item";
    saveAssistantCustomizationDraft(ownerKey, draft);
    resetAssistantComposerDraftsForTests();
    expect(readAssistantComposerDraft(ownerKey).customization).toEqual(draft);
    expect(readAssistantComposerDraft("writer:opaque-owner-b:customize:blog-one:selected-item").customization).toBeUndefined();
    expect(readAssistantComposerDraft("writer:opaque-owner-a:customize:blog-one:another-item").customization).toBeUndefined();
    saveAssistantCustomizationDraft(ownerKey, undefined);
    resetAssistantComposerDraftsForTests();
    expect(readAssistantComposerDraft(ownerKey).customization).toBeUndefined();
    expect(local.size).toBe(0);
  });

  it("bounds persisted target drafts while retaining the current request", () => {
    const local = new Map<string, string>();
    vi.stubGlobal("window", { sessionStorage: storage(new Map()), localStorage: storage(local) });
    const draft: AssistantCustomizationDraft = {
      version: 1, workspaceId: "blog", prompt: "Keep this request", followUp: "", timeline: studioTimelineFrom(ITEM_TYPE_STARTERS[0].blueprint),
      folderPath: "", targetScope: "item", saveMode: "version", applyToExisting: false, pendingItemLook: null,
    };
    for (let index = 0; index < 30; index++) saveAssistantCustomizationDraft(`owner:customize:blog:item-${index}`, { ...draft, targetPostId: `item-${index}` });
    expect(local.size).toBe(20);
    resetAssistantComposerDraftsForTests();
    expect(readAssistantComposerDraft("owner:customize:blog:item-29").customization?.prompt).toBe("Keep this request");
  });

  it.each(["disabled", "quota-full", "session-blocked"])("bounds customization memory when browser storage is %s", (failure) => {
    const session = storage(new Map([["texttext:assistant-composer:owner:customize:blog:item-0", "Unrelated composer text"]]));
    const local = storage(new Map());
    const blocked = () => { throw new Error("Storage unavailable"); };
    const browser = {
      sessionStorage: failure === "session-blocked" ? { ...session, removeItem: blocked } : session,
      get localStorage() {
        if (failure === "disabled") return blocked();
        return failure === "quota-full" ? { ...local, setItem: blocked } : local;
      },
    };
    vi.stubGlobal("window", browser);
    const draft: AssistantCustomizationDraft = {
      version: 1, workspaceId: "blog", prompt: "Exact preserved request", followUp: "", timeline: studioTimelineFrom(ITEM_TYPE_STARTERS[0].blueprint),
      folderPath: "", targetScope: "item", saveMode: "version", applyToExisting: false, pendingItemLook: null,
    };
    const keys = Array.from({ length: 30 }, (_, index) => `owner:customize:blog:item-${index}`);
    for (const key of keys) saveAssistantCustomizationDraft(key, draft);
    expect(keys.filter((key) => readAssistantComposerDraft(key).customization)).toHaveLength(20);
    expect(readAssistantComposerDraft(keys[29]).customization?.prompt).toBe("Exact preserved request");
    expect(readAssistantComposerDraft(keys[0]).text).toBe("Unrelated composer text");
  });
});
