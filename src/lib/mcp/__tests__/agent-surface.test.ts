import type { CapabilityCollector } from "@/lib/mcp/types";
import { describe, expect, it, vi } from "vitest";
const runTool = vi.hoisted(() => vi.fn(async (name: string) => ({ content: [{ type: "text", text: JSON.stringify({ tool: name }) }] })));
vi.mock("@/lib/mcp/tools", () => ({ runWorkspaceToolForAuth: runTool }));
import { registerAgentSurface } from "@/lib/mcp/agent-surface";

type ResourceRegistration = {
  name: string;
  target: unknown;
  callback: (...args: unknown[]) => Promise<unknown>;
};

type PromptRegistration = {
  name: string;
  callback: (args: Record<string, string>) => Promise<unknown>;
};

function registrations() {
  const resources: ResourceRegistration[] = [];
  const prompts: PromptRegistration[] = [];
  const server = {
    registerResource(
      name: string,
      target: unknown,
      _config: unknown,
      callback: ResourceRegistration["callback"],
    ) {
      resources.push({ name, target, callback });
    },
    registerPrompt(
      name: string,
      _config: unknown,
      callback: PromptRegistration["callback"],
    ) {
      prompts.push({ name, callback });
    },
  } as unknown as CapabilityCollector;
  registerAgentSurface(server);
  return { resources, prompts };
}

describe("MCP agent surface", () => {
  it("publishes agent guidance, workspace context, and item resources", () => {
    const { resources } = registrations();
    expect(resources.map((resource) => resource.name)).toEqual([
      "texttext-agent-guide",
      "texttext-workspace",
      "texttext-item",
    ]);
    expect(String(resources[0]?.target)).toBe("texttext://agent-guide");
    expect(String(resources[1]?.target)).toBe("texttext://workspace");
  });

  it("reads resource content through the same authenticated command dispatcher", async () => {
    runTool.mockClear();
    const { resources } = registrations();
    const context = { authInfo: { clientId: "agent", scopes: ["read"], extra: { sub: "actor" } } };
    await resources[1]!.callback(new URL("texttext://workspace"), context);
    expect(runTool).toHaveBeenCalledWith("get_workspace", {}, context);
    expect(runTool).toHaveBeenCalledWith("list_folders", {}, context);
    await resources[2]!.callback(new URL("texttext://items/item-id"), { id: "item-id" }, context);
    expect(runTool).toHaveBeenCalledWith("read_item", { id: "item-id" }, context);
  });

  it("teaches exact retry arguments and uses canonical folder casing", async () => {
    const { resources, prompts } = registrations();
    const guide = await resources[0]!.callback(new URL("texttext://agent-guide"), {}) as { contents: { text: string }[] };
    expect(guide.contents[0].text).toContain("original if_match_hash");
    expect(guide.contents[0].text).not.toContain("replayed: true");
    const prompt = await prompts[0].callback({ projects: "Example" });
    expect(JSON.stringify(prompt)).toContain("Destination: Notes");
  });

  it("publishes reusable project, live canvas, conversation, and release prompts", () => {
    const { prompts } = registrations();
    expect(prompts.map((prompt) => prompt.name)).toEqual([
      "maintain_project_documents",
      "use_live_document_canvas",
      "capture_conversation",
      "prepare_release_note",
    ]);
  });

  it("teaches project agents to use stable retry keys", async () => {
    const { resources, prompts } = registrations();
    const guide = (await resources[0]!.callback(new URL("texttext://agent-guide"), {})) as {
      contents: Array<{ text: string }>;
    };
    expect(guide.contents[0]?.text).toContain("idempotency_key");
    expect(guide.contents[0]?.text).toContain("append_to_item");

    const projectPrompt = await prompts
      .find((prompt) => prompt.name === "maintain_project_documents")!
      .callback({
      projects: "alpha, beta",
      folder_path: "notes",
      namespace: "workspace-1",
    });
    expect(JSON.stringify(projectPrompt)).toContain(
      "workspace-1:project:<stable-project-id>",
    );
    expect(JSON.stringify(projectPrompt)).toContain(
      "workspace-1:event:<stable-project-id>:<stable-event-id>",
    );
  });

  it("teaches agents to keep one live document current", async () => {
    const { resources, prompts } = registrations();
    const guide = (await resources[0]!.callback(new URL("texttext://agent-guide"), {})) as {
      contents: Array<{ text: string }>;
    };
    expect(guide.contents[0]?.text).toContain("Live document canvases");
    expect(guide.contents[0]?.text).toContain("collaboration document");

    const canvasPrompt = await prompts
      .find((prompt) => prompt.name === "use_live_document_canvas")!
      .callback({
        title: "Premium features",
        goal: "Keep the product specification current.",
        folder_path: "notes",
        source_id: "premium-features",
      });
    const text = JSON.stringify(canvasPrompt);
    expect(text).toContain("canvas:premium-features");
    expect(text).toContain("which item to open");
    expect(text).toContain("append_to_item");
    expect(text).toContain("mutation conflicts");
  });
});
